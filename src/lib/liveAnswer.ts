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

/** The instructions the synthesis hop runs under: the answer, from the results, nothing else. */
export const LIVE_ANSWER_INSTRUCTIONS = [
  'Answer the question using ONLY facts from the live search results below.',
  'Answer directly and plainly: start with the answer itself — no preamble, no buildup.',
  'Use ONLY facts from the results. Never mention the search, the results, sources, or tools.',
  'Several results may disagree or be about different dates: prefer the most recent result.',
  'A result from before the day the question asks about does not answer a question about that day.',
  'If the results do not contain the answer, say so in one sentence and give the closest fact they do contain.',
].join('\n')

/** The deepseek_reason task for the synthesis hop: instructions + the question + the raw hits. */
export function buildLiveAnswerTask(question: string, rawResults: string): string {
  return `${LIVE_ANSWER_INSTRUCTIONS}\n\nQuestion: ${question}\n\nLive search results:\n${rawResults}`
}

/** The synthesis task for a hand-typed web_search call: there is no question, so summarize the hits. */
export function buildSearchSummaryTask(query: string, rawResults: string): string {
  return `${LIVE_ANSWER_INSTRUCTIONS}\n\nRequest: Summarize the web search results for "${query}".\n\nLive search results:\n${rawResults}`
}

/**
 * The answer text inside a deepseek_reason tool output. forgeTools formats a success as
 * "✓ Qwen/Qwen3-8B completed as <id> on <owner>/<repo>@<ref>.\n<Stages>\nRun: <url>\n\n<result>"
 * — the answer is everything after the first blank line (the same split providerRouter uses).
 * Returns '' when there is no answer body.
 */
export function extractDeepSeekAnswer(toolOutput: string): string {
  const splitAt = toolOutput.indexOf('\n\n')
  const body = splitAt >= 0 ? toolOutput.slice(splitAt + 2) : toolOutput
  return stripReasoningArtifacts(body).trim()
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
