// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Merge a pull request, with the checks a person would make ─────────────────────────────────
// github_merge_pr is co-signed under every posture (guardianGate.ts) and locked behind the self-sculpt key. On top of
// that the tool itself refuses anything a careful reviewer would not merge, and tells the model why:
// not open, a draft, not targeting the default branch, conflicts, a head that moved since it was looked at,
// a protected path in the change (.github/, Guardian, build configs: merged by the owner on GitHub, never from chat),
// or checks that are missing, running or not green. The merge request carries the head SHA it checked, so GitHub
// refuses it if anything was pushed in between.

import { isProtectedPath, parseProtectedList } from './protectedPaths'

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export interface MergeInput {
  owner: string
  repo: string
  token: string
  pullNumber: number
  /** If given, the merge is refused unless the pull request's head is exactly this commit. */
  expectedHeadSha?: string
  method?: 'squash' | 'merge' | 'rebase'
  /** How long to wait for the checks to finish before giving up (default 12 minutes). */
  maxWaitMs?: number
  /** How long to watch the default branch's own checks after the merge (default 4 minutes). */
  watchMainMs?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

interface Pull {
  number: number; title: string; state: string; draft?: boolean; merged?: boolean
  mergeable: boolean | null; mergeable_state?: string; changed_files: number
  head: { sha: string }
  base: { ref: string; repo?: { default_branch?: string } }
}
interface CheckRun { name: string; status: string; conclusion: string | null }

const GREEN = new Set(['success', 'skipped', 'neutral'])
const MAX_FILES = 300
const POLL_MS = 15_000
/** Checks start a moment after a push; no check at all is only an answer after this long. */
const NO_CHECKS_GRACE_MS = 90_000

async function getJson<T>(request: Fetch, url: string, what: string, headers: Record<string, string>): Promise<T> {
  const res = await request(url, { headers })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string }
    throw new Error(`Could not read ${what}: GitHub ${res.status}${body.message ? ` ${body.message}` : ''}. Nothing was merged.`)
  }
  return await res.json() as T
}

const listChecks = async (request: Fetch, base: string, sha: string, headers: Record<string, string>) =>
  (await getJson<{ check_runs: CheckRun[] }>(request, `${base}/commits/${sha}/check-runs?per_page=100`, 'the checks', headers)).check_runs

/**
 * Everything a careful person does before pressing merge, in order, waiting where a person would wait:
 * read the pull request; refuse drafts, closed, other base branches, conflicts, a moved head; refuse protected paths;
 * bring a branch that is behind up to date; wait for the checks on the head that will be merged to finish and
 * require them all green; confirm GitHub does not report it blocked; merge pinned to that head; then watch the
 * default branch's own checks for a few minutes and report them.
 */
