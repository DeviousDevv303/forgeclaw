// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Questions about what is current ─────────────────────────────────────────
// Models only know what they were trained on (Qwen3-8B: roughly 2024-2025). 2026-10-20: "what's the
// latest in tech" was answered from memory (GPT-4, Claude 3, Llama 3) because nothing marked it as a
// question about the present. Such questions are now answered from gathered sources, and every model is
// told today's date so it can say when its own knowledge may be out of date.

// Words that ask what is new. Not "today"/"right now": "a workout for today" is not a news question
// (live sports/weather "tonight/now" questions have their own web_search fast path, liveDataRouting.ts).
// Just-past phrasings (yesterday, last night, this morning, overnight) DO belong here: they ask about
// completed events after the model's training cutoff, which it otherwise answers from memory as if current.
const RECENCY = /\b(latest|newest|recent(?:ly)?|yesterday|last night|this morning|overnight|this year|so far this year|state of the art|cutting[- ]edge|what'?s new|what is new|new in|news|trending|current state|20(?:2[5-9]|3\d))\b/i
// Work on ForgeClaw itself or on code is answered from the repository, not the web.
const SELF_OR_CODE = /\b(forgeclaw|repo|repository|branch|commit|pull request|workflow|codebase|source code|this file|my code|your code|nexus|guardian)\b/i

/** True for a question whose honest answer depends on what is true now rather than on model memory. */
export function needsCurrentInfo(text: string): boolean {
  const t = text.trim()
  if (!t || t.length > 600 || SELF_OR_CODE.test(t)) return false
  return RECENCY.test(t)
}

export function todayLabel(now: Date = new Date()): string {
  return now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

/** One line every model gets: the real date, and that its built-in knowledge may be out of date. */
export function currentDateNote(now: Date = new Date()): string {
  return `Today's date is ${todayLabel(now)}. Your built-in knowledge stops at your training cutoff and may be out of date: ` +
    'for anything recent, rely on sources gathered in this conversation, and if you have none, say plainly that your information may be outdated ' +
    'instead of presenting it as current.'
}
