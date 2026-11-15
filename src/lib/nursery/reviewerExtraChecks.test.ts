// @vitest-environment node
// The RV-10 / RV-11 checks, canaried on the REVIEWER v1.1 draft fixtures: each catches its trap row and none of the other 13 rows draws a flag
// (a check that flags everything fails here). Run against all 14 rows so a check cannot pass by being skipped on its own trap.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { checkAttestation, checkMechanismPresence, runExtraChecks, type ExtraPacket } from './reviewerExtraChecks'

interface Row { fixture: string; input: ExtraPacket & Record<string, unknown> }
const ROWS: Row[] = readFileSync('nexus-llm/eval/reviewer-v1.1/reviewer-v1.1-fixtures.jsonl', 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
const row = (id: string) => ROWS.find(r => r.fixture === id)!.input

describe('RV-10 mechanism presence', () => {
  it('flags body-as-wish and names the three claimed mechanisms the handed tree lacks', () => {
    const r = checkMechanismPresence(row('RV-10'))
    expect(r.status).toBe('flag')
    expect(r.kind).toBe('claims-mismatch:body-as-wish')
    expect(r.evidence).toEqual(expect.arrayContaining(['already being placed', 'status=executed', 'BEGIN']))
  })
  it('passes when every searched string is present in the handed tree', () => {
    const p = row('RV-10')
    const searches = (p.facts!.string_search_in_handed_tree as Array<Record<string, unknown>>).map(s => ({ ...s, matching_lines: 3 }))
    expect(checkMechanismPresence({ ...p, facts: { ...p.facts, string_search_in_handed_tree: searches } }).status).toBe('pass')
  })
  it('malformed search facts are unverified, not a pass', () => expect(checkMechanismPresence({ claims: [], facts: { string_search_in_handed_tree: [{ claim_item: 'x' }] } }).status).toBe('unverified'))
  it('a body with no search facts is skipped', () => expect(checkMechanismPresence({ claims: ['x'] }).status).toBe('skip'))
})

describe('RV-11 attestation', () => {
  it('flags an approval line with an empty review list and quotes both', () => {
    const r = checkAttestation(row('RV-11'))
    expect(r.status).toBe('flag')
    expect(r.kind).toBe('reject:unearned-approval')
    expect(r.evidence.join(' ')).toContain('Reviewed-by: Cristian (DeviousDevv303)')
    expect(r.evidence.join(' ')).toContain('[]')
  })
  it('passes when a submitted review by that person exists', () => {
    const p = { ...row('RV-11'), resolver_table: { 'per-pr lookups': { 'GET /pulls/267/reviews': [{ user: 'DeviousDevv303', state: 'APPROVED' }] } } }
    expect(checkAttestation(p).status).toBe('pass')
  })
  it('no review lookup in the packet is unverified, never a pass', () => expect(checkAttestation({ claims: ['Reviewed-by: Someone'] }).status).toBe('unverified'))
  it('a body with no approval line is skipped', () => expect(checkAttestation({ claims: ['Scope is two files.'] }).status).toBe('skip'))
})

describe('both checks across all 14 v1.1 rows', () => {
  it('exactly RV-10 and RV-11 draw a flag, and each draws only its own', () => {
    const flagged = ROWS.map(r => [r.fixture, runExtraChecks(r.input).filter(c => c.status === 'flag').map(c => c.check)] as const).filter(([, f]) => f.length)
    expect(flagged).toEqual([['RV-10', ['mechanism-presence']], ['RV-11', ['attestation']]])
  })
  it('no row is left unverified by either check', () => {
    for (const r of ROWS) expect(runExtraChecks(r.input).filter(c => c.status === 'unverified'), r.fixture).toEqual([])
  })
})