export async function mergePullRequest(request: Fetch, input: MergeInput): Promise<string> {
  const headers = { Authorization: `token ${input.token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }
  const base = `https://api.github.com/repos/${input.owner}/${input.repo}`
  const sleep = input.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const now = input.now ?? Date.now
  const n = input.pullNumber
  const maxWait = input.maxWaitMs ?? 12 * 60_000
  if (!Number.isInteger(n) || n < 1) throw new Error('pull_number must be a positive whole number.')
  const started = now()

  const readPull = async (): Promise<Pull> => {
    let pull = await getJson<Pull>(request, `${base}/pulls/${n}`, `pull request #${n}`, headers)
    if (pull.mergeable === null) { await sleep(2000); pull = await getJson<Pull>(request, `${base}/pulls/${n}`, `pull request #${n}`, headers) }
    return pull
  }

  let pr = await readPull()
  const defaultBranch = pr.base.repo?.default_branch ?? 'main'
  const initialHead = pr.head.sha
  let updated = false
  let protectedCheckedFor = ''
  let checks: CheckRun[] = []
  const notes: string[] = []

  for (;;) {
    if (pr.merged || pr.state !== 'open') throw new Error(`Pull request #${n} is ${pr.merged ? 'already merged' : pr.state}; nothing to merge.`)
    if (pr.draft) throw new Error(`Pull request #${n} is still a draft. Mark it ready for review first.`)
    if (pr.base.ref !== defaultBranch) throw new Error(`Pull request #${n} targets "${pr.base.ref}", not the default branch "${defaultBranch}"; refusing.`)
    if (pr.mergeable === false || pr.mergeable_state === 'dirty') throw new Error(`Pull request #${n} has merge conflicts. Resolve them first; nothing was merged.`)
    if (!updated && input.expectedHeadSha && input.expectedHeadSha !== pr.head.sha) {
      throw new Error(`Pull request #${n} changed since it was reviewed (head is now ${pr.head.sha.slice(0, 7)}, expected ${input.expectedHeadSha.slice(0, 7)}). Review it again.`)
    }
    const head = pr.head.sha

    // Protected paths, judged from the policy on the default branch (never from the change), for every head we look at.
    if (protectedCheckedFor !== head) {
      if (pr.changed_files > MAX_FILES) throw new Error(`Pull request #${n} changes ${pr.changed_files} files; too many to check here (limit ${MAX_FILES}). Merge it on GitHub.`)
      const policyFile = await getJson<{ content?: string; encoding?: string }>(request, `${base}/contents/.github/protected-paths.txt?ref=${encodeURIComponent(defaultBranch)}`, 'the protected-paths policy', headers)
      if (!policyFile.content || policyFile.encoding !== 'base64') throw new Error('Could not read the protected-paths policy, so the change cannot be checked. Nothing was merged.')
      const entries = parseProtectedList(new TextDecoder().decode(Uint8Array.from(atob(policyFile.content.replace(/\s/g, '')), c => c.charCodeAt(0))))
      const paths: string[] = []
      for (let page = 1; paths.length < pr.changed_files && page <= 3; page++) {
        const files = await getJson<Array<{ filename: string; previous_filename?: string }>>(request, `${base}/pulls/${n}/files?per_page=100&page=${page}`, `the files of pull request #${n}`, headers)
        if (!files.length) break
        for (const f of files) { paths.push(f.filename); if (f.previous_filename) paths.push(f.previous_filename) }
      }
      const protectedHits = [...new Set(paths.filter(p => isProtectedPath(p, entries)))]
      if (protectedHits.length) {
        throw new Error(`Pull request #${n} changes protected paths (${protectedHits.slice(0, 5).join(', ')}${protectedHits.length > 5 ? ', …' : ''}). Those are merged by the owner on GitHub, never from chat. Nothing was merged.`)
      }
      protectedCheckedFor = head
    }

    // Behind the default branch: bring it up to date once, then look at the new head and wait for ITS checks.
    if (pr.mergeable_state === 'behind' && !updated) {
      const res = await request(`${base}/pulls/${n}/update-branch`, { method: 'PUT', headers, body: JSON.stringify({ expected_head_sha: head }) })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string }
        throw new Error(`Pull request #${n} is behind ${defaultBranch} and GitHub would not update it: ${res.status} ${body.message ?? ''}. Update it on GitHub. Nothing was merged.`.replace(/ \./, '.'))
      }
      updated = true
      notes.push(`updated the branch from ${defaultBranch}`)
      await sleep(5000)
      pr = await readPull()
      continue
    }

    checks = await listChecks(request, base, head, headers)
    const failing = checks.filter(r => r.status === 'completed' && !GREEN.has(r.conclusion ?? ''))
    if (failing.length) throw new Error(`Checks failed on pull request #${n}: ${failing.map(r => `${r.name} (${r.conclusion})`).join(', ')}. Nothing was merged.`)
    const running = checks.filter(r => r.status !== 'completed')
    const waited = now() - started
    if (!checks.length && waited >= NO_CHECKS_GRACE_MS) {
      throw new Error(`No checks ran on pull request #${n} (head ${head.slice(0, 7)}). Pull requests opened by the default Actions token get none; nothing was merged.`)
    }
    if (checks.length && !running.length) break
    if (waited >= maxWait) {
      throw new Error(`The checks on pull request #${n} had not finished after ${Math.round(maxWait / 60_000)} minutes (${running.map(r => r.name).join(', ') || 'none started'}). Ask again once they have; nothing was merged.`)
    }
    await sleep(POLL_MS)
    pr = await readPull()
  }

  // Checks are green on this head. GitHub's own verdict last: required reviews or protection rules show up as blocked.
  pr = await readPull()
  if (pr.head.sha !== protectedCheckedFor) throw new Error(`Pull request #${n} changed while its checks were being read (head is now ${pr.head.sha.slice(0, 7)}). Ask again; nothing was merged.`)
  if (pr.mergeable === false || pr.mergeable_state === 'dirty') throw new Error(`Pull request #${n} has merge conflicts. Resolve them first; nothing was merged.`)
  if (pr.mergeable_state === 'blocked') throw new Error(`GitHub reports pull request #${n} as blocked even though its checks are green (a required review or a branch protection rule). Nothing was merged.`)
  const head = pr.head.sha
  const method = input.method ?? 'squash'

  const res = await request(`${base}/pulls/${n}/merge`, { method: 'PUT', headers, body: JSON.stringify({ merge_method: method, sha: head }) })
  const body = await res.json().catch(() => ({})) as { merged?: boolean; sha?: string; message?: string }
  if (!res.ok || body.merged === false) throw new Error(`GitHub refused the merge of pull request #${n}: ${res.status} ${body.message ?? ''}`.trim() + '. Nothing was merged.')
  const mergedSha = body.sha ?? ''
  let out = `✓ Merged pull request #${n} "${pr.title}" into ${defaultBranch} (${method}) as ${mergedSha.slice(0, 7) || 'a new commit'}. ` +
    `Checks green on ${head.slice(0, 7)}: ${checks.map(r => r.name).join(', ')}.${notes.length ? ` (${notes.join('; ')}; head was ${initialHead.slice(0, 7)}.)` : ''}`

  // Then watch what the merge itself triggers on the default branch (build gate, deploy), for a few minutes.
  if (mergedSha) {
    const watchUntil = now() + (input.watchMainMs ?? 4 * 60_000)
    let after: CheckRun[] = []
    try {
      for (;;) {
        await sleep(POLL_MS)
        after = await listChecks(request, base, mergedSha, headers)
        if ((after.length && after.every(r => r.status === 'completed')) || now() >= watchUntil) break
      }
    } catch { /* the merge happened; a failed look afterwards must not turn it into an error */ }
    const bad = after.filter(r => r.status === 'completed' && !GREEN.has(r.conclusion ?? ''))
    const open = after.filter(r => r.status !== 'completed')
    if (!after.length) out += ` On ${defaultBranch}: no checks reported yet; look at the Actions tab.`
    else if (bad.length) out += ` ⚠ On ${defaultBranch} these FAILED after the merge: ${bad.map(r => `${r.name} (${r.conclusion})`).join(', ')}. Diagnose with github_get_run_logs and fix forward.`
    else if (open.length) out += ` On ${defaultBranch} still running: ${open.map(r => r.name).join(', ')}.`
    else out += ` On ${defaultBranch} all finished green: ${after.map(r => r.name).join(', ')}.`
  }
  return out + ' A merge cannot be undone from here; revert it on GitHub if needed.'
}
