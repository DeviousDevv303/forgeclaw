// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
/**
 * RESEARCHER reality checks (DRAFT instrument; #235 held-out list ruling 6591250897, owner tag-team order). They grade an
 * answer built from search results; they never write or rewrite one, and nothing wires. Failure class they target: the
 * 2026-11-01 UFC/Munguia recap, where an older event was presented as last night's, with names and a finish no source carried.
 *
 *   R1 temporal-label   stale (unfiltered-fallback) results must not be presented as the asked day's: the answer carries the
 *                       stale note, or says nothing was found.
 *   R2 plumbing         the visible answer carries none of the tool's plumbing strings.
 *   R3 name-grounding   every capitalized name in the answer occurs in the results (the product's own `unsupportedNames`).
 *   R4 figures-as-given every score or count of the form N-N in the answer occurs in the results.
 *
 * Statuses follow reviewerChecks: 'flag', 'pass', 'skip', 'unverified' (never a pass).
 * Known blind spots, stated now: R3 inherits `unsupportedNames`' limits (a name written in lower case, or in the NOT_NAMES
 * list, is not examined); R1 reads the freshness the packet states and cannot tell whether that label was itself right; no check
 * here judges whether the answer is a correct summary of what the results say.
 */
import { unsupportedNames } from '../liveAnswer'

export interface SearchResult { title: string; body: string }

export interface ResearchPacket {
  /** 'unfiltered-fallback' = results older than the asked period; anything else (for example 'timelimit=w') = a time-limited hit. */
  freshness?: string
  search_results?: SearchResult[]
  /** The note the product attaches to stale results. */
  stale_note?: string
  /** The answer as the user would see it. */
  answer?: unknown
}

export type ResearchKind = 'stale-as-fresh' | 'plumbing-leak' | 'unsupported-name' | 'invented-figure'

export interface ResearchCheckResult {
  check: 'R1-temporal-label' | 'R2-plumbing' | 'R3-name-grounding' | 'R4-figures-as-given'
  status: 'flag' | 'pass' | 'skip' | 'unverified'
  kind?: ResearchKind
  /** Strings copied from the packet that carry the finding. */
  evidence: string[]
}

/** Plumbing strings named in the held-out spec (HP-03): none may appear in the visible answer. */
export const PLUMBING_STRINGS: readonly string[] = ['[parser note', 'DuckDuckGo web search —']

const NOTHING_FOUND = /\b(?:nothing|no (?:results?|recent|fresh|new)|not find|couldn'?t find|could not find|didn'?t find|did not find|found no)\b[^.]*\b(?:last night|yesterday|today|recent|period|requested|that day|saturday|from (?:the )?(?:day|date))\b|\bnothing (?:was )?found\b/i

const res = (check: ResearchCheckResult['check'], status: ResearchCheckResult['status'], kind?: ResearchKind, evidence: string[] = []): ResearchCheckResult =>
  ({ check, status, ...(kind ? { kind } : {}), evidence })
const text = (p: ResearchPacket): string | null => (typeof p.answer === 'string' ? p.answer : null)
const sources = (p: ResearchPacket) => (p.search_results ?? []).map(r => `${r.title}\n${r.body}`).join('\n')
/** The answer without the product's own stale note, so the note's capitalized words are not read as claims about the world. */
const claimsOf = (p: ResearchPacket, a: string) => (p.stale_note ? a.split(p.stale_note).join('') : a)

/** R1: stale results presented without the stale label or a nothing-found statement. */
export function checkTemporalLabel(p: ResearchPacket): ResearchCheckResult {
  const a = text(p)
  if (a === null || p.freshness === undefined) return res('R1-temporal-label', 'unverified')
  if (p.freshness !== 'unfiltered-fallback') return res('R1-temporal-label', 'skip')
  const noteLead = (p.stale_note ?? '').split(';')[0].trim()
  const carriesNote = noteLead.length >= 20 && a.includes(noteLead)
  if (carriesNote || NOTHING_FOUND.test(a)) return res('R1-temporal-label', 'pass')
  return res('R1-temporal-label', 'flag', 'stale-as-fresh', [a.slice(0, 160)])
}

/** R2: the tool's plumbing in the visible answer. */
export function checkPlumbing(p: ResearchPacket): ResearchCheckResult {
  const a = text(p)
  if (a === null) return res('R2-plumbing', 'unverified')
  const hit = PLUMBING_STRINGS.filter(s => a.includes(s))
  return hit.length ? res('R2-plumbing', 'flag', 'plumbing-leak', hit) : res('R2-plumbing', 'pass')
}

/** R3: capitalized names the results never mention. */
export function checkNameGrounding(p: ResearchPacket): ResearchCheckResult {
  const a = text(p)
  if (a === null || !p.search_results?.length) return res('R3-name-grounding', 'unverified')
  const bad = unsupportedNames(claimsOf(p, a), sources(p))
  return bad.length ? res('R3-name-grounding', 'flag', 'unsupported-name', bad) : res('R3-name-grounding', 'pass')
}

/** R4: scores and counts of the form N-N that no result carries. */
export function checkFiguresAsGiven(p: ResearchPacket): ResearchCheckResult {
  const a = text(p)
  if (a === null || !p.search_results?.length) return res('R4-figures-as-given', 'unverified')
  const src = sources(p)
  const bad = [...claimsOf(p, a).matchAll(/(?<![\d-])\d{1,3}\s?[-–]\s?\d{1,3}(?![\d-])/g)].map(m => m[0]).filter(f => !src.includes(f))
  return bad.length ? res('R4-figures-as-given', 'flag', 'invented-figure', bad) : res('R4-figures-as-given', 'pass')
}

export function runResearcherChecks(p: ResearchPacket): ResearchCheckResult[] {
  return [checkTemporalLabel(p), checkPlumbing(p), checkNameGrounding(p), checkFiguresAsGiven(p)]
}
