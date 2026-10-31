// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

/**
 * Live-data fast path (agent: Claude Sonnet 5.5, at operator request).
 *
 * Questions about the outside world right now ("any UFC fights tonight?", "weather today?") cannot
 * be answered by the Qwen/Qwen3-8B workflow: it runs on a CPU runner (9-23 minutes per hop), has no
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
const KALSHI_MENTION = /\bkalshi\b/i
// Words that frame a Kalshi question but never appear in a market title. kalshi_markets matches a
// query by requiring EVERY word to appear in the title/ticker, so the query built from a question
// keeps only content words (capped at 3) — a zero-match answer says so and advises fewer words.
const KALSHI_STOPWORDS = new Set([
  'what', 'whats', 'does', 'do', 'did', 'is', 'are', 'was', 'were', 'will', 'would', 'can', 'could', 'should',
  'the', 'a', 'an', 'about', 'say', 'says', 'said', 'on', 'for', 'of', 'to', 'in', 'at', 'by', 'kalshi',
  'price', 'prices', 'priced', 'odds', 'chance', 'chances', 'probability', 'implied', 'tonight', 'today',
  'tomorrow', 'now', 'currently', 'right', 'show', 'tell', 'please', 'any', 'there', 'this', 'that',
  'game', 'games', 'match', 'matches', 'fight', 'fights', 'event', 'events', 'market', 'markets',
  'contract', 'contracts', 'think', 'prediction', 'predictions',
])

/** The kalshi_markets query for a question: its content words, or '' when the question names no topic. */
export function buildKalshiQuery(text: string): string {
  const words = text.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)
    .filter(w => w.length >= 3 && !KALSHI_STOPWORDS.has(w))
  return [...new Set(words)].slice(0, 3).join(' ')
}

/** True for a short question that asks about Kalshi itself — those belong to the live kalshi_markets API, never to web search or model memory. */
export function isKalshiQuestion(text: string): boolean {
  const t = text.trim()
  if (!t || t.length > MAX_QUESTION_CHARS || t.includes('\n')) return false
  if (SELF_OR_CODE.test(t)) return false
  if (!ASKING.test(t)) return false
  return KALSHI_MENTION.test(t)
}

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

/** A direct live-data call for a live-data question, or null to leave the prompt on the normal path. */
export function routeLiveDataQuestion(text: string, now: Date = new Date()): ExplicitToolCall | null {
  // Kalshi questions go to the live Kalshi API FIRST: the generic topic gate below sends some of
  // them to web_search ("what does Kalshi say about the election?") and lets others fall through
  // to the model, which then invents prices from training memory. kalshi_markets reads the live
  // exchange and fails by name when it cannot.
  if (isKalshiQuestion(text)) {
    const query = buildKalshiQuery(text)
    return {
      name: 'kalshi_markets',
      input: { ...(query ? { query } : {}), limit: 10 },
      notes: ['Kalshi question answered by the live kalshi_markets API, not web search'],
    }
  }
  if (!isLiveDataQuestion(text)) return null
  // Weather gets a real forecast (weather.ts); search snippets only carry links, not the numbers.
  const place = isWeatherQuestion(text) ? extractPlace(text) : ''
  if (place) {
    const day = requestedDay(text)
    return { name: 'weather_forecast', input: { place, ...(day !== null ? { day } : {}) }, notes: ['weather question answered by the Open-Meteo forecast'] }
  }
  const query = buildLiveSearchQuery(text, now)
  if (!query) return null
  return {
    name: 'web_search',
    input: { query, count: 5 },
    notes: ['live-data question answered directly by web search; the Qwen/Qwen3-8B workflow takes 9-23 minutes per step and has no live data'],
  }
}
