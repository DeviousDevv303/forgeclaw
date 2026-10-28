import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import snapshot from '../spec/tools.snapshot.json'
import type { ToolSchema } from '../src/grammar'
import { judgeSuite } from './gate'
import { policies, type EvalCase } from './score'
import { frozenSuites } from './frozen-prompts'

const tools = snapshot.tools as unknown as ToolSchema[]
const load = (suite: string) => readFileSync(new URL(`./${suite}/cases.jsonl`, import.meta.url), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as EvalCase)
const as = (cases: EvalCase[], policy: string) => new Map(cases.map(c => [c.id, policies[policy](c, tools)]))

describe('replace-only-if-better gate', () => {
  it('covers both frozen suites', () => { expect(frozenSuites()).toEqual(['domains-v1', 'v1']) })
  for (const suite of ['v1', 'domains-v1']) {
    const cases = load(suite)
    it(`${suite}: the oracle is eligible`, () => { expect(judgeSuite(suite, cases, as(cases, 'oracle')).pass).toBe(true) })
    it(`${suite}: every reference policy is rejected (none beats the best of them)`, () => {
      for (const p of Object.keys(policies).filter(p => p !== 'oracle')) expect(judgeSuite(suite, cases, as(cases, p)).pass, p).toBe(false)
    })
    it(`${suite}: a candidate worse than the incumbent is rejected even if it beats the baselines`, () => {
      const oracle = as(cases, 'oracle')
      const worse = new Map(oracle); for (const c of cases.filter(x => x.kind === 'tool_choice').slice(0, 3)) worse.delete(c.id)
      const v = judgeSuite(suite, cases, worse, oracle)
      expect(v.pass).toBe(false)
      expect(v.reasons.join()).toMatch(/below the incumbent/)
    })
  }
  it('one fabricated answer is enough to reject', () => {
    const cases = load('domains-v1')
    const preds = as(cases, 'oracle')
    const c = cases.find(x => x.kind === 'evidence' && x.expect.mustNotContainAny?.includes('was placed'))!
    preds.set(c.id, '<|ev:completed|><|answer|>Your bet was placed.<|/answer|><|end|>')
    const v = judgeSuite('domains-v1', cases, preds)
    expect(v.pass).toBe(false)
    expect(v.reasons.join()).toMatch(/fabricates/)
  })
  it('the CLI exits 0 only for an eligible candidate, 1 otherwise (never a silent pass)', () => {
    const dir = (policy: string) => { const d = mkdtempSync(join(tmpdir(), 'gate-')); for (const s of frozenSuites()) { const cs = load(s); writeFileSync(join(d, `${s}.jsonl`), cs.map(c => JSON.stringify({ id: c.id, output: policies[policy](c, tools) })).join('\n') + '\n') } return d }
    const run = (d: string) => spawnSync('npx', ['vite-node', 'nexus-llm/eval/gate-cli.ts', '--candidate', d], { encoding: 'utf8' })
    const good = dir('oracle'), bad = dir('alwaysDirectNotVerified')
    try {
      const g = run(good); expect(g.status, g.stderr).toBe(0); expect(g.stdout).toContain('ELIGIBLE')
      const b = run(bad); expect(b.status).toBe(1); expect(b.stdout).toContain('REJECTED')
      const m = run(join(good, 'nope')); expect(m.status).toBe(1)
    } finally { rmSync(good, { recursive: true, force: true }); rmSync(bad, { recursive: true, force: true }) }
  }, 120_000)
})
