// All data in this file is SYNTHETIC (built here, shaped like the app's records). No operator data.
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import snapshot from '../spec/tools.snapshot.json'
import { parseTranscript, validateTranscript, type ToolSchema } from '../src/grammar'
import { budget, scenarioTable } from './budget'
import { CANDIDATE_PREFIX, CONVERGED_BY, RECORD_PREFIX, buildRows, classifyOutput, collectAdmitted, integrityOf, normalizePrompt, parseContext, parseStoreExport, sha256, type StoreExport } from './export'

const tools = snapshot.tools as unknown as ToolSchema[]
const notEvidenceTools = new Set(snapshot.notEvidenceTools)

interface Ev { channel: 'chat' | 'tool'; input: string; result: string; outcome: string; tool?: string; run?: string; at: string; admittedBy?: string; noCandidate?: boolean; tamper?: boolean }
function makeStore(events: Ev[]): StoreExport {
  const keys: Record<string, string> = {}
  for (const e of events) {
    const context = `channel=${e.channel}; outcome=${e.outcome}; origin=typed; actor=agent${e.tool ? `; tool=${e.tool}` : ''}`
    const base = { input: e.input, context, generatedResult: e.result, runtime: 'test', model: 'synthetic' }
    const integrity = integrityOf(base)
    if (!e.noCandidate) keys[`${CANDIDATE_PREFIX}candidate-${integrity}`] = JSON.stringify({
      id: `candidate-${integrity}`, corpusId: 'c', source: 's', content: e.result, timestamp: e.at, version: 1, recordType: 'learning_candidate', integrity, admissionStatus: 'candidate',
      metadata: { channel: e.channel, outcome: e.outcome, ...(e.run ? { run: e.run } : {}) }, ...base, generatedResult: e.tamper ? e.result + ' (edited)' : e.result })
    keys[`${RECORD_PREFIX}knowledge-${integrity}`] = JSON.stringify({
      id: `knowledge-${integrity}`, corpusId: 'c', source: 's', content: e.result, timestamp: e.at, version: 2, recordType: 'knowledge', integrity, admissionStatus: 'approved',
      metadata: { input: e.input, runtime: 'test', model: 'synthetic', ...(e.admittedBy ? { admittedBy: e.admittedBy } : {}) } })
  }
  return { format: 'nexus-store-export', version: 1, exportedAt: '2026-10-27T00:00:00.000Z', keys }
}
const opts = (extra = {}) => ({ tools, notEvidenceTools, storeSha256: 'x'.repeat(64), ...extra })
const run = (events: Ev[], extra = {}) => { const s = makeStore(events); return buildRows(s, collectAdmitted(s), opts(extra)) }

const prompt = (o: Partial<Ev> = {}): Ev => ({ channel: 'chat', input: 'what is in the readme?', result: 'It describes ForgeClaw.', outcome: 'verified', run: 'run-a', at: '2026-10-26T10:00:03Z', ...o })
const call = (o: Partial<Ev> = {}): Ev => ({ channel: 'tool', input: 'github_read_file {"path":"README.md"}', result: '# ForgeClaw', outcome: 'completed', tool: 'github_read_file', run: 'run-a', at: '2026-10-26T10:00:01Z', ...o })

describe('a clean operator-admitted run', () => {
  const { rows, rejected } = run([call(), prompt()])
  it('becomes one grammar transcript that round-trips and validates', () => {
    expect(rejected).toEqual([])
    expect(rows).toHaveLength(1)
    const r = rows[0]
    expect(r.synthetic).toBe(false)
    expect(r.prompt).toBe('what is in the readme?')
    expect(r.transcript.route).toBe('tool')
    expect(r.transcript.evidence).toBe('verified')
    expect(parseTranscript(r.text)).toEqual(r.transcript)
    expect(validateTranscript(r.transcript, tools, notEvidenceTools)).toEqual([])
  })
  it('carries provenance on every row', () => {
    const p = rows[0].provenance
    expect(p.run).toBe('run-a')
    expect(p.admission).toBe('operator-signed')
    expect(p.candidateIds).toHaveLength(2)
    expect(p.integrities.every(i => i.startsWith('sha256-'))).toBe(true)
    expect(p.storeExportSha256).toHaveLength(64)
    expect(p.recordedOutcome).toBe('verified')
  })
  it('is deterministic', () => {
    expect(JSON.stringify(run([prompt(), call()]).rows)).toBe(JSON.stringify(rows))
  })
})

