// @vitest-environment node
// The REVIEWER reality checks against the frozen REVIEWER v1 rows (c8d6cc5, fixtures 5fb658b9…ceb), read-only.
// The run-1 trap rows are canaries and stay red on purpose (owner direction, #235 6567858465): every check must
// catch its trap and pass all three controls. A checker that passes everything fails this file.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { checkRefs, compareVerdict, runReviewerChecks, type RefResolver, type ReviewPacket } from './reviewerChecks'

interface Row { fixture: string; input: Record<string, unknown>; expected_verdict: string; must_cite: string[] }
const ROWS: Row[] = readFileSync('nexus-llm/eval/reviewer-v1/reviewer-fixtures.jsonl', 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
const CONTROLS = ['RV-01', 'RV-06', 'RV-09']
const TRAPS = ROWS.filter(r => !CONTROLS.includes(r.fixture))

function packet(input: Record<string, unknown>): ReviewPacket {
  const rendered = Object.fromEntries(Object.entries(input).filter(([k, v]) => k.startsWith('rendered') && typeof v === 'string')) as Record<string, string>
  return {
    claims: input.claims as string[],
    diff: input.diff as string | undefined,
    facts: input.facts as Record<string, unknown> | undefined,
    code: input.code as string | undefined,
    rendered: Object.keys(rendered).length ? rendered : undefined,
  }
}
/** The row's resolver table as a resolver; any ID not in the table is 'unknown', never 'exists'. */
function resolver(input: Record<string, unknown>): RefResolver | undefined {
  const table = (input.resolver_table as Record<string, unknown> | undefined)?.['per-comment lookups'] as Record<string, string> | undefined
  if (!table) return undefined
  return id => table[id] === 'exists' ? 'exists' : /404/.test(table[id] ?? '') ? 'missing' : 'unknown'
}
const run = (r: Row) => runReviewerChecks(packet(r.input), resolver(r.input))

describe('REVIEWER reality checks: the run-1 canaries', () => {
  it('reads all 9 frozen rows', () => expect(ROWS.map(r => r.fixture)).toEqual(['RV-01', 'RV-02', 'RV-03', 'RV-04', 'RV-05', 'RV-06', 'RV-07', 'RV-08', 'RV-09']))

  for (const r of TRAPS) {
    it(`${r.fixture}: a check flags it with the expected kind (${r.expected_verdict})`, () => {
      const flags = run(r).filter(c => c.status === 'flag')
      expect(flags.map(f => f.kind)).toContain(r.expected_verdict)
    })
    it(`${r.fixture}: the evidence carries every must_cite string that is in the input`, () => {
      const evidence = run(r).filter(c => c.status === 'flag').flatMap(c => c.evidence).join(' ')
      for (const cite of r.must_cite.filter(c => JSON.stringify(r.input).includes(c))) expect(evidence).toContain(cite)
    })
  }

  for (const id of CONTROLS) {
    it(`${id} (control): no check flags it and none is left unverified`, () => {
      const results = run(ROWS.find(r => r.fixture === id)!)
      expect(results.filter(c => c.status === 'flag' || c.status === 'unverified')).toEqual([])
    })
  }

  it('not blind: exactly the six trap rows carry a flag', () => {
    expect(ROWS.filter(r => run(r).some(c => c.status === 'flag')).map(r => r.fixture)).toEqual(TRAPS.map(r => r.fixture))
  })

  it('RV-08 precision: the two 404 IDs are flagged and the real ref is not', () => {
    const refs = run(ROWS.find(r => r.fixture === 'RV-08')!).find(c => c.check === 'refs')!
    expect(refs.evidence.sort()).toEqual(['6378671035', '6378697801'])
    expect(refs.evidence).not.toContain('6378832841')
  })

  it('diff-stat canary: no v1 trap carries a wrong +N/−M, so one is derived from control RV-06 (+17/−1 → +18/−1)', () => {
    const r6 = ROWS.find(r => r.fixture === 'RV-06')!
    const claims = (r6.input.claims as string[]).map(c => c.replace('+17/−1', '+18/−1'))
    const flagged = runReviewerChecks({ ...packet(r6.input), claims }).find(c => c.check === 'diff-stat')!
    expect(flagged.status).toBe('flag')
    expect(flagged.evidence).toEqual(['+18/−1', '+17/-1'])
  })

  it('a ref check with no resolver is unverified, never a pass', () => {
    const r8 = ROWS.find(r => r.fixture === 'RV-08')!
    expect(checkRefs(packet(r8.input)).status).toBe('unverified')
    expect(compareVerdict('claims-match', [checkRefs(packet(r8.input))]).type).toBe('unverified')
  })
})

describe('comparing a bot verdict to the checks', () => {
  // REVIEWER v1 run 1 as delivered (fe3cf4e) and graded FAIL (#235 6567582577).
  const delivery = JSON.parse(readFileSync('nexus-llm/eval/harness/reviewer_v1_run1_delivery.json', 'utf8')) as { records: Array<{ fixture: string; result_text: string }> }
  const verdictOf = (text: string) => text.match(/"verdict"\s*:\s*"([^"]*)"/)?.[1] ?? null

  it('reproduces the grade: false passes on RV-02/03/05/07, wrong kind on RV-08, nothing on the rest', () => {
    const got = Object.fromEntries(delivery.records.map(d => [d.fixture, compareVerdict(verdictOf(d.result_text), run(ROWS.find(r => r.fixture === d.fixture)!)).type]))
    expect(got).toEqual({ 'RV-01': 'none', 'RV-02': 'false-pass', 'RV-03': 'false-pass', 'RV-04': 'none', 'RV-05': 'false-pass',
      'RV-06': 'none', 'RV-07': 'false-pass', 'RV-08': 'wrong-kind', 'RV-09': 'none' })
  })

  it('a flag on a body no check found wrong routes as unsupported (judgment, owner), not as a finding', () => {
    expect(compareVerdict('claims-mismatch:lost-lines', run(ROWS.find(r => r.fixture === 'RV-01')!)).type).toBe('unsupported-flag')
  })

  it('a malformed answer (no verdict) on a trap is a false pass', () => {
    expect(compareVerdict(null, run(ROWS.find(r => r.fixture === 'RV-04')!)).type).toBe('false-pass')
  })
})
