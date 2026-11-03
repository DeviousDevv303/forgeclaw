// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
/**
 * REVIEWER denomination check (DRAFT instrument; held-out probe HP-05, defect D-018; the grading seat named the verdict kind
 * `claims-mismatch:denomination`, #235 6591250897). It grades a stated cost against the order record; it never edits one and
 * nothing wires.
 *
 * The rule, as the seat's spec states it: for side NO and an order sent as an ask at price p, the per-contract cost of the position
 * is 1 − p, so a stated NO cost equal to p is a denomination mismatch. D-018's own trace: NO proposal 0.40, order ask at 0.59,
 * fill average 0.59 for 59 contracts, and the reply and ledger said 0.59 / $34.81 where the true figures are 0.41 / $24.19.
 *
 * Scope, stated now: only the pattern in the spec is judged. Any other side or order type is `skip` (the check has no rule for it,
 * and inventing one would turn a gap into a false verdict). A claim whose figures cannot be parsed, or that matches neither the
 * order price nor its complement, is `unverified`, never a pass.
 */

export interface DenominationFacts {
  side?: string
  order_sent?: { price?: number; type?: string }
  venue_response?: { average_fill_price?: number; fill_count?: number }
}

export interface DenominationPacket {
  claims: string[]
  facts?: DenominationFacts
}

export interface DenominationResult {
  check: 'denomination'
  status: 'flag' | 'pass' | 'skip' | 'unverified'
  kind?: 'claims-mismatch:denomination'
  /** Strings copied from the packet or computed from its numbers, which carry the finding. */
  evidence: string[]
}

const EPS = 0.005
const near = (a: number, b: number) => Math.abs(a - b) < EPS
const money = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`
const res = (status: DenominationResult['status'], evidence: string[] = [], kind?: DenominationResult['kind']): DenominationResult =>
  ({ check: 'denomination', status, ...(kind ? { kind } : {}), evidence })

/** Pulls "bought N SIDE ... at $P ... - $TOTAL" out of a claim (fees after the total are not part of it). */
function parseClaim(claim: string): { count: number; unit: number; total: number } | null {
  const m = /bought\s+(\d+)\s+(?:YES|NO)\b[^$]*?at\s+\$(\d+(?:\.\d+)?)[^$]*?[-–—]\s*\$(\d+(?:\.\d+)?)/i.exec(claim)
  return m ? { count: Number(m[1]), unit: Number(m[2]), total: Number(m[3]) } : null
}

export function checkDenomination(p: DenominationPacket): DenominationResult {
  const f = p.facts
  const price = f?.order_sent?.price
  if (!f || typeof price !== 'number' || !f.side || !f.order_sent?.type) return res('unverified')
  if (f.side.toUpperCase() !== 'NO' || f.order_sent.type.toLowerCase() !== 'ask') return res('skip')
  const claim = p.claims.find(c => parseClaim(c))
  const parsed = claim ? parseClaim(claim) : null
  if (!claim || !parsed) return res('unverified')
  const trueUnit = 1 - price
  const trueTotal = parsed.count * trueUnit
  const statesOrderPrice = near(parsed.unit, price) && near(parsed.total, parsed.count * price)
  const statesTrueCost = near(parsed.unit, trueUnit) && near(parsed.total, trueTotal)
  if (near(price, trueUnit)) return res('skip') // p = 0.50: the two denominations coincide, so the rule cannot discriminate
  if (statesTrueCost) return res('pass', [claim])
  if (statesOrderPrice) return res('flag', [claim, `per-contract cost 1 - ${price} = ${trueUnit.toFixed(2)}`, `${parsed.count} contracts cost ${money(trueTotal)}`], 'claims-mismatch:denomination')
  return res('unverified', [claim])
}