describe('what is refused', () => {
  const reasons = (events: Ev[], extra = {}) => run(events, extra).rejected.map(r => r.reason.split(':')[0])
  it('NEXUS-converged records are not operator admission (unless asked)', () => {
    expect(reasons([call({ admittedBy: CONVERGED_BY }), prompt({ admittedBy: CONVERGED_BY })])).toEqual(['converged_not_operator_admitted', 'converged_not_operator_admitted'])
    expect(run([call({ admittedBy: CONVERGED_BY }), prompt({ admittedBy: CONVERGED_BY })], { includeConverged: true }).rows).toHaveLength(1)
  })
  it('an unrecognised admitter is refused', () => { expect(reasons([prompt({ admittedBy: 'someone-else' })])[0]).toBe('admitter_not_recognised') })
  it('a record whose candidate was edited fails the integrity check', () => { expect(reasons([call(), prompt({ tamper: true })])).toContain('integrity_mismatch') })
  it('a record with no candidate cannot be labelled', () => { expect(reasons([call(), prompt({ noCandidate: true })])).toContain('no_candidate_record') })
  it('a record with no run id cannot be joined', () => { expect(reasons([prompt({ run: undefined })])).toEqual(['no_run_id']) })
  it('a truncated tool call is rejected, never repaired', () => {
    expect(reasons([call({ input: 'github_read_file {"path":"README.md' }), prompt()])).toEqual(['unparseable_or_truncated_call', 'unparseable_or_truncated_call'])
  })
  it('a run with two prompt events is ambiguous', () => { expect(reasons([call(), prompt(), prompt({ input: 'again', at: '2026-10-26T10:00:09Z' })])[0]).toBe('ambiguous_multiple_prompt_events') })
  it('"verified" backed only by a reasoning tool is a label conflict', () => {
    const r = run([call({ input: 'deepseek_reason {"task":"summarise"}', tool: 'deepseek_reason' }), prompt()])
    expect(r.rows).toEqual([])
    expect(r.rejected[0].reason).toMatch(/^label_conflict:/)
  })
  it('an unknown tool or a bad argument is a label conflict, not a row', () => {
    expect(reasons([call({ input: 'no_such_tool {"a":1}' }), prompt()])[0]).toBe('label_conflict')
    expect(reasons([call({ input: 'github_read_file {"path":123}' }), prompt()])[0]).toBe('label_conflict')
  })
  it('a prompt in the frozen eval set never reaches training', () => {
    expect(reasons([call(), prompt()], { evalPrompts: new Set([normalizePrompt('  WHAT is in the README? ')]) })[0]).toBe('prompt_in_frozen_eval_set')
  })
})

describe('evidence labels', () => {
  it('a [GUARDIAN BLOCK] result is an error, so "completed" on it is refused and "blocked" is accepted', () => {
    const blocked = '[GUARDIAN BLOCK] shell_exec requires Guardian co-sign approval, but no project-owned approval handler is attached.'
    expect(classifyOutput(blocked)).toBe('error')
    const shell = { input: 'shell_exec {"command":"ls"}', tool: 'shell_exec', result: blocked, channel: 'tool' as const }
    expect(run([call(shell), prompt({ outcome: 'completed' })]).rows).toEqual([])
    expect(run([call(shell), prompt({ outcome: 'blocked', result: 'Blocked.' })]).rows[0].transcript.evidence).toBe('blocked')
  })
  it('direct answers are excluded by default and become not_verified when allowed', () => {
    expect(run([prompt({ outcome: 'completed' })]).rejected[0].reason).toBe('direct_answer_excluded_by_default')
    const r = run([prompt({ outcome: 'completed' })], { allowDirect: true })
    expect(r.rows[0].transcript).toMatchObject({ route: 'direct', evidence: 'not_verified' })
  })
  it('classifies the same failure prefixes the app does, plus BLOCK', () => {
    for (const bad of ['[TOOL ERROR] x', '✗ failed', '[GUARDIAN BLOCKED] x', '[GUARDIAN REJECTED] x', '[GUARDIAN BLOCK] x']) expect(classifyOutput(bad)).toBe('error')
    expect(classifyOutput('ok')).toBe('ok')
  })
})

describe('the store file', () => {
  it('rejects anything outside the forgeclaw_nexus_ allowlist and other formats', () => {
    expect(() => parseStoreExport({ format: 'nexus-store-export', version: 1, exportedAt: 'x', keys: { fm_anthropic_key: 'sk-…' } })).toThrow(/allowlist/)
    expect(() => parseStoreExport({ format: 'other', version: 1, keys: {} })).toThrow(/not a nexus-store-export/)
    expect(() => parseStoreExport({ format: 'nexus-store-export', version: 2, keys: {} })).toThrow(/version/)
  })
  it('parses the context string the app writes', () => {
    expect(parseContext('channel=tool; outcome=completed; origin=typed; actor=agent; tool=shell_exec')).toMatchObject({ channel: 'tool', outcome: 'completed', tool: 'shell_exec' })
  })
})

