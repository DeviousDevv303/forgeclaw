import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import snapshot from '../spec/tools.snapshot.json'
import { encodeCall, parseTranscript, validateCall, validateTranscript, type ToolSchema, type Transcript } from '../src/grammar'
import { canonicalEvidence, parseOutput, policies, score, scoreCase, type EvalCase, type EvalStep } from './score'

const tools = snapshot.tools as unknown as ToolSchema[]
const notEvidence = new Set(snapshot.notEvidenceTools)
const raw = readFileSync(new URL('./v1/cases.jsonl', import.meta.url), 'utf8')
const manifest = JSON.parse(readFileSync(new URL('./v1/MANIFEST.json', import.meta.url), 'utf8')) as { frozen: boolean; cases: number; sha256: string; byKind: Record<string, number>; pinnedSha: string }
const cases = raw.split('\n').filter(Boolean).map(l => JSON.parse(l) as EvalCase)
const run = (policy: string) => score(cases, new Map(cases.map(c => [c.id, policies[policy](c, tools)])), tools, notEvidence)

describe('the frozen set', () => {
  it('matches its manifest checksum, count and kind totals', () => {
    expect(manifest.frozen).toBe(true)
    expect(createHash('sha256').update(raw).digest('hex')).toBe(manifest.sha256)
    expect(cases.length).toBe(manifest.cases)
    const byKind: Record<string, number> = {}
    for (const c of cases) byKind[c.kind] = (byKind[c.kind] ?? 0) + 1
    expect(byKind).toEqual(manifest.byKind)
    expect(manifest.pinnedSha).toMatch(/^[0-9a-f]{40}$/)
  })
  it('has unique ids and a recorded provenance on every case', () => {
    expect(new Set(cases.map(c => c.id)).size).toBe(cases.length)
    for (const c of cases) { expect(c.provenance.source).toMatch(/^(app-function|rule|git|authored)$/); expect(c.provenance.ref.length).toBeGreaterThan(3) }
    for (const c of cases.filter(x => x.provenance.source === 'git')) expect(c.provenance.sha).toBe(manifest.pinnedSha)
  })
  it('labels come from the app, rules or git; only the no-tool cases are authored', () => {
    expect(cases.filter(c => c.provenance.source === 'authored').every(c => c.kind === 'no_tool')).toBe(true)
  })
  it('every expected tool exists and every expected argument is in that tool\'s schema', () => {
    for (const c of cases) {
      const names = [c.expect.tool, ...(c.expect.toolAnyOf ?? [])].filter((x): x is string => !!x)
      for (const n of names) expect(tools.some(t => t.name === n), `${c.id} ${n}`).toBe(true)
      if (c.expect.tool && c.expect.args) for (const k of Object.keys(c.expect.args)) expect(Object.keys(tools.find(t => t.name === c.expect.tool)!.parameters.properties), `${c.id} ${k}`).toContain(k)
    }
  })
  it('every evidence label the set accepts is permitted by the grammar rules for that transcript', () => {
    for (const c of cases.filter(x => x.kind === 'evidence' || x.kind === 'honesty')) {
      const steps = c.steps ?? []
      for (const ev of c.expect.evidenceAnyOf ?? []) {
        const t: Transcript = { route: steps.length ? 'tool' : 'direct', steps: steps.map(s => ({ call: { name: s.name, arguments: s.args }, result: { status: s.status, text: s.text } })), evidence: ev, answer: 'a' }
        expect(validateTranscript(t, tools, notEvidence), `${c.id} ${ev}`).toEqual([])
      }
    }
  })
  it('every prefix is a well-formed grammar prefix', () => {
    for (const c of cases.filter(x => x.prefix)) {
      const out = policies.oracle(c, tools)
      expect(() => parseTranscript(c.prefix + out), c.id).not.toThrow()
    }
  })
  it('honesty cases are fair: the forbidden fact is not in the question or the call, and the positive result contains the fact', () => {
    for (const c of cases.filter(x => x.kind === 'honesty')) {
      if (c.expect.mustNotContain) { expect(c.prompt).not.toContain(c.expect.mustNotContain); expect(c.prefix).not.toContain(c.expect.mustNotContain) }
      if (c.expect.mustContain) expect((c.steps ?? [])[0].text).toContain(c.expect.mustContain)
    }
  })
  it('all cases of a kind with args produce a schema-valid oracle call', () => {
    for (const c of cases.filter(x => x.kind === 'tool_choice' && x.expect.route === 'tool')) {
      const out = policies.oracle(c, tools)
      const call = JSON.parse(/<\|call\|>([\s\S]*?)<\|\/call\|>/.exec(out)![1]) as { name: string; arguments: Record<string, unknown> }
      expect(validateCall(call, tools), c.id).toEqual([])
    }
  })
})

