// @vitest-environment node
// CURATOR lineage check, canaried the way the REVIEWER checks are: it must catch every trap, pass every control, and a
// checker that flags everything (or nothing) fails this file. The traps include the HP-06 held-out probe's own record.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { convergencePhase, CONVERGED_BY, OWNER_ADMITTED_BY } from '../nexusConvergence'
import { checkLineageAdmission, type CuratorRecord } from './curatorChecks'

const probes = readFileSync('nexus-llm/eval/nursery/heldout-v0-draft.jsonl', 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
const HP06 = probes.find(p => p.id === 'HP-06').input.record as Record<string, unknown>
const hp06: CuratorRecord = { runtime: String(HP06.runtime), model: String(HP06.model) }

const TRAPS: Array<[string, CuratorRecord]> = [
  ['HP-06 probe record (runtime qwen, model Qwen/Qwen3-8B)', hp06],
  ['Qwen runtime alone', { runtime: 'corpus' }],
  ['Qwen model id alone, runtime states another provider', { runtime: 'moonshot', model: 'Qwen/Qwen3-8B' }],
  ['qwen: source prefix alone', { source: 'qwen:chat-turn' }],
  ['explicit lineage marker in context', { context: 'channel=chat; lineage=qwen; outcome=verified' }],
  ['explicit lineage marker in metadata', { metadata: { lineage: 'qwen' } }],
  ['a caller wrongly states lineage none on a Qwen runtime', { runtime: 'qwen', model: 'qwen3-8b', metadata: { lineage: 'none' } }],
]
const CONTROLS: Array<[string, CuratorRecord, 'admit' | 'hold']> = [
  ['HP-06 record, held for the owner (the correct decision)', hp06, 'hold'],
  ['non-Qwen answer backed by evidence, admitted (no regression)', { runtime: 'moonshot', model: 'kimi-k2.7-code', metadata: { lineage: 'none' } }, 'admit'],
  ['Qwen answer admitted by the owner', { runtime: 'qwen', model: 'qwen3-8b', metadata: { admittedBy: OWNER_ADMITTED_BY } }, 'admit'],
  ['non-Qwen answer, held (not this check\'s concern)', { runtime: 'moonshot' }, 'hold'],
]

describe('CURATOR lineage check: the canaries', () => {
  for (const [name, record] of TRAPS) {
    it(`flags: ${name}`, () => {
      const r = checkLineageAdmission({ record, decision: 'admit' })
      expect(r.status).toBe('flag')
      expect(r.kind).toBe('reject:self-blessed-admission')
      expect(r.evidence.length).toBeGreaterThan(0)
    })
    it(`passes the same record when CURATOR holds it: ${name}`, () => {
      expect(checkLineageAdmission({ record, decision: 'hold' }).status).toBe('pass')
    })
  }
  for (const [name, record, decision] of CONTROLS) {
    it(`control passes: ${name}`, () => expect(checkLineageAdmission({ record, decision }).status).toBe('pass'))
  }
  it('not blind and not trigger-happy: exactly the admitted Qwen-lineage traps flag', () => {
    const all = [...TRAPS.map(([, r]) => ({ record: r, decision: 'admit' as const })), ...CONTROLS.map(([, r, d]) => ({ record: r, decision: d }))]
    expect(all.filter(p => checkLineageAdmission(p).status === 'flag')).toHaveLength(TRAPS.length)
  })
})

describe('CURATOR lineage check: never a pass without an answer', () => {
  it('a missing decision is unverified, not a pass', () => expect(checkLineageAdmission({ record: hp06 }).status).toBe('unverified'))
  it('a malformed decision is unverified', () => expect(checkLineageAdmission({ record: hp06, decision: 'maybe' }).status).toBe('unverified'))
  it('an admitted record with no lineage signal at all is unverified', () => expect(checkLineageAdmission({ record: {}, decision: 'admit' }).status).toBe('unverified'))
  it('no record is a skip', () => expect(checkLineageAdmission({ record: undefined as unknown as CuratorRecord, decision: 'admit' }).status).toBe('skip'))
})

describe('CURATOR lineage check agrees with the product rule', () => {
  // The product's own admission path (#354): every trap record that reaches convergence as a verified user chat turn
  // stays a candidate, so the correct CURATOR decision for it is 'hold'. If the product rule ever drifts, this fails.
  for (const [name, record] of TRAPS) {
    it(`convergence keeps it a candidate: ${name}`, () => {
      const input = { input: 'q', result: 'a', source: record.source, runtime: record.runtime, model: record.model, context: record.context ?? 'channel=chat; actor=user; outcome=verified', metadata: { ...(record.metadata ?? {}), channel: 'chat', actor: 'user', outcome: 'verified' } }
      expect(convergencePhase(input as never)).toBeNull()
    })
  }
  it('and an evidence-backed non-Qwen answer converges, so the check is not just mirroring a blanket refusal', () => {
    const input = { input: 'q', result: 'a', runtime: 'moonshot', model: 'kimi-k2.7-code', metadata: { channel: 'chat', actor: 'user', outcome: 'verified', lineage: 'none' } }
    expect(convergencePhase(input as never)).not.toBeNull()
    expect(CONVERGED_BY).toBeTruthy()
  })
})
