// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

/**
 * Live-data fast path (agent: Claude Sonnet 5.5, at operator request).
 *
 * Questions about the outside world right now ("any UFC fights tonight?", "weather today?") cannot
 * be answered by the 16B DeepSeek workflow: it runs on a CPU runner (9-23 minutes per hop), has no
 * live data, and a second hop is needed if it asks for a search. This module recognizes those
 * questions conservatively so the app can run web_search directly and show the results.
 *
 * Deliberately narrow: it must look like a question AND mention a live-world topic, and anything
 * that sounds like ForgeClaw/code/repo work is left on the normal path. A miss costs nothing (the
 * normal model path still runs); a false hit costs one cheap, read-only search.
 */

import type { ExplicitToolCall } from './codingAgentRuntime'
import { extractPlace, isWeatherQuestion, requestedDay } from './weather'

const MAX_QUESTION_CHARS = 240

const SELF_OR_CODE = /\b(forgeclaw|forge|repo|repository|branch|commit|pull request|workflow|github|codebase|source code|typescript|function|bug|deploy|nexus|corpus|codex|guardian|shell|tool|prompt|model|api key)\b/i
const ASKING = /^(?:\s*(?:hey|hi|yo|ok|okay|so|please)[,\s]+)*(?:is|are|was|were|will|does|do|did|can|could|what|whats|what's|when|who|whos|who's|where|which|how|any|tell me|show me|find|search|look up|check)\b|\?\s*$/i
const TIME_WORD = /\b(tonight|today|tomorrow|this (?:week|weekend|morning|afternoon|evening)|right now|currently|latest|live|current|upcoming|next (?:fight|game|match|race|event)|who won|final score)\b/i
const LIVE_TOPIC = /\b(ufc|mma|boxing|nfl|nba|mlb|nhl|wnba|ncaa|soccer|premier league|champions league|formula 1|f1|nascar|fight|fights|game|games|match|matches|schedule|scores?|standings|weather|forecast|temperature|stocks?|price|prices|news|headlines?|showtimes?|concerts?|events?)\b/i
// Topics that are live on their own, with no time word needed.
const ALWAYS_LIVE = /\b(weather|forecast|standings|scores?|headlines?)\b/i

export function isLiveDataQuestion(text: string): boolean {
  const t = text.trim()
  if (!t || t.length > MAX_QUESTION_CHARS || t.includes('\n')) return false
  if (SELF_OR_CODE.test(t)) return false
  if (!ASKING.test(t)) return false
  if (!LIVE_TOPIC.test(t)) return false
  return TIME_WORD.test(t) || ALWAYS_LIVE.test(t)
}

function dateLabel(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

/** Turn the question into a search query; relative day words get the real date so the search is not ambiguous. */
export function buildLiveSearchQuery(text: string, now: Date = new Date()): string {
  let query = text.trim()
    .replace(/^(?:\s*(?:hey|hi|yo|ok|okay|so|please)[,\s]+)+/i, '')
    .replace(/^(?:can you|could you|tell me|show me|find|search(?: for)?|look up|check|do you know|i want to know)\b[,:\s]*/i, '')
    .replace(/[?!.\s]+$/, '')
    .replace(/\s+/g, ' ')
  if (/\b(tonight|today|right now)\b/i.test(query)) query = `${query} ${dateLabel(now)}`
  else if (/\btomorrow\b/i.test(query)) query = `${query} ${dateLabel(new Date(now.getTime() + 24 * 60 * 60 * 1000))}`
  return query.slice(0, 280)
}

/** A web_search call for a live-data question, or null to leave the prompt on the normal path. */
export function routeLiveDataQuestion(text: string, now: Date = new Date()): ExplicitToolCall | null {
  if (!isLiveDataQuestion(text)) return null
  // Weather gets a real forecast (weather.ts); search snippets only carry links, not the numbers.
  const place = isWeatherQuestion(text) ? extractPlace(text) : ''
  if (place) {
    const day = requestedDay(text)
    return { name: 'weather_forecast', input: { place, ...(day !== null ? { day: String(day) } : {}) }, notes: ['weather question answered by the Open-Meteo forecast'] }
  }
  const query = buildLiveSearchQuery(text, now)
  if (!query) return null
  return {
    name: 'web_search',
    input: { query, count: '5' },
  }
}