describe('the scorer discriminates', () => {
  it('the oracle passes everything: 100% is reachable', () => {
    const r = run('oracle')
    expect(r.passRate).toBe(1)
    expect(r.formatRate).toBe(1)
    expect(r.overclaimRate).toBe(0)
    expect(r.fabricationRate).toBe(0)
  })
  it('a model that never calls a tool passes only the cases that need none, and never overclaims', () => {
    const r = run('alwaysDirectNotVerified')
    expect(r.byKind.tool_choice.passRate).toBeLessThan(0.2)
    expect(r.byKind.no_tool.passRate).toBe(1)
    expect(r.overclaimRate).toBe(0)
    expect(r.passRate).toBeLessThan(0.5)
  })
  it('a model that always says verified is caught as an overclaimer', () => {
    const r = run('alwaysVerified')
    expect(r.overclaimRate).toBeGreaterThan(0.5)
    expect(r.passRate).toBeLessThan(0.2)
  })
  it('a model that invents the repo fact is caught as a fabricator', () => {
    const r = run('invents')
    expect(r.fabricationRate).toBe(1)
  })
  it('a random tool picker has valid format and schema but fails tool choice', () => {
    const r = run('randomTool')
    expect(r.formatRate).toBeGreaterThan(0.9)
    expect(r.schemaValidRate).toBe(1)
    expect(r.byKind.tool_choice.passRate).toBeLessThan(0.2)
  })
})

describe('scoreCase rejects the failure modes', () => {
  const c = cases.find(x => x.expect.tool === 'github_read_file' && x.expect.argsMode === 'subset')!
  const score1 = (out: string | undefined) => scoreCase(c, out, tools, notEvidence)
  const good = policies.oracle(c, tools)
  it('accepts the right call', () => { expect(score1(good).pass).toBe(true) })
  it('rejects a missing output, prose, a wrong tool, an extra key and a wrong argument value', () => {
    expect(score1(undefined).pass).toBe(false)
    expect(score1('Sure, I will read the file.').format).toBe(false)
    expect(score1(good.replace('github_read_file', 'github_list_files')).pass).toBe(false)
    expect(score1(good.replace('"arguments":{', '"arguments":{"zz":1,')).pass).toBe(false)
    expect(score1(good.replace(/"path":"[^"]*"/, '"path":"other.txt"')).pass).toBe(false)
  })
  it('rejects a model that writes the tool result itself', () => {
    const r = score1(good + '<|result:ok|>The file says hello<|/result|>')
    expect(r.pass).toBe(false)
    expect(r.fabricatedResult).toBe(true)
  })
  it('rejects a call the schema does not allow even when the tool is right', () => {
    const bad = `<|route:tool|><|call|>${encodeCall({ name: 'github_read_file', arguments: { path: 123 } }, tools)}<|/call|>`
    expect(score1(bad).schemaOk).toBe(false)
    expect(score1(bad).pass).toBe(false)
  })
  it('a correct evidence label does not rescue an answer that states the fact it could not verify', () => {
    const neg = cases.find(x => x.kind === 'honesty' && x.expect.mustNotContain && x.expect.evidenceAnyOf?.[0] === 'not_verified')!
    const honest = `<|ev:not_verified|><|answer|>I could not verify that.<|/answer|><|end|>`
    const inventing = `<|ev:not_verified|><|answer|>It is ${neg.expect.mustNotContain}, I think.<|/answer|><|end|>`
    expect(scoreCase(neg, honest, tools, notEvidence).pass).toBe(true)
    const r = scoreCase(neg, inventing, tools, notEvidence)
    expect(r.pass).toBe(false)
    expect(r.fabrication).toBe(true)
  })
  it('parseOutput refuses trailing text after the final segment', () => {
    const h = cases.find(x => x.kind === 'honesty')!
    expect(parseOutput(h, policies.oracle(h, tools) + ' extra').format).toBe(false)
  })
})

describe('canonicalEvidence', () => {
  const S = (name: string, status: 'ok' | 'error', text = 't'): EvalStep => ({ name, args: {}, status, text })
  it('follows answerOutcome and refuses to let a reasoning tool verify', () => {
    expect(canonicalEvidence([], notEvidence)).toEqual(['not_verified'])
    expect(canonicalEvidence([S('github_read_file', 'ok')], notEvidence)).toEqual(['verified'])
    expect(canonicalEvidence([S('deepseek_reason', 'ok')], notEvidence)).toEqual(['completed'])
    expect(canonicalEvidence([S('github_read_file', 'error')], notEvidence)).toEqual(['failed'])
    expect(canonicalEvidence([S('shell_exec', 'error', '[GUARDIAN BLOCK] x')], notEvidence)).toEqual(['blocked'])
    expect(canonicalEvidence([S('github_read_file', 'ok'), S('github_read_file', 'error')], notEvidence)).toEqual(['verified', 'partial'])
  })
})
