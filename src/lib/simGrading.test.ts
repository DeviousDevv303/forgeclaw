// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.
import { describe, expect, it } from 'vitest'
import type { SimOutcomeRecord, SimRunRecord } from './nexusIntake'
import {
  SIM_MIN_HIT_RATE, SIM_MIN_SETTLED_RUNS, SIM_WEIGHT_CAP, formatSimFusionLine, gradeSims, simFusionWeight, simFusionWeightPct, simVerdict,
} from './simGrading'

const DIGEST = `sha256:${'a'.repeat(64)}`
const COMMIT = '0123456789abcdef0123456789abcdef01234567'

const run = (over: Partial<SimRunRecord> = {}): SimRunRecord => ({
  ts: '2026-10-24T18:00:00.000Z',
  source: 'mirofish-runner',
  runId: 'sim-1',
  kind: 'sim-run',
  marketRef: 'KXUFCFIGHT-26OCT24YANDVA-YAN',
  positionRef: 'pos-1',
  seed: { statsSnapshot: 'snap-1', matchupRead: true, humanState: false },
  engine: { agents: 25, model: 'kimi-k2', rounds: 12, mirofishCommit: COMMIT, imageDigest: DIGEST },
  medianLeanPct: 62,
  side: 'YES',
  reportRef: 'https://example.invalid/report',
  ...over,
})

const outcome = (runId: string, winningSide: string): SimOutcomeRecord => ({
  ts: '2026-10-25T04:00:00.000Z',
  source: 'mirofish-runner',
  runId,
  kind: 'sim-outcome',
  marketRef: 'KXUFCFIGHT-26OCT24YANDVA-YAN',
  winningSide,
})

/** N settled runs at a given median toward YES, of which the first `hits` settle YES. */
const settledBatch = (n: number, hits: number, median = 62) => {
  const runs = Array.from({ length: n }, (_, i) => run({ runId: `sim-b${i}` }))
  const outcomes = runs.map((r, i) => outcome(r.runId, i < hits ? 'YES' : 'NO'))
  return { runs: runs.map(r => ({ ...r, medianLeanPct: median })), outcomes }
}

describe('simVerdict: the swarm is scored like the crowd', () => {
  it('a call toward the winner hits; toward the loser misses; distance is |median − value|', () => {
    expect(simVerdict(run(), outcome('sim-1', 'YES')).hit).toBe(true)
    expect(simVerdict(run(), outcome('sim-1', 'NO')).hit).toBe(false)
    expect(simVerdict(run(), outcome('sim-1', 'YES')).distance).toBeCloseTo(0.38)
    expect(simVerdict(run(), outcome('sim-1', 'NO')).distance).toBeCloseTo(0.62)
  })

  it('a median of exactly 50% made no call', () => {
    expect(simVerdict(run({ medianLeanPct: 50 }), outcome('sim-1', 'YES')).hit).toBeNull()
  })

  it('a median under 50% calls the OTHER side', () => {
    expect(simVerdict(run({ medianLeanPct: 40 }), outcome('sim-1', 'NO')).hit).toBe(true)
    expect(simVerdict(run({ medianLeanPct: 40 }), outcome('sim-1', 'YES')).hit).toBe(false)
  })
})

describe('gradeSims: wins and losses count; pending is counted but never in the rate', () => {
  it('pending runs are in the totals and out of the rate', () => {
    const runs = [run({ runId: 'a' }), run({ runId: 'b' }), run({ runId: 'c' })]
    const { overall } = gradeSims(runs, [outcome('a', 'YES'), outcome('b', 'NO')])
    expect(overall.runs).toBe(3)
    expect(overall.settled).toBe(2)
    expect(overall.pending).toBe(1)
    expect(overall.called).toBe(2)
    expect(overall.hits).toBe(1)
    expect(overall.hitRate).toBe(0.5)
    expect(overall.meanDistance).toBeCloseTo((0.38 + 0.62) / 2)
  })

  it('an outcome naming an unknown run settles nothing', () => {
    const { overall } = gradeSims([run({ runId: 'a' })], [outcome('ghost', 'YES')])
    expect(overall.settled).toBe(0)
    expect(overall.pending).toBe(1)
    expect(overall.hitRate).toBeNull()
  })

  it('splits per series and per engine model', () => {
    const runs = [
      run({ runId: 'u1' }),
      run({ runId: 'n1', marketRef: 'KXNFLGAME-26OCT25BALHOU-BAL', engine: { agents: 25, model: 'claude-sonnet', rounds: 12, mirofishCommit: COMMIT, imageDigest: DIGEST } }),
    ]
    const { bySeries, byModel } = gradeSims(runs, [outcome('u1', 'YES'), outcome('n1', 'YES')])
    expect(bySeries.KXUFCFIGHT.settled).toBe(1)
    expect(bySeries.KXNFLGAME.settled).toBe(1)
    expect(byModel['kimi-k2'].settled).toBe(1)
    expect(byModel['claude-sonnet'].settled).toBe(1)
  })
})

describe('the weight policy: zero until earned, capped like sentiment', () => {
  const record = (settled: number, hitRate: number | null) => ({
    runs: settled, settled, pending: 0, called: settled, hits: hitRate === null ? 0 : Math.round(hitRate * settled), hitRate, meanDistance: null,
  })

  it('9 settled at 90% still weighs 0 (the settled-count bar)', () => {
    expect(simFusionWeight(record(9, 0.9))).toBe(0)
    expect(simFusionWeight(record(SIM_MIN_SETTLED_RUNS - 1, 1))).toBe(0)
  })

  it('10 settled at 54% still weighs 0 (the hit-rate bar)', () => {
    expect(simFusionWeight(record(10, 0.54))).toBe(0)
    expect(simFusionWeight(record(10, SIM_MIN_HIT_RATE - 0.01))).toBe(0)
  })

  it('10 settled at 55% earns weight, and never more than the cap', () => {
    const w = simFusionWeight(record(10, SIM_MIN_HIT_RATE))
    expect(w).toBeGreaterThan(0)
    expect(w).toBeLessThanOrEqual(SIM_WEIGHT_CAP)
    expect(simFusionWeight(record(40, 0.95))).toBe(SIM_WEIGHT_CAP)
    expect(simFusionWeightPct(record(10, SIM_MIN_HIT_RATE))).toBe(SIM_WEIGHT_CAP * 100)
  })

  it('no calls yet, no weight', () => {
    expect(simFusionWeight(record(12, null))).toBe(0)
  })

  it('end to end: 10 settled sims at 60% earn the cap through gradeSims', () => {
    const { runs, outcomes } = settledBatch(10, 6)
    const { overall } = gradeSims(runs, outcomes)
    expect(overall.hitRate).toBeCloseTo(0.6)
    expect(simFusionWeight(overall)).toBe(SIM_WEIGHT_CAP)
  })

  it('end to end: 10 settled sims at 50% earn nothing', () => {
    const { runs, outcomes } = settledBatch(10, 5)
    expect(simFusionWeight(gradeSims(runs, outcomes).overall)).toBe(0)
  })
})

describe('formatSimFusionLine', () => {
  it('renders the template line at weight 0 — the record matters even when it moves nothing', () => {
    expect(formatSimFusionLine(run(), 0)).toBe('swarm sim: 62% YES (weight 0%, run sim-1)')
  })
})
