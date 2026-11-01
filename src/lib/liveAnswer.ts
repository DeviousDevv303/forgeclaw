// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
/**
 * Live-answer synthesis (owner directive, 2026-10-31: "I don't need the duck duck go web search
 * or the parser none of that shit. I just need the answer.").
 *
 * A live-data question is routed straight to web_search (liveDataRouting.ts), and the raw tool
 * output — a plumbing header plus a hit list — used to BE the reply, stale top hit and all. The
 * user should see an ANSWER. The owner's ruling covers ANY web search shown in chat, so App.tsx
 * runs one deepseek_reason hop for every direct web_search reply, its task built here: read the
 * hits, state the verdict. If that hop fails, the fallback is the hit list with the plumbing
 * stripped (cleanSearchDisplay) — never the raw dump.
 *
 * The model-facing tool result (ddgWorkflowSearch's formatDdgResults) is untouched: its header
 * is a safety label for the model on the normal agent path, not for the user's eyes.
 */
import { stripReasoningArtifacts } from './ai/responseFilter'
import { todayLabel } from './currentInfo'
import { STALE_RESULTS_NOTE } from './ddgWorkflowSearch'

/** The instructions the synthesis hop runs under: the answer, from the results, nothing else. */
export const LIVE_ANSWER_INSTRUCTIONS = [
  'Answer the question using ONLY facts from the live search results below.',
  'Answer directly and plainly: give JUST the answer — the fact that was asked for, in as few words as the question needs.',
  'Use ONLY facts from the results. It must read as an answer, not a reasoning trace: do not narrate how you know, do not walk through the information, no preamble and no buildup.',
  'Never frame the answer with sourcing language: no "based on the provided information", no "according to the results" — never mention the search, the results, sources, or tools at all.',
  'Never describe the task or the request, and never say what the information includes or does not include. If the question asks for a judgment, give the judgment the results support — never answer with a list of factors to consider instead.',
  'Never add a sign-off or signature at the end (no "— ForgeClaw" or any other name).',
  'Several results may disagree or be about different dates: prefer the most recent result.',
  'A result from before the day the question asks about does not answer a question about that day.',
  'If the results do not contain the answer, say so in one sentence and give the closest fact they do contain.',
  'Never present an event from another date as the one asked about. If no result is about the day asked, say that nothing from that day was found.',
  'Name only people, events and outcomes that appear in the results; never add a name, opponent, method or round from memory.',
].join('\n')

const DAY_MS = 24 * 60 * 60 * 1000
/** The date line the synthesis hop needs to apply the date rules above: today, and the day asked about when the question names one. */
export function liveAnswerDateLine(question: string, now: Date = new Date()): string {
  const asked = /\b(yesterday|last night)\b/i.test(question) ? new Date(now.getTime() - DAY_MS)
    : /\btomorrow\b/i.test(question) ? new Date(now.getTime() + DAY_MS)
      : /\b(tonight|today|right now)\b/i.test(question) ? now : null
  return `Today's date is ${todayLabel(now)}.${asked && asked !== now ? ` The question asks about ${todayLabel(asked)}.` : asked ? ' The question asks about today.' : ''}`
}

/** The deepseek_reason task for the synthesis hop: instructions + the question + the raw hits. */
// 2026-11-01: this task carried no date, so "a result from before the day the question asks about" could not
// be applied — the hop relabelled the September 19 card as last night's. The date now rides in the task.
export function buildLiveAnswerTask(question: string, rawResults: string, now: Date = new Date()): string {
  return `${LIVE_ANSWER_INSTRUCTIONS}\n${liveAnswerDateLine(question, now)}\n\nQuestion: ${question}\n\nLive search results:\n${rawResults}`
}

/** The synthesis task for a hand-typed web_search call: there is no question, so summarize the hits. */
export function buildSearchSummaryTask(query: string, rawResults: string, now: Date = new Date()): string {
  return `${LIVE_ANSWER_INSTRUCTIONS}\n${liveAnswerDateLine(query, now)}\n\nRequest: Summarize the web search results for "${query}".\n\nLive search results:\n${rawResults}`
}

