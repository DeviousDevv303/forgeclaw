// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── NEXUS heuristics: the owner's rules of thumb, mined from what the owner types ─────
// NEXUS reads the owner's own prompts (never visitors': they are excluded, so nobody else can plant a rule),
// picks out rule-shaped statements ("always…", "never…", "don't…", "make sure…", "I want…", "prefer…",
// "if…then…", or an explicit "rule:" / "heuristic:"), and counts how often each recurs. A recurring or explicit
// rule becomes a candidate heuristic. Nothing reaches a model until the owner approves it on the NEXUS page;
// approved heuristics are then given to every model as the owner's operating rules.

import type { LearningCandidate } from './corpus'
import { isVisitorCandidate } from './nexusLearning'

export interface HeuristicCandidate {
  /** Normalized rule text (the identity of the heuristic). */
  rule: string
  /** How many separate prompts stated it. */
  count: number
  /** Stated with an explicit "rule:" / "heuristic:" prefix. */
  explicit: boolean
  /** Up to three original phrasings. */
  examples: string[]
  lastSeen: string
}

export const MIN_RECURRENCE = 2
const MAX_RULE_CHARS = 160
const MAX_PROMPT_HEURISTICS = 12

const EXPLICIT_RE = /^\s*(?:rule|heuristic)\s*:\s*(.+)$/i
// A sentence that states how things should be done, possibly after a softener ("also", "please", "and").
const DIRECTIVE_RE = /^(?:(?:ok(?:ay)?|yeah|yes|alright|bro|and|also|so|please|just|but|then),?\s+)*((?:always|never|don'?t|do not|make sure|ensure|prefer|avoid|only|no more|stop)\b.+|i (?:want|need|prefer|don'?t want|do not want|expect)\b.+|(?:if|when)\b.+?,?\s+(?:then\s+)?\S.+)$/i

/** Lower-case, unify quotes and spacing, drop trailing punctuation, cap length: the same rule groups together. */
export function normalizeRule(text: string): string {
  return text.toLowerCase()
    .replace(/[’‘]/g, "'").replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/[\s.!?;,:]+$/, '')
    .trim()
    .slice(0, MAX_RULE_CHARS)
}

/** Rule-shaped statements in one prompt, with whether each was explicit. */
export function extractRules(prompt: string): Array<{ rule: string; original: string; explicit: boolean }> {
  const out: Array<{ rule: string; original: string; explicit: boolean }> = []
  const seen = new Set<string>()
  for (const line of prompt.split(/\n+/)) {
    const explicit = EXPLICIT_RE.exec(line)
    const pieces = explicit ? [explicit[1]] : line.split(/(?<=[.!?])\s+/)
    for (const piece of pieces) {
      const original = piece.trim()
      if (original.length < 8) continue
      const match = explicit ? original : DIRECTIVE_RE.exec(original)?.[1]
      if (!match) continue
      const rule = normalizeRule(match)
      if (rule.length < 8 || seen.has(rule)) continue
      seen.add(rule)
      out.push({ rule, original: original.slice(0, MAX_RULE_CHARS), explicit: Boolean(explicit) })
    }
  }
  return out
}

function isOwnerPrompt(c: LearningCandidate): boolean {
  if (isVisitorCandidate(c)) return false
  const actor = c.metadata?.actor ?? /(?:^|; )actor=([^;]+)/.exec(c.context || '')?.[1] ?? 'user'
  const channel = c.metadata?.channel ?? ''
  return actor === 'user' && (channel === 'chat' || channel === 'voice' || channel === '')
}

/** Candidate heuristics from the owner's prompts: recurring (≥ MIN_RECURRENCE prompts) or explicit. */
export function mineHeuristics(candidates: LearningCandidate[]): HeuristicCandidate[] {
  const byRule = new Map<string, HeuristicCandidate>()
  for (const c of candidates) {
    if (!isOwnerPrompt(c)) continue
    for (const { rule, original, explicit } of extractRules(c.input || '')) {
      const h = byRule.get(rule) ?? { rule, count: 0, explicit: false, examples: [], lastSeen: c.timestamp }
      h.count += 1
      h.explicit ||= explicit
      if (h.examples.length < 3 && !h.examples.includes(original)) h.examples.push(original)
      if (c.timestamp > h.lastSeen) h.lastSeen = c.timestamp
      byRule.set(rule, h)
    }
  }
  return [...byRule.values()]
    .filter(h => h.explicit || h.count >= MIN_RECURRENCE)
    .sort((a, b) => Number(b.explicit) - Number(a.explicit) || b.count - a.count || b.lastSeen.localeCompare(a.lastSeen))
}

// ─── Owner decisions (this browser only; the NEXUS tab is owner-only) ─────────
const DECISIONS_KEY = 'nexus_heuristics_v1'
export interface HeuristicDecisions { approved: string[]; rejected: string[] }

export function loadDecisions(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): HeuristicDecisions {
  try {
    const parsed = JSON.parse(storage?.getItem(DECISIONS_KEY) || '{}') as Partial<HeuristicDecisions>
    return { approved: Array.isArray(parsed.approved) ? parsed.approved.filter(r => typeof r === 'string') : [], rejected: Array.isArray(parsed.rejected) ? parsed.rejected.filter(r => typeof r === 'string') : [] }
  } catch {
    return { approved: [], rejected: [] }
  }
}

export function decide(rule: string, decision: 'approve' | 'reject' | 'forget', storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.localStorage): HeuristicDecisions {
  const d = loadDecisions(storage)
  const next: HeuristicDecisions = { approved: d.approved.filter(r => r !== rule), rejected: d.rejected.filter(r => r !== rule) }
  if (decision === 'approve') next.approved.push(rule)
  if (decision === 'reject') next.rejected.push(rule)
  try { storage?.setItem(DECISIONS_KEY, JSON.stringify(next)) } catch { /* not persisted */ }
  return next
}

/** System-prompt block of the owner's approved heuristics; empty when none are approved. */
export function heuristicsForPrompt(decisions: HeuristicDecisions = loadDecisions()): string {
  const rules = decisions.approved.slice(0, MAX_PROMPT_HEURISTICS)
  if (!rules.length) return ''
  return "OWNER HEURISTICS (the owner's own rules, approved by the owner; follow them unless they conflict with safety rules or the owner's current request):\n" +
    rules.map(r => `- ${r}`).join('\n')
}
