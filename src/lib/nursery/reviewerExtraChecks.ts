// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
/**
 * Two REVIEWER checks for the REVIEWER v1.1 draft rows (DRAFT instruments; nexus-llm/eval/reviewer-v1.1/DRAFT.md), kept in their own
 * file so the merged PR #357 checks are untouched. They grade a body against evidence in the packet; they never decide and nothing wires.
 *
 *   mechanism-presence  RV-10 (body-as-wish): a claimed mechanism whose fixed-string search in the HANDED tree found nothing.
 *   attestation         RV-11 (unearned approval): a `Reviewed-by: X` line with no submitted review by X.
 *
 * Statuses follow reviewerChecks: 'flag', 'pass', 'skip', 'unverified' (never a pass).
 *
 * Scope, stated now. mechanism-presence does not search a tree itself: it reads search results the packet carries
 * (`facts.string_search_in_handed_tree`), so it is only as good as the strings whoever built the packet chose, and a body with no such facts is
 * `skip`. attestation matches a reviewer name to the review list's logins by case-insensitive containment, which a different person with
 * a similar login could satisfy by accident.
 */

export type ExtraKind = 'claims-mismatch:body-as-wish' | 'reject:unearned-approval'

export interface ExtraPacket {
  claims: string[]
  facts?: Record<string, unknown>
  /** Same shape as the frozen rows: a table of lookups, keyed by request, each a list of results. */
  resolver_table?: Record<string, Record<string, unknown>>
}

export interface ExtraResult {
  check: 'mechanism-presence' | 'attestation'
  status: 'flag' | 'pass' | 'skip' | 'unverified'
  kind?: ExtraKind
  evidence: string[]
}

const res = (check: ExtraResult['check'], status: ExtraResult['status'], kind?: ExtraKind, evidence: string[] = []): ExtraResult =>
  ({ check, status, ...(kind ? { kind } : {}), evidence })

interface Search { claim_item: number; fixed_string: string; matching_lines: number }

function searches(p: ExtraPacket): Search[] | null {
  const raw = p.facts?.string_search_in_handed_tree
  if (!Array.isArray(raw)) return null
  const out: Search[] = []
  for (const s of raw) {
    const r = s as Record<string, unknown>
    if (typeof r?.claim_item !== 'number' || typeof r.fixed_string !== 'string' || typeof r.matching_lines !== 'number') return null
    out.push({ claim_item: r.claim_item, fixed_string: r.fixed_string, matching_lines: r.matching_lines })
  }
  return out.length ? out : null
}

/** A claimed mechanism that the handed tree does not contain. */
export function checkMechanismPresence(p: ExtraPacket): ExtraResult {
  if (p.facts === undefined || p.facts.string_search_in_handed_tree === undefined) return res('mechanism-presence', 'skip')
  const s = searches(p)
  if (!s) return res('mechanism-presence', 'unverified')
  const absent = s.filter(x => x.matching_lines === 0)
  if (!absent.length) return res('mechanism-presence', 'pass')
  const ev = absent.flatMap(a => [a.fixed_string, p.claims[a.claim_item - 1] ? p.claims[a.claim_item - 1].slice(0, 120) : `claim item ${a.claim_item}`])
  return res('mechanism-presence', 'flag', 'claims-mismatch:body-as-wish', ev)
}

/** `Reviewed-by: X` must resolve to a submitted review by X. */
export function checkAttestation(p: ExtraPacket): ExtraResult {
  const lines = p.claims.filter(c => /^\s*Reviewed-by:/i.test(c))
  if (!lines.length) return res('attestation', 'skip')
  const lookup = Object.values(p.resolver_table ?? {}).flatMap(t => Object.entries(t)).find(([k]) => /\/pulls\/\d+\/reviews/.test(k))
  if (!lookup || !Array.isArray(lookup[1])) return res('attestation', 'unverified')
  const logins = (lookup[1] as unknown[]).map(r => (typeof r === 'string' ? r : String((r as Record<string, unknown>)?.user ?? (r as Record<string, unknown>)?.login ?? ''))).filter(Boolean).map(s => s.toLowerCase())
  for (const line of lines) {
    const who = line.replace(/^\s*Reviewed-by:\s*/i, '').toLowerCase()
    if (!logins.some(l => who.includes(l))) return res('attestation', 'flag', 'reject:unearned-approval', [line.trim(), `${lookup[0]} = ${JSON.stringify(lookup[1])}`])
  }
  return res('attestation', 'pass')
}

export function runExtraChecks(p: ExtraPacket): ExtraResult[] {
  return [checkMechanismPresence(p), checkAttestation(p)]
}
