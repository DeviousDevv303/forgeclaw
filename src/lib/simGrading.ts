// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

/**
 * The MiroFish sim lane's track record and earned weight (owner GO 2026-10-24,
 * #235 comment 6390491232).
 *
 * The sim lane is graded exactly the way the crowd is graded in fundsLedger
 * (crowdVerdict / crowdRecord), because it is the same kind of claim: a lean
 * filed before the event, scored against the settled result, wins AND losses,
 * no cherry-picking. A sim-run with no outcome yet is PENDING — it counts in
 * the totals and never in the rate. A median of exactly 50% made no call and
 * is scored as no call, like the crowd's.
 *
 * The weight policy is the owner's, and it is deliberately the crowd's shape
 * with the sim's own bars: weight is 0 until the record shows at least
 * SIM_MIN_SETTLED_RUNS settled sims AND a directional hit rate of at least
 * SIM_MIN_HIT_RATE; then the lane's share is its hit rate, capped at
 * SIM_WEIGHT_CAP of the fusion — the sentiment cap. Nothing downstream reads
 * a sim except through simFusionWeight / simFusionWeightPct, so at weight 0
 * the sim contributes nothing to any edge math; the FUSION template line
 * still renders, because the record is the calibration asset even when it
 * moves nothing.
 *
 * Pure: no network, no storage. Records come from nexusIntake's sim parsers.
 */

import type { SimOutcomeRecord, SimRunRecord } from './nexusIntake'

/** Settled sims the lane needs before its record can earn any weight at all. */
export const SIM_MIN_SETTLED_RUNS = 10
/** Directional hit rate (0-1) the lane's settled record must reach to earn weight. */
export const SIM_MIN_HIT_RATE = 0.55
/** The most of the fusion a sim may ever weigh, as a fraction — the sentiment lane's cap, by the owner's ruling. */
export const SIM_WEIGHT_CAP = 0.1

/** One sim scored against its settled result. */
export interface SimVerdict {
  run: SimRunRecord
  outcome: SimOutcomeRecord
  /** True/false when the swarm made a call (median not exactly 50%); null for a no-call median. */
  hit: boolean | null
  /** |median − settled value of the run's side| as a probability (0-1): 0 is a perfect call, 1 is perfectly wrong. */
  distance: number
}

/** Score one run against its outcome. The outcome's value for the run's side is 1 when that side won, else 0. */
export function simVerdict(run: SimRunRecord, outcome: SimOutcomeRecord): SimVerdict {
  const sideValue = outcome.winningSide === run.side ? 1 : 0
  const distance = Math.abs(run.medianLeanPct / 100 - sideValue)
  const hit = run.medianLeanPct === 50 ? null : (run.medianLeanPct > 50) === (sideValue === 1)
  return { run, outcome, hit, distance }
}

/** The sim lane's record over a set of runs and outcomes — the one summary every consumer reads. */
export interface SimTrackRecord {
  /** Every sim-run, settled or not. Pending runs live here: counted, never dropped. */
  runs: number
  /** Runs whose market has settled (an outcome links back by run_id). */
  settled: number
  /** Runs still awaiting settlement. Excluded from the rate, included in the totals. */
  pending: number
  /** Settled runs where the swarm made a directional call (median not exactly 50%). */
  called: number
  /** Of the called runs, how many called the winner. */
  hits: number
  /** hits / called (0-1); null until the swarm has made at least one call. */
  hitRate: number | null
  /** Mean distance over settled runs (0-1); null until any run has settled. */
  meanDistance: number | null
}

function summarize(verdicts: SimVerdict[], runCount: number): SimTrackRecord {
  const called = verdicts.filter(v => v.hit !== null)
  const hits = called.filter(v => v.hit).length
  return {
    runs: runCount,
    settled: verdicts.length,
    pending: runCount - verdicts.length,
    called: called.length,
    hits,
    hitRate: called.length ? hits / called.length : null,
    meanDistance: verdicts.length ? verdicts.reduce((sum, v) => sum + v.distance, 0) / verdicts.length : null,
  }
}

/** A Kalshi ticker's series: the token before the first dash (KXUFCFIGHT-26OCT24…-YAN → KXUFCFIGHT). */
export function simSeriesOf(marketRef: string): string {
  return marketRef.trim().toUpperCase().split('-')[0] ?? ''
}

export interface SimGrading {
  overall: SimTrackRecord
  /** The same record per market series — a lane proven on UFC has proven nothing about the NFL. */
  bySeries: Record<string, SimTrackRecord>
  /** The same record per engine model — engines are graded separately (owner amendment, 2026-10-24). */
  byModel: Record<string, SimTrackRecord>
}

/**
 * Grades every run that has an outcome, overall and per series and per model.
 * Outcomes naming an unknown run_id settle nothing and are ignored (the run
 * may live in a later file); runs without outcomes stay pending.
 */
export function gradeSims(runs: SimRunRecord[], outcomes: SimOutcomeRecord[]): SimGrading {
  const outcomeByRun = new Map(outcomes.map(o => [o.runId, o]))
  const pairs = runs.flatMap(run => {
    const outcome = outcomeByRun.get(run.runId)
    return outcome ? [simVerdict(run, outcome)] : []
  })
  const group = (keyOf: (v: SimVerdict) => string, runsInGroup: (key: string) => number): Record<string, SimTrackRecord> => {
    const buckets = new Map<string, SimVerdict[]>()
    for (const verdict of pairs) {
      const key = keyOf(verdict)
      buckets.set(key, [...(buckets.get(key) ?? []), verdict])
    }
    return Object.fromEntries([...buckets].map(([key, verdicts]) => [key, summarize(verdicts, runsInGroup(key))]))
  }
  return {
    overall: summarize(pairs, runs.length),
    bySeries: group(v => simSeriesOf(v.run.marketRef), key => runs.filter(r => simSeriesOf(r.marketRef) === key).length),
    byModel: group(v => v.run.engine.model, key => runs.filter(r => r.engine.model === key).length),
  }
}

/**
 * The weight the sim lane has earned in the fusion, as a fraction (0-1).
 * 0 until BOTH bars are met; then its hit rate, capped at SIM_WEIGHT_CAP.
 * This function is the only door: the approve gate and the edge math read a
 * sim's contribution through it, so an unearned sim contributes exactly 0.
 */
export function simFusionWeight(record: SimTrackRecord): number {
  if (record.settled < SIM_MIN_SETTLED_RUNS) return 0
  if (record.hitRate === null || record.hitRate < SIM_MIN_HIT_RATE) return 0
  return Math.min(record.hitRate, SIM_WEIGHT_CAP)
}

/** The earned weight in percent, rounded to one decimal — the number the FUSION template line states. */
export function simFusionWeightPct(record: SimTrackRecord): number {
  return Math.round(simFusionWeight(record) * 1000) / 10
}

/** The FUSION template's swarm-sim line for one run, at the lane's currently earned weight. */
export function formatSimFusionLine(run: SimRunRecord, weightPct: number): string {
  return `swarm sim: ${run.medianLeanPct}% ${run.side} (weight ${weightPct}%, run ${run.runId})`
}
