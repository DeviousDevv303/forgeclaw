// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Deep research: server-side evidence gathering ───────────────────────────
// Dispatches .github/workflows/deep-research.yml (multi-query search, page fetch, main-text
// extraction; see .github/scripts/deep_research.py), waits for the correlated run, and reads the
// evidence from the research-results mirror branch. The model then writes the answer and cites [n].
// Only fetched pages become sources; failures are reported as failures, never as evidence.
// When sentiment subjects are supplied, the same run fans out to the community lanes (Reddit,
// X via xAI, Facebook) and the report carries a per-lane manifest: a lane that did not run is
// named with its reason in formatResearchResult, never silently absent.

import type { GithubRequest } from './githubPublish'
import { dispatchAndWait, newInvocationId } from './workflowRun'

export const DEEP_RESEARCH_WORKFLOW = 'deep-research.yml'
export const RESEARCH_MIRROR_BRANCH = 'research-results'
export const RESEARCH_MAX_WAIT_MS = 15 * 60 * 1000
/** Evidence handed to the model; large enough for 15 sources of ~2.4k chars, bounded for small contexts. */
export const RESEARCH_RESULT_MAX_CHARS = 40_000

export interface ResearchSource { id: number; url: string; domain: string; title: string; date: string; excerpt: string }

/** One lane of a research run: the web search or a community sentiment source. */
export type ResearchLaneStatus = 'ran' | 'not_configured' | 'failed'
export interface ResearchLane {
  id: string
  label: string
  status: ResearchLaneStatus
  /** Items the lane actually returned (sources for web, posts/comments for community lanes). */
  items: number
  as_of?: string
  /** Why the lane did not run (not_configured / failed); empty when it ran clean. */
  reason?: string
  /** Extra truth about a lane that ran partially (e.g. one subreddit failed). */
  detail?: string
}

/** One community post/comment a sentiment lane actually returned, with its source URL. */
export interface SentimentItem { lane: string; kind: string; text: string; url: string; score?: number | null; extraction?: string }

/**
 * The crowd's lean, counted deterministically from the stored items (same rule, named in
 * `method`, on both sides of the wire): an item counts for a side when it names that side and
 * not the other. share_pct[i] is side i's percentage of pick-bearing items; null when none.
 */
export interface SentimentLean { method: string; sides: string[]; pick_bearing: number; counts: number[]; share_pct: Array<number | null> }
export interface SentimentReport { sides: string[]; items: SentimentItem[]; lean: SentimentLean | null }

export interface ResearchReport {
  question: string
  queries: string[]
  sources: ResearchSource[]
  failures: Array<{ url?: string; query?: string; error: string }>
  elapsed_seconds: number
  markdown?: string
  /** Per-lane manifest (web + community lanes). Absent only on reports from before the lanes existed. */
  lanes?: ResearchLane[]
  /** True when the caller supplied sentiment subjects for this run. */
  sentiment_requested?: boolean
  sentiment?: SentimentReport
}

export interface DeepResearchInput {
  owner: string
  repo: string
  token: string
  question: string
  queries?: string[]
  maxSources?: number
  /** Community sentiment subjects: the matchup/event plus exactly two sides. */
  sentiment?: { query: string; sides: readonly string[] }
  signal?: AbortSignal
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  invocationId?: string
}

export function normalizeQueries(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/\n|;/) : []
  return list.map(q => String(q).replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 6)
}

export interface SentimentSubjects { query: string; sides: [string, string] }

/** Sentiment subjects for a run, or null: a query plus exactly two non-empty side names. */
export function normalizeSentimentInput(rawQuery: unknown, rawSides: unknown): SentimentSubjects | null {
  const query = typeof rawQuery === 'string' ? rawQuery.replace(/\s+/g, ' ').trim().slice(0, 200) : ''
  const sides = Array.isArray(rawSides) ? rawSides.map(s => String(s).replace(/\s+/g, ' ').trim()).filter(Boolean) : []
  if (!query || sides.length !== 2) return null
  return { query, sides: [sides[0].slice(0, 80), sides[1].slice(0, 80)] }
}

