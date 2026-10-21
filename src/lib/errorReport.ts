// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── ForgeClaw reads its own errors ───────────────────────────────────────────────────────────
// error_report gathers what has actually gone wrong, from evidence rather than memory: the failures NEXUS has
// recorded and grouped (what recurs, how often, when last), and the repository's recent failed workflow runs
// with the error text of the failing job (runDiagnosis.ts). It only reads. The model turns the report into a plan,
// asks the owner's permission, and only then changes anything (self-sculpt key, co-signed, one fix per pull request).

import type { LearningCandidate } from './corpus'
import { summarizeLearning } from './nexusLearning'
import { getErrorLog, type ErrorLogEntry } from './errorLog'
import { jobFailureEvidence } from './runDiagnosis'
import { redactSecrets } from './screenText'

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

const MAX_CHARS = 7000
const RUN_WINDOW_MS = 3 * 24 * 3600 * 1000

export interface ErrorReportInput {
  owner: string
  repo: string
  token: string
  candidates: LearningCandidate[]
  /** This browser's own error log (errorLog.ts); defaults to the live one. */
  appLog?: ErrorLogEntry[]
  now?: number
}

export function recurringFailures(candidates: LearningCandidate[], max = 8): string[] {
  const { lessons, tools } = summarizeLearning(candidates)
  const unreliable = tools.filter(t => t.failed > 0).sort((a, b) => b.failed - a.failed).slice(0, 5)
  const lines = lessons.slice(0, max).map((l, i) =>
    `${i + 1}. ${l.tool} ×${l.count}${l.ownerCount !== l.count ? ` (${l.ownerCount} from your own runs)` : ''}: ${l.pattern} (last ${l.lastSeen.slice(0, 10)})`)
  if (unreliable.length) lines.push('Tools with failures (all time): ' + unreliable.map(t => `${t.tool} ${t.failed}/${t.total} failed`).join('; '))
  return lines
}

/** This browser's own error log, grouped: what the app itself logged (failed requests, tool errors, workflow failures), most frequent first. */
export function appErrorLogSection(entries: ErrorLogEntry[], max = 8): string[] {
  const groups = new Map<string, { source: string; message: string; level: string; count: number; last: number; detail: string }>()
  for (const e of entries) {
    const key = `${e.source}|${e.message.replace(/\b[0-9a-f]{7,40}\b/gi, '<sha>').replace(/\d+/g, '#').slice(0, 120)}`
    const g = groups.get(key) ?? { source: e.source, message: e.message.slice(0, 160), level: e.level, count: 0, last: 0, detail: '' }
    g.count += 1
    if (e.timestamp >= g.last) { g.last = e.timestamp; g.detail = (e.details ?? '').split('\n')[0].slice(0, 140) }
    groups.set(key, g)
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count || b.last - a.last)
    .slice(0, max)
    .map((g, i) => `${i + 1}. [${g.level}] ${g.source} ×${g.count}: ${g.message}${g.detail ? ` — ${g.detail}` : ''} (last ${new Date(g.last).toISOString().slice(0, 16).replace('T', ' ')})`)
}

export async function failedRuns(request: Fetch, input: Pick<ErrorReportInput, 'owner' | 'repo' | 'token' | 'now'>, max = 3): Promise<string[]> {
  const headers = { Authorization: `token ${input.token}`, Accept: 'application/vnd.github+json' }
  const base = `https://api.github.com/repos/${input.owner}/${input.repo}`
  const res = await request(`${base}/actions/runs?status=failure&per_page=15`, { headers })
  if (!res.ok) return [`(Could not list failed runs: GitHub ${res.status}.)`]
  const now = input.now ?? Date.now()
  const runs = ((await res.json()) as { workflow_runs?: Array<{ id: number; name: string; display_title?: string; head_branch?: string; created_at: string; html_url: string; run_number: number }> }).workflow_runs ?? []
  const recent = runs.filter(r => now - Date.parse(r.created_at) <= RUN_WINDOW_MS).slice(0, max)
  const out: string[] = []
  for (const run of recent) {
    const head = `• ${run.name} #${run.run_number} on ${run.head_branch ?? '?'} (${run.created_at.slice(0, 16).replace('T', ' ')}): ${(run.display_title ?? '').slice(0, 80)}\n  ${run.html_url}`
    let evidence = ''
    try {
      const jobsRes = await request(`${base}/actions/runs/${run.id}/jobs`, { headers })
      const jobs = jobsRes.ok ? ((await jobsRes.json()) as { jobs?: Array<{ id: number; conclusion: string | null; steps?: Array<{ name: string; conclusion: string | null }> }> }).jobs ?? [] : []
      const job = jobs.find(j => j.conclusion === 'failure')
      const step = job?.steps?.find(s => s.conclusion === 'failure')
      if (job) evidence = `  failed at: ${step?.name ?? '(unknown step)'}\n  ${(await jobFailureEvidence(request, { owner: input.owner, repo: input.repo, token: input.token, jobId: job.id })).replace(/\n/g, '\n  ')}`
    } catch { /* keep the run line without evidence */ }
    out.push(evidence ? `${head}\n${evidence}` : head)
  }
  return out
}

/** The whole report, bounded and redacted. Empty sections say so: "nothing failed" is evidence too. */
export async function buildErrorReport(request: Fetch, input: ErrorReportInput): Promise<string> {
  const failures = recurringFailures(input.candidates)
  let runs: string[]
  try { runs = await failedRuns(request, input) } catch (error) { runs = [`(Could not read failed runs: ${error instanceof Error ? error.message : String(error)}.)`] }
  const appLog = appErrorLogSection(input.appLog ?? getErrorLog())
  const text = [
    'FORGECLAW ERROR REPORT (read-only evidence; nothing was changed)',
    '',
    `THIS BROWSER'S OWN ERROR LOG (what the app itself logged, most frequent first):`,
    appLog.length ? appLog.join('\n') : '(empty)',
    '',
    'RECURRING FAILURES recorded by NEXUS (newest evidence first):',
    failures.length ? failures.join('\n') : '(none recorded)',
    '',
    `FAILED WORKFLOW RUNS in the last 3 days on ${input.owner}/${input.repo}:`,
    runs.length ? runs.join('\n') : '(none failed in that window)',
  ].join('\n')
  const clipped = text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n…(cut)` : text
  return redactSecrets(clipped)
}
