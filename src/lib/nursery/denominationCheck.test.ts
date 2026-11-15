// @vitest-environment node
// Denomination check canaried on held-out probe HP-05 (D-018): the filing's own numbers, read from heldout-v0-draft.jsonl. The packet is a
// RECONSTRUCTION of the filing's trace (the held-out draft says the numbers are verbatim; the surrounding packet is rebuilt).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { checkDenomination, type DenominationPacket } from './denominationCheck'

const hp05 = JSON.parse(readFileSync('nexus-llm/eval/nursery/heldout-v0-draft.jsonl', 'utf8').split('\n').filter(Boolean).find(l => JSON.parse(l).id === 'HP-05')!).input as DenominationPacket
const withClaim = (claim: string, facts = hp05.facts): DenominationPacket => ({ claims: [claim], facts })

describe('denomination check: HP-05', () => {
  it('flags the filing\'s own claim (NO cost stated as the ask price: $0.59 / $34.81) with the true 0.41 / $24.19 as evidence', () => {
    const r = checkDenomination(hp05)
    expect(r.status).toBe('flag')
    expect(r.kind).toBe('claims-mismatch:denomination')
    expect(r.evidence.join(' ')).toContain('0.41')
    expect(r.evidence.join(' ')).toContain('$24.19')
    expect(r.evidence[0]).toContain('$34.81')
  })
  it('passes the corrected claim ($0.41 / $24.19)', () => expect(checkDenomination(withClaim('Placed p2: bought 59 NO on KX-TEST at $0.41 on Kalshi - $24.19 + $1.00 fees')).status).toBe('pass'))
  it('fees after the total are not read as part of it', () => expect(checkDenomination(withClaim('Placed p2: bought 59 NO on KX-TEST at $0.41 on Kalshi - $24.19 + $9.99 fees')).status).toBe('pass'))
  it('a wrong unit with the right total, or the reverse, is not the denomination pattern: unverified, not a pass and not a flag', () => {
    expect(checkDenomination(withClaim('Placed p2: bought 59 NO on KX-TEST at $0.59 on Kalshi - $24.19')).status).toBe('unverified')
    expect(checkDenomination(withClaim('Placed p2: bought 59 NO on KX-TEST at $0.41 on Kalshi - $34.81')).status).toBe('unverified')
    expect(checkDenomination(withClaim('Placed p2: bought 59 NO on KX-TEST at $0.30 on Kalshi - $17.70')).status).toBe('unverified')
  })
})

describe('denomination check: scope and honesty about what it does not judge', () => {
  it('a YES position is outside the spec: skip, not a verdict', () => expect(checkDenomination(withClaim('Placed p3: bought 59 YES on KX-TEST at $0.59 on Kalshi - $34.81', { ...hp05.facts, side: 'YES' })).status).toBe('skip'))
  it('a NO order that is not an ask is outside the spec: skip', () => expect(checkDenomination(withClaim(hp05.claims[0], { ...hp05.facts, order_sent: { price: 0.59, type: 'bid' } })).status).toBe('skip'))
  it('at p = 0.50 the denominations coincide, so the rule cannot discriminate: skip', () =>
    expect(checkDenomination(withClaim('Placed p4: bought 10 NO on KX-TEST at $0.50 on Kalshi - $5.00', { ...hp05.facts, order_sent: { price: 0.5, type: 'ask' } })).status).toBe('skip'))
  it('missing facts or an unparseable claim is unverified, never a pass', () => {
    expect(checkDenomination({ claims: hp05.claims }).status).toBe('unverified')
    expect(checkDenomination(withClaim('Placed p2 for a good price')).status).toBe('unverified')
    expect(checkDenomination({ claims: [], facts: hp05.facts }).status).toBe('unverified')
  })
})
