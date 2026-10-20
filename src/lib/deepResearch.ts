// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Deep research: server-side evidence gathering ───────────────────────────
// Dispatches .github/workflows/deep-research.yml (multi-query search, page fetch, main-text
// extraction; see .github/scripts/deep_research.py), waits for the correlated run, and reads the
// evidence from the research-results mirror branch. The model then writes the answer and cites [n].
// Only fetched pages become sources; failures are reported as failures, never as evidence.

import type { GithubRequest } from './githubPublish'
import { dispatchAndWait, newInvocationId } from './workflowRun'

export const DEEP_RESEARCH_WORKFLOW = 'deep-research.yml'
export const RESEARCH_MIRROR_BRANCH = 'research-results'
export const RESEARCH_MAX_WAIT_MS = 15 * 60 * 1000
/** Evidence handed to the model; large enough for 15 sources of ~2.4k chars, bounded for small contexts. */
export const RESEARCH_RESULT_MAX_CHARS = 40_000

export interface ResearchSource { id: number; url: string; domain: string; title: string; date: string; excerpt: string }
export interface ResearchReport { question: string; queries: string[]; sources: ResearchSource[]; failures: Array<{ url?: string; query?: string; error: string }>; elapsed_seconds: number; markdown?: string }

export interface DeepResearchInput {
  owner: string
  repo: string
  token: string
  question: string
  queries?: string[]
  maxSources?: number
  signal?: AbortSignal
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  invocationId?: string
}

export function normalizeQueries(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/\n|;/) : []
  return list.map(q => String(q).replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 6)
}

export async function runDeepResearch(request: GithubRequest, input: DeepResearchInput): Promise<{ report: ResearchReport; runUrl: string; invocationId: string }> {
  const question = input.question.replace(/\s+/g, ' ').trim()
  if (!question) throw new Error('question is required')
  if (question.length > 1000) throw new Error('question must be at most 1000 characters')
  const queries = normalizeQueries(input.queries)
  const maxSources = Math.max(1, Math.min(Math.round(input.maxSources ?? 8), 15))
  const invocationId = input.invocationId || newInvocationId('research')
  const run = await dispatchAndWait(request, {
    owner: input.owner, repo: input.repo, token: input.token, workflow: DEEP_RESEARCH_WORKFLOW,
    inputs: { question, queries: queries.join('\n'), max_sources: String(maxSources), invocation_id: invocationId },
    invocationId, maxWaitMs: RESEARCH_MAX_WAIT_MS, signal: input.signal, sleep: input.sleep, now: input.now,
  })
  // The mirror is written even when no source could be fetched, so the failures can be shown.
  const res = await request(`https://api.github.com/repos/${input.owner}/${input.repo}/contents/${RESEARCH_MIRROR_BRANCH}/${invocationId}.json?ref=${RESEARCH_MIRROR_BRANCH}`, {
    headers: { Authorization: `token ${input.token}`, Accept: 'application/vnd.github.raw+json' }, cache: 'no-store',
  })
  if (!res.ok) throw new Error(`research run #${run.run_number} concluded "${run.conclusion}" and its evidence could not be read (GitHub ${res.status}). Logs: ${run.html_url}`)
  const report = await res.json() as ResearchReport
  return { report, runUrl: run.html_url, invocationId }
}

/** Tool result: numbered evidence plus the citation rule. Never contains an answer of its own. */
export function formatResearchResult(report: ResearchReport, runUrl: string): string {
  if (!report.sources?.length) {
    const why = (report.failures ?? []).slice(0, 6).map(f => `${f.url || f.query}: ${f.error}`).join('\n  ')
    return `[TOOL ERROR] deep_research found no readable sources for "${report.question}". Nothing can be cited.${why ? `\n  ${why}` : ''}\n  run: ${runUrl}`
  }
  const header = `✓ Deep research: ${report.sources.length} source(s) for "${report.question}" (${report.queries.length} queries, ${report.elapsed_seconds}s)\n` +
    `Write the answer only from these sources and cite them as [n]. Say plainly what they do not cover; never cite a source that is not listed.\nrun: ${runUrl}\n`
  let body = ''
  for (const s of report.sources) {
    const entry = `\n[${s.id}] ${s.title || s.url} (${s.domain}${s.date ? `, ${s.date}` : ''})\n${s.url}\n${s.excerpt}\n`
    if (header.length + body.length + entry.length > RESEARCH_RESULT_MAX_CHARS) { body += `\n(${report.sources.length - s.id + 1} more source(s) omitted for length)`; break }
    body += entry
  }
  const failed = report.failures?.length ? `\nNot used: ${report.failures.length} page(s) or queries failed.` : ''
  return header + body + failed
}