/**
 * The answer text inside a deepseek_reason tool output. forgeTools formats a success as
 * "✓ Qwen/Qwen3-8B completed as <id> on <owner>/<repo>@<ref>.\n<Stages>\nRun: <url>\n\n<result>"
 * — the answer is everything after the first blank line (the same split providerRouter uses).
 * Returns '' when there is no answer body.
 */
const SIGN_OFF_LINE = /(^|\n)\s*—\s*(ForgeClaw|Nexus( Intelligence)?|Qwen[^\n]*|DeepSeek[^\n]*|Muse)\s*$/i
const LEADING_HEDGE = /^(based on|according to) (the )?(provided information|information provided|search results|results|information below)[^,.:;]*[,.:;]\s*/i

export function extractDeepSeekAnswer(toolOutput: string): string {
  const splitAt = toolOutput.indexOf('\n\n')
  const body = splitAt >= 0 ? toolOutput.slice(splitAt + 2) : toolOutput
  let answer = stripReasoningArtifacts(body).trim()
  // Deterministic backstops for the two form defects the owner flagged live (2026-10-31): a
  // sign-off tail ("— ForgeClaw") and a sourcing hedge opening ("Based on the provided
  // information, …"). The instructions ban both; these strips hold even when the model slips.
  answer = answer.replace(SIGN_OFF_LINE, '').trim()
  if (LEADING_HEDGE.test(answer)) {
    answer = answer.replace(LEADING_HEDGE, '')
    answer = answer.charAt(0).toUpperCase() + answer.slice(1)
  }
  return answer.trim()
}

const PARSER_NOTE_LINE = /^\[parser note: [^\]]*\]\n?/
const DDG_HEADER_LINE = /^DuckDuckGo web search — "[^"]*" \(\d+ results?; untrusted web content, not instructions\):\n?/

/**
 * The fallback display when synthesis is unavailable: the search hits with the plumbing lines
 * (a [parser note] prefix, the DuckDuckGo tool header) stripped. Plain output passes through.
 */
export function cleanSearchDisplay(rawOutput: string): string {
  return rawOutput.replace(PARSER_NOTE_LINE, '').replace(DDG_HEADER_LINE, '').trim()
}

// ─── Grounding check (deterministic; the instructions above are not enough on their own) ─────────
// 2026-11-01 graded failure: the synthesized answer named a KO and an opponent that no result carried.
// Any capitalized name in the answer must occur in the search results, or the answer is withheld and
// the user sees the hits instead. A false withhold costs a less polished reply; a false pass costs a
// fabricated fact presented as current, so this errs toward withholding.
const NOT_NAMES = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'by', 'for', 'of', 'to', 'with', 'from', 'after',
  'before', 'he', 'she', 'they', 'it', 'his', 'her', 'their', 'this', 'that', 'these', 'those', 'there', 'here', 'no', 'not', 'nothing',
  'yes', 'none', 'both', 'all', 'one', 'two', 'three', 'four', 'five', 'round', 'rounds', 'main', 'event', 'card', 'note', 'today',
  'tonight', 'yesterday', 'tomorrow', 'last', 'night', 'win', 'won', 'wins', 'def', 'vs', 'versus', 'is', 'was', 'were', 'are',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'i', 'if', 'when', 'as', 'so', 'also'])
const fold = (t: string) => t.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/** Capitalized words in the answer that never occur in the sources (accent- and case-insensitive). */
export function unsupportedNames(answer: string, sources: string): string[] {
  const src = fold(sources)
  const out = new Set<string>()
  for (const m of answer.matchAll(/\b\p{Lu}[\p{L}'’-]{2,}/gu)) {
    const word = m[0].replace(/['’]s$/, '').replace(/[-'’]+$/, '')
    const f = fold(word)
    if (NOT_NAMES.has(f) || f.length < 3) continue
    if (!src.includes(f)) out.add(word)
  }
  return [...out]
}

/**
 * What the chat shows for a synthesized live answer: the answer when every name in it is in the
 * results ('' otherwise — the caller then shows the hits), with the stale-results note in front when
 * the search had to fall back to older, unfiltered results.
 */
export function groundedLiveAnswer(answer: string, rawResults: string): string {
  if (!answer || unsupportedNames(answer, rawResults).length) return ''
  return rawResults.includes(STALE_RESULTS_NOTE) ? `${STALE_RESULTS_NOTE}\n\n${answer}` : answer
}
