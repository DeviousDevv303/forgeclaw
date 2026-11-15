// @vitest-environment node
// REVIEWER v1.1 DRAFT fixtures (nexus-llm/eval/reviewer-v1.1/reviewer-v1.1-fixtures.jsonl) against the PR #357 checks.
// Canary: the six controls must raise no flag and nothing unverified; the six v1 traps keep their flags; RV-10 and RV-11 are NOT
// caught by the six PR #357 checks (they skip), and this file records that. The mechanism-presence and attestation checks that do catch
// them live in reviewerExtraChecks.ts (their own canary file); if those six checks ever change to cover them, change these two tests on purpose.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { runReviewerChecks, type RefResolver, type ReviewPacket } from './reviewerChecks'

interface Row { fixture: string; input: Record<string, unknown>; expected_verdict: string; must_cite: string[] }
const ROWS: Row[] = readFileSync('nexus-llm/eval/reviewer-v1.1/reviewer-v1.1-fixtures.jsonl', 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
const CONTROLS = ['RV-01', 'RV-06', 'RV-09', 'RV-12', 'RV-13', 'RV-14']
const V1_TRAPS = ['RV-02', 'RV-03', 'RV-04', 'RV-05', 'RV-07', 'RV-08']

function packet(input: Record<string, unknown>): ReviewPacket {
  const rendered = Object.fromEntries(Object.entries(input).filter(([k, v]) => k.startsWith('rendered') && typeof v === 'string')) as Record<string, string>
  return { claims: input.claims as string[], diff: input.diff as string | undefined, facts: input.facts as Record<string, unknown> | undefined,
    code: input.code as string | undefined, rendered: Object.keys(rendered).length ? rendered : undefined }
}
function resolver(input: Record<string, unknown>): RefResolver | undefined {
  const table = (input.resolver_table as Record<string, unknown> | undefined)?.['per-comment lookups'] as Record<string, string> | undefined
  if (!table) return undefined
  return id => table[id] === 'exists' ? 'exists' : /404/.test(table[id] ?? '') ? 'missing' : 'unknown'
}
const run = (id: string) => { const r = ROWS.find(x => x.fixture === id)!; return runReviewerChecks(packet(r.input), resolver(r.input)) }

describe('REVIEWER v1.1 draft fixtures', () => {
  it('has the 14 rows: 8 traps and 6 controls', () => {
    expect(ROWS.map(r => r.fixture)).toEqual(Array.from({ length: 14 }, (_, i) => `RV-${String(i + 1).padStart(2, '0')}`))
    expect(ROWS.filter(r => r.expected_verdict.startsWith('claims-match')).map(r => r.fixture)).toEqual(CONTROLS)
  })
  it('every must_cite string is present in its row input (the evidence requirement can be met without inventing text)', () => {
    for (const r of ROWS) for (const c of r.must_cite) expect(JSON.stringify(r.input), `${r.fixture}: ${c}`).toContain(c)
  })
  for (const id of CONTROLS) it(`${id} (control): no flag, nothing unverified`, () => expect(run(id).filter(c => c.status === 'flag' || c.status === 'unverified')).toEqual([]))
  for (const id of V1_TRAPS) {
    // RV-08 needs a resolver, which the row supplies; every v1 trap must still raise a flag of its expected kind.
    it(`${id} (v1 trap): still flagged with its expected kind`, () => expect(run(id).filter(c => c.status === 'flag').map(f => f.kind)).toContain(ROWS.find(r => r.fixture === id)!.expected_verdict))
  }
  it('RV-10 (body-as-wish) is not caught by the six PR #357 checks (reviewerExtraChecks.ts catches it)', () => expect(run('RV-10').some(c => c.status === 'flag')).toBe(false))
  it('RV-11 (unearned approval) is not caught by the six PR #357 checks (reviewerExtraChecks.ts catches it)', () => expect(run('RV-11').some(c => c.status === 'flag')).toBe(false))
})
