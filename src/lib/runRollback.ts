// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission.

/**
 * Run journal and rollback: what STOP undoes.
 *
 * While a run is active, write-type tools record how to undo what they did. STOP then cancels any
 * remote workflow runs and reverts the recorded repository changes to the last known state.
 *
 * Safety rules (reversible > irreversible; never silently destructive):
 *  - the default branch, main and master are never deleted or force-moved;
 *  - a branch is deleted only if THIS run created it;
 *  - a pre-existing branch is reset only if its head is still the commit THIS run produced
 *    (compare-before-reset), so someone else's later push is never overwritten;
 *  - side effects that cannot be reverted (messages sent, issues created, commits to the default
 *    branch) are listed as irreversible instead of being claimed as undone.
 */

export type JournalEntry =
  /** A GitHub Actions workflow this run dispatched. `needle` is matched against the run title. */
  | { kind: 'workflow_dispatch'; workflow: string; needle?: string; since: number; label: string }
  /** A branch that did not exist before this run and was (or may have been) created by it. */
  | { kind: 'branch_created'; branch: string; label: string }
  /** A pre-existing branch this run moved from beforeSha to afterSha. */
  | { kind: 'branch_advanced'; branch: string; beforeSha: string; afterSha: string; label: string }
  /** Something that cannot be undone automatically. */
  | { kind: 'irreversible'; label: string }

export interface RunJournal {
  record(entry: JournalEntry): void
  entries(): readonly JournalEntry[]
  clear(): void
}

export function createRunJournal(): RunJournal {
  const list: JournalEntry[] = []
  return {
    record: entry => { list.push(entry) },
    entries: () => [...list],
    clear: () => { list.length = 0 },
  }
}

let activeJournal: RunJournal | null = null
export function setActiveRunJournal(journal: RunJournal | null): void { activeJournal = journal }
export function getActiveRunJournal(): RunJournal | null { return activeJournal }

/** Recording must never break a tool, so failures here are swallowed. */
export function journalRecord(journal: RunJournal | null | undefined, entry: JournalEntry): void {
  try { (journal ?? activeJournal)?.record(entry) } catch { /* journaling is best-effort */ }
}

export interface RollbackReport {
  /** Things that were undone, each with the evidence (run number, ref, sha). */
  reverted: string[]
  /** Things deliberately left alone, with the reason. */
  skipped: string[]
  /** Things that should have been undone but were not. */
  failed: string[]
  /** Things that cannot be undone automatically. */
  irreversible: string[]
}

export interface RollbackDeps {
  owner: string
  repo: string
  token: string
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  /** How long a cancelled run may stay active before force-cancel is used. */
  forceCancelAfterMs?: number
  /** Upper bound for waiting on runs to actually end before touching branches. */
  settleTimeoutMs?: number
}

const SAFE_BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/
const NEVER_TOUCH = new Set(['main', 'master', 'head'])
const ACTIVE = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested'])

interface WorkflowRunLite { id: number; run_number?: number; status: string; name?: string; display_title?: string; created_at?: string; html_url?: string }