export async function runDeepResearch(request: GithubRequest, input: DeepResearchInput): Promise<{ report: ResearchReport; runUrl: string; invocationId: string }> {
  const question = input.question.replace(/\s+/g, ' ').trim()
  if (!question) throw new Error('question is required')
  if (question.length > 1000) throw new Error('question must be at most 1000 characters')
  const queries = normalizeQueries(input.queries)
  const maxSources = Math.max(1, Math.min(Math.round(input.maxSources ?? 8), 15))
  const sentiment = normalizeSentimentInput(input.sentiment?.query, input.sentiment?.sides)
  const invocationId = input.invocationId || newInvocationId('research')
  const run = await dispatchAndWait(request, {
    owner: input.owner, repo: input.repo, token: input.token, workflow: DEEP_RESEARCH_WORKFLOW,
    inputs: {
      question, queries: queries.join('\n'), max_sources: String(maxSources), invocation_id: invocationId,
      ...(sentiment ? { sentiment_query: sentiment.query, sentiment_sides: sentiment.sides.join('|') } : {}),
    },
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

/** Community lanes that were asked for on this run and did not run: each must be named downstream. */
export function missingForumLanes(report: ResearchReport): ResearchLane[] {
  if (!report.sentiment_requested) return []
  return (report.lanes ?? []).filter(lane => lane.id !== 'web' && lane.status !== 'ran')
}

const SENTIMENT_ITEMS_SHOWN = 12

/**
 * The lane manifest block of a tool result. A run that asked for the forum layer and did not get
 * all of it says so in as many words — "forum layer missing: <lane> — <reason>" — so a consumer
 * (a fight proposal's SENTIMENT SCAN above all) names the gap instead of silently proceeding.
 * Reports from before the lanes existed carry no manifest and render exactly as they used to.
 */
export function formatLaneBlock(report: ResearchReport): string {
  const lanes = report.lanes ?? []
  if (!lanes.length) return ''
  const lines = ['Source lanes:']
  for (const lane of lanes) {
    const state = lane.status === 'ran' ? `ran — ${lane.items} item(s)` : lane.status === 'not_configured' ? 'NOT CONFIGURED' : 'FAILED'
    lines.push(`- ${lane.label}: ${state}${lane.reason ? ` — ${lane.reason}` : ''}${lane.detail ? ` (${lane.detail})` : ''}${lane.as_of ? ` (as of ${lane.as_of})` : ''}`)
  }
  const missing = missingForumLanes(report)
  for (const lane of missing) {
    lines.push(`forum layer missing: ${lane.label} — ${lane.reason || lane.status}`)
  }
  if (missing.length) {
    lines.push('A SENTIMENT SCAN written from this research must name every missing lane above (write "unavailable — forum layer missing: <lane> (<reason>)"); never present the scan as complete.')
  }
  const sentiment = report.sentiment
  if (sentiment?.lean) {
    const lean = sentiment.lean
    const per = lean.sides.map((side, i) => `${side}: ${lean.counts[i] ?? 0} item(s)${lean.share_pct[i] != null ? ` (${lean.share_pct[i]}%)` : ''}`).join('; ')
    lines.push(`Community lean (${lean.method}; ${lean.pick_bearing} pick-bearing of ${sentiment.items.length} item(s)): ${per}`)
    lines.push('For a SENTIMENT SCAN, "crowd lean: <n>%" is the share above of the side you propose.')
  } else if (sentiment && report.sentiment_requested) {
    lines.push('Community lean: not computed (the counting rule needs exactly two sides).')
  }
  if (sentiment?.items.length) {
    lines.push('Sentiment items:')
    for (const item of sentiment.items.slice(0, SENTIMENT_ITEMS_SHOWN)) {
      lines.push(`- [${item.lane}] ${item.text.replace(/\s+/g, ' ').slice(0, 200)} — ${item.url}`)
    }
    if (sentiment.items.length > SENTIMENT_ITEMS_SHOWN) lines.push(`(${sentiment.items.length - SENTIMENT_ITEMS_SHOWN} more sentiment item(s) in the stored research record)`)
  }
  return lines.join('\n')
}

/** Tool result: numbered evidence plus the citation rule. Never contains an answer of its own. */
export function formatResearchResult(report: ResearchReport, runUrl: string): string {
  const laneBlock = formatLaneBlock(report)
  if (!report.sources?.length) {
    const why = (report.failures ?? []).slice(0, 6).map(f => `${f.url || f.query}: ${f.error}`).join('\n  ')
    return `[TOOL ERROR] deep_research found no readable sources for "${report.question}". Nothing can be cited.${why ? `\n  ${why}` : ''}\n  run: ${runUrl}${laneBlock ? `\n${laneBlock}` : ''}`
  }
  const header = `✓ Deep research: ${report.sources.length} source(s) for "${report.question}" (${report.queries.length} queries, ${report.elapsed_seconds}s)\n` +
    `Write the answer only from these sources and cite them as [n]. Say plainly what they do not cover; never cite a source that is not listed.\nrun: ${runUrl}\n`
  // The lane block always fits: source excerpts yield room to it, never the other way around.
  const budget = RESEARCH_RESULT_MAX_CHARS - (laneBlock ? laneBlock.length + 1 : 0)
  let body = ''
  for (const s of report.sources) {
    const entry = `\n[${s.id}] ${s.title || s.url} (${s.domain}${s.date ? `, ${s.date}` : ''})\n${s.url}\n${s.excerpt}\n`
    if (header.length + body.length + entry.length > budget) { body += `\n(${report.sources.length - s.id + 1} more source(s) omitted for length)`; break }
    body += entry
  }
  const failed = report.failures?.length ? `\nNot used: ${report.failures.length} page(s) or queries failed.` : ''
  return header + body + failed + (laneBlock ? `\n${laneBlock}` : '')
}