describe('dump-nexus-store.js, executed against a fake browser', () => {
  const source = readFileSync(new URL('./dump-nexus-store.js', import.meta.url), 'utf8')
  const store = makeStore([call(), prompt()])
  function runScript(extra: Record<string, string>) {
    const data: Record<string, string> = { ...store.keys, ...extra }
    const names = Object.keys(data)
    let written = ''
    const errors: string[] = []
    const sandbox = {
      localStorage: { length: names.length, key: (i: number) => names[i], getItem: (k: string) => data[k] ?? null },
      location: { origin: 'https://example.test' },
      Blob: class { constructor(parts: string[]) { written = parts.join('') } },
      URL: { createObjectURL: () => 'blob:x' },
      document: { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } },
      console: { log() {}, error: (m: string) => errors.push(m) },
      JSON, Date,
    }
    runInNewContext(source, sandbox)
    return { written, errors }
  }
  it('writes only the admitted pair, never chat history, provider keys or un-admitted candidates', () => {
    const out = runScript({ forgemind_history: '[{"content":"private chat"}]', fm_anthropic_key: 'sk-ant-' + 'a'.repeat(40), [`${CANDIDATE_PREFIX}candidate-sha256-unadmitted`]: '{"x":1}' })
    const file = parseStoreExport(JSON.parse(out.written))
    expect(Object.keys(file.keys).sort()).toEqual(Object.keys(store.keys).sort())
    expect(out.written).not.toContain('private chat')
    expect(out.written).not.toContain('sk-ant-')
  })
  it('aborts and writes nothing when an admitted record contains something shaped like a credential', () => {
    const leaky = makeStore([call({ result: 'token ghp_' + 'A'.repeat(30) }), prompt()])
    const data = leaky.keys
    let written = ''
    const names = Object.keys(data)
    const errors: string[] = []
    runInNewContext(source, { localStorage: { length: names.length, key: (i: number) => names[i], getItem: (k: string) => data[k] ?? null }, location: { origin: 'x' }, Blob: class { constructor(p: string[]) { written = p.join('') } }, URL: { createObjectURL: () => '' }, document: { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } }, console: { log() {}, error: (m: string) => errors.push(m) }, JSON, Date })
    expect(written).toBe('')
    expect(errors.join()).toMatch(/ABORTED/)
  })
})

describe('token budget', () => {
  it('30M parameters want 0.6B tokens at 20 tokens/param, and 1M tokens covers 0.17%', () => {
    const b = budget(30e6, 1e6)
    expect(b.tokensWanted).toBe(600e6)
    expect(b.coverage).toBeCloseTo(1e6 / 600e6, 10)
    expect(b.shortfallFactor).toBeCloseTo(600, 6)
  })
  it('renders a markdown table', () => { expect(scenarioTable(300, [1000], [30e6])).toContain('| 1,000 |') })
  it('hashes stably', () => { expect(sha256('a')).toBe('ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb') })
})

describe('image-only verified runs do not poison the corpus (interim safeguard, directive 2026-10-28)', () => {
  const imgRun: Ev[] = [
    { channel: 'chat', input: 'make a picture of a cat', result: 'Here is the image.', outcome: 'verified', run: 'r-img', at: '2026-10-27T00:00:00.000Z' },
    { channel: 'tool', input: 'generate_image {"prompt":"a cat"}', result: 'image ready', outcome: 'verified', tool: 'generate_image', run: 'r-img', at: '2026-10-27T00:00:01.000Z' },
  ]
  it('a run backed only by generate_image cannot export a verified label (dropped as label_conflict)', () => {
    const { rows, rejected } = run(imgRun)
    expect(rows).toHaveLength(0)
    expect(rejected.some(r => r.reason.startsWith('label_conflict'))).toBe(true)
  })
  it('a real read backing the same verified answer still exports', () => {
    const { rows } = run([
      { channel: 'chat', input: 'what is in README', result: 'It says ForgeClaw.', outcome: 'verified', run: 'r-ok', at: '2026-10-27T00:00:00.000Z' },
      { channel: 'tool', input: 'github_read_file {"path":"README.md"}', result: '# ForgeClaw', outcome: 'verified', tool: 'github_read_file', run: 'r-ok', at: '2026-10-27T00:00:01.000Z' },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].text).toContain('<|ev:verified|>')
  })
})