export async function rollbackRun(entries: readonly JournalEntry[], deps: RollbackDeps): Promise<RollbackReport> {
  const report: RollbackReport = { reverted: [], skipped: [], failed: [], irreversible: [] }
  const doFetch = deps.fetchImpl ?? fetch
  const sleep = deps.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const forceAfter = deps.forceCancelAfterMs ?? 10_000
  // GitHub can take a minute or more to finish cancelling a run that is in the middle of a long step
  // (observed live: ~90s for a DeepSeek run). Waiting too briefly reports a false failure.
  const settleTimeout = deps.settleTimeoutMs ?? 150_000
  const base = `https://api.github.com/repos/${deps.owner}/${deps.repo}`
  const headers = { Authorization: `token ${deps.token}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' }
  const api = (path: string, init?: RequestInit) => doFetch(`${base}${path}`, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) } })

  const labelOf = (e: JournalEntry) => e.label

  // 1. Cancel remote runs first, so nothing keeps writing while branches are reverted.
  const dispatches = entries.filter((e): e is Extract<JournalEntry, { kind: 'workflow_dispatch' }> => e.kind === 'workflow_dispatch')
  const cancelledIds: Array<{ id: number; label: string; workflow: string }> = []
  for (const entry of dispatches) {
    let matches = await findActiveRuns(entry)
    if (matches.length === 0) { await sleep(3_000); matches = await findActiveRuns(entry) }
    if (matches.length === 0) { report.skipped.push(`${labelOf(entry)}: no active run found (already finished, or never started)`); continue }
    for (const run of matches) {
      try {
        const res = await api(`/actions/runs/${run.id}/cancel`, { method: 'POST' })
        if (res.ok || res.status === 409) cancelledIds.push({ id: run.id, label: labelOf(entry), workflow: entry.workflow })
        else report.failed.push(`${labelOf(entry)}: cancel run #${run.run_number ?? run.id} returned ${res.status}`)
      } catch (error) {
        report.failed.push(`${labelOf(entry)}: cancel run #${run.run_number ?? run.id} failed (${briefError(error)})`)
      }
    }
  }

  // 2. Make sure cancelled runs actually end; escalate to force-cancel if they linger.
  const stillActive = new Set<number>()
  if (cancelledIds.length) {
    await sleep(forceAfter)
    const rounds = Math.max(1, Math.ceil(settleTimeout / 2_000))
    let pending = [...cancelledIds]
    let forced = false
    for (let round = 0; pending.length && round < rounds; round += 1) {
      const next: typeof pending = []
      for (const item of pending) {
        const status = await runStatus(item.id)
        if (status === 'completed' || status === 'gone') continue
        next.push(item)
        if (!forced) {
          try { await api(`/actions/runs/${item.id}/force-cancel`, { method: 'POST' }) } catch { /* reported below if it never ends */ }
        }
      }
      forced = true
      pending = next
      if (pending.length) await sleep(2_000)
    }
    for (const item of cancelledIds) {
      if (pending.some(p => p.id === item.id)) { stillActive.add(item.id); report.failed.push(`${item.label}: run ${item.id} is still active after force-cancel and ${Math.round(settleTimeout / 1000)}s of waiting; GitHub has been asked to stop it, check Actions`) }
      else report.reverted.push(`${item.label}: cancelled run ${item.id}`)
    }
  }
  if (stillActive.size) {
    report.skipped.push('branch cleanup skipped for safety: a cancelled run is still active and could recreate branches')
    for (const e of entries) if (e.kind === 'irreversible') report.irreversible.push(e.label)
    return report
  }

  // 3. Revert repository state, newest change first.
  let defaultBranch: string | null | undefined
  const isProtected = async (branch: string): Promise<boolean> => {
    if (!SAFE_BRANCH.test(branch) || branch.includes('..') || NEVER_TOUCH.has(branch.toLowerCase())) return true
    if (defaultBranch === undefined) {
      try {
        const res = await api('')
        defaultBranch = res.ok ? ((await res.json()) as { default_branch?: string }).default_branch ?? null : null
      } catch { defaultBranch = null }
    }
    // If the default branch cannot be determined, only the hard-coded names above are protected.
    return defaultBranch !== null && branch === defaultBranch
  }

  for (const entry of [...entries].reverse()) {
    if (entry.kind === 'irreversible') { report.irreversible.push(entry.label); continue }
    if (entry.kind === 'workflow_dispatch') continue

    if (await isProtected(entry.branch)) {
      report.skipped.push(`${entry.label}: ${entry.branch} is protected (default branch or unsafe name); never reverted automatically`)
      continue
    }

    if (entry.kind === 'branch_advanced') {
      try {
        const current = await api(`/git/ref/heads/${entry.branch}`)
        if (current.status === 404) { report.skipped.push(`${entry.label}: branch ${entry.branch} no longer exists`); continue }
        if (!current.ok) { report.failed.push(`${entry.label}: could not read ${entry.branch} (${current.status})`); continue }
        const head = ((await current.json()) as { object?: { sha?: string } }).object?.sha
        if (head !== entry.afterSha) {
          report.skipped.push(`${entry.label}: ${entry.branch} moved since this run (head ${head?.slice(0, 7) ?? 'unknown'}, run wrote ${entry.afterSha.slice(0, 7)}); left untouched`)
          continue
        }
        const reset = await api(`/git/refs/heads/${entry.branch}`, { method: 'PATCH', body: JSON.stringify({ sha: entry.beforeSha, force: true }) })
        if (reset.ok) report.reverted.push(`${entry.label}: ${entry.branch} reset ${entry.afterSha.slice(0, 7)} -> ${entry.beforeSha.slice(0, 7)}`)
        else report.failed.push(`${entry.label}: reset of ${entry.branch} returned ${reset.status}`)
      } catch (error) {
        report.failed.push(`${entry.label}: ${entry.branch} reset failed (${briefError(error)})`)
      }
      continue
    }

    // branch_created
    try {
      const prs = await api(`/pulls?state=open&head=${encodeURIComponent(`${deps.owner}:${entry.branch}`)}`)
      if (prs.ok) {
        for (const pr of (await prs.json()) as Array<{ number: number }>) {
          const closed = await api(`/pulls/${pr.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) })
          if (closed.ok) report.reverted.push(`${entry.label}: closed PR #${pr.number}`)
          else report.failed.push(`${entry.label}: closing PR #${pr.number} returned ${closed.status}`)
        }
      }
      const del = await api(`/git/refs/heads/${entry.branch}`, { method: 'DELETE' })
      if (del.ok || del.status === 204) report.reverted.push(`${entry.label}: deleted branch ${entry.branch}`)
      else if (del.status === 404 || del.status === 422) report.skipped.push(`${entry.label}: branch ${entry.branch} was never created`)
      else report.failed.push(`${entry.label}: deleting ${entry.branch} returned ${del.status}`)
    } catch (error) {
      report.failed.push(`${entry.label}: cleanup of ${entry.branch} failed (${briefError(error)})`)
    }
  }
  return report

  async function findActiveRuns(entry: Extract<JournalEntry, { kind: 'workflow_dispatch' }>): Promise<WorkflowRunLite[]> {
    try {
      const res = await api(`/actions/workflows/${entry.workflow}/runs?event=workflow_dispatch&per_page=30`)
      if (!res.ok) return []
      const runs = ((await res.json()) as { workflow_runs?: WorkflowRunLite[] }).workflow_runs ?? []
      return runs.filter(run => {
        if (!ACTIVE.has(run.status)) return false
        if (entry.needle) return `${run.name ?? ''} ${run.display_title ?? ''}`.includes(entry.needle)
        // No unique title to match: accept only runs created at or after the dispatch (30s of clock drift allowed).
        return run.created_at ? Date.parse(run.created_at) >= entry.since - 30_000 : false
      })
    } catch { return [] }
  }

  async function runStatus(id: number): Promise<string> {
    try {
      const res = await api(`/actions/runs/${id}`)
      if (res.status === 404) return 'gone'
      if (!res.ok) return 'unknown'
      return ((await res.json()) as { status?: string }).status ?? 'unknown'
    } catch { return 'unknown' }
  }
}

function briefError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 120)
}

/** Plain-language summary for the chat after STOP. Never claims more than the report supports. */
export function formatRollbackReport(report: RollbackReport): string {
  const lines: string[] = []
  if (report.reverted.length) lines.push('Reverted:', ...report.reverted.map(l => `• ${l}`))
  if (report.skipped.length) lines.push('Left alone:', ...report.skipped.map(l => `• ${l}`))
  if (report.failed.length) lines.push('NOT reverted (needs attention):', ...report.failed.map(l => `• ${l}`))
  if (report.irreversible.length) lines.push('Cannot be undone automatically:', ...report.irreversible.map(l => `• ${l}`))
  return lines.length ? lines.join('\n') : 'Nothing to roll back: this run made no recorded changes.'
}
