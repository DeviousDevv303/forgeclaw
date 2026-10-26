// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── NEXUS before/after harness: the cases ──────────────────────────────────────────────────────────────
// Each case is one rule the owner could teach NEXUS, a task that does NOT mention the rule, and a mechanical check of
// whether the answer followed it. The rule lives only in the guidance, so the "off" arm has no way to know it: a
// difference between arms is the guidance's effect, nothing else. Checks are deliberately objective (no model judge,
// no vibes). Rules are ones a model does not follow by default, so the off arm sits well below the ceiling.

export interface AbCase {
  id: string
  /** The rule as the owner would teach it; this exact text is the only place it appears. */
  rule: string
  /** A task that never mentions the rule and, on purpose, shares few words with it (the dispatch overlap-rule case). */
  task: string
  check: (answer: string) => boolean
}

const lines = (answer: string): string[] => answer.split('\n').map(line => line.trim()).filter(Boolean)
const words = (answer: string): number => answer.trim().split(/\s+/).filter(Boolean).length

export const AB_CASES: readonly AbCase[] = [
  {
    id: 'tldr-first-line',
    rule: 'Begin every answer with one line that starts with "TL;DR:".',
    task: 'Explain how a hash table handles collisions.',
    check: answer => (lines(answer)[0] ?? '').startsWith('TL;DR:'),
  },
  {
    id: 'sign-off-line',
    rule: 'End every answer with the exact final line "— ForgeClaw".',
    task: 'Write a short poem about cats.',
    check: answer => lines(answer).at(-1) === '— ForgeClaw',
  },
  {
    id: 'forty-words',
    rule: 'Keep every answer to 40 words or fewer.',
    task: 'Describe what happens to a request between typing a URL and seeing the page.',
    check: answer => answer.trim().length > 0 && words(answer) <= 40,
  },
  {
    id: 'numbered-only',
    rule: 'Write answers only as a numbered list, one item per line, with no other paragraphs.',
    task: 'Why do people sleep worse when they look at screens late at night?',
    check: answer => { const l = lines(answer); return l.length > 0 && l.every(line => /^\d+[.)]\s/.test(line)) },
  },
  {
    id: 'all-lowercase',
    rule: 'Write every answer entirely in lowercase letters.',
    task: 'Give me three tips for running my first 5k.',
    check: answer => answer.trim().length > 0 && answer === answer.toLowerCase(),
  },
  {
    id: 'no-the-word',
    rule: 'Never use the word "very" in an answer.',
    task: 'Tell me about the Pacific Ocean in a couple of paragraphs.',
    check: answer => answer.trim().length > 0 && !/\bvery\b/i.test(answer),
  },
]
