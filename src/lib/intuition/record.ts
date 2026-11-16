/*
 * Copyright (c) 2026 DeviousDevv303 (Cristian)
 * ForgeClaw — Personal AI Assistant
 * Built with love for Cristian Jr., Layla, and Jozae
 */

/**
 * Synthetic Intuition, Step 0: the 12-field pre-outcome record (forgeclaw #235 verdict, Step 0 item 1).
 *
 * Fields 1-8 are the PREDICTION, sealed (deep-frozen and hashed) before any outcome exists. Fields 9-12 are the GRADE: a
 * separate object that names the record's hash, so an outcome can never rewrite what was predicted and a later narrative
 * cannot make a prediction look like it knew. Field 11 is operationalized (Kimi's decision procedure, Muse-accepted):
 *   method failure   = a mechanistic signature at the tool layer / a provenance break. The instrument failed, not the world.
 *                      Conviction is unchanged and the intuition is left UNRESOLVED (the hypothesis was never actually tested).
 *   hypothesis disproof = the field-7 discriminating test, chosen in advance, ran on a CLEAN chain and came back against it.
 *                      The verdict is INCORRECT.
 * The Run #4 clock mis-binding / 1830 settle pair is the spec anchor for this distinction and is never a training row.
 */
import { canonicalJson, sha256Hex } from './sha256'

export const RECORD_SCHEMA = 'pre-outcome-v1'
export const LOOP_PHASES = ['assumptions', 'heuristics', 'first-principles', 'extension', 'convergence'] as const
export type LoopPhase = typeof LOOP_PHASES[number]
/** Where the evidence came from. Only 'live' ever counts toward live leverage. */
export const RECORD_SOURCES = ['live', 'mined-235', 'synthetic'] as const
export type RecordSource = typeof RECORD_SOURCES[number]
export const METHOD_SIGNATURES = ['timeout', 'access-denied', 'corrupted-snapshot', 'mis-bound-clock', 'stale-baseline', 'provenance-break'] as const
export type MethodSignature = typeof METHOD_SIGNATURES[number]

export interface PreOutcomeInput {
  /** 1. event identifier and timestamp */
  id: string
  recordedAt: string
  /** 2. context and environment; `regime` keys per-regime calibration */
  regime: string
  environment: string
  /** 3. observations available at prediction time */
  observations: string[]
  /** 4. initial intuition / hypothesis */
  hypothesis: string
  /** 5. confidence at prediction time, 0..1 */
  confidence: number
  /** 6. alternative hypotheses considered */
  alternatives: string[]
  /** 7. proposed discriminating test, chosen in advance */
  discriminatingTest: string
  /** 8. actions and methods attempted */
  actions: string[]
  // Provenance every graded record carries from birth (verdict + Muse rulings):
  lane: string
  actingProvider: string
  patternClassId: string
  patternClassVersion: string
  originPhase: LoopPhase
  source: RecordSource
}

export interface SealedRecord extends Readonly<PreOutcomeInput> { readonly schema: typeof RECORD_SCHEMA; readonly hash: string }

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); for (const x of Object.values(v as object)) deepFreeze(x) }
  return v
}

export function validatePreOutcome(i: PreOutcomeInput): string[] {
  const e: string[] = []
  const nonEmpty = (name: string, v: string) => { if (!v || !v.trim()) e.push(`${name} is required`) }
  nonEmpty('id', i.id); nonEmpty('regime', i.regime); nonEmpty('environment', i.environment); nonEmpty('hypothesis', i.hypothesis)
  nonEmpty('discriminatingTest', i.discriminatingTest); nonEmpty('lane', i.lane); nonEmpty('actingProvider', i.actingProvider)
  nonEmpty('patternClassId', i.patternClassId); nonEmpty('patternClassVersion', i.patternClassVersion)
  if (Number.isNaN(Date.parse(i.recordedAt))) e.push('recordedAt must be a timestamp')
  if (!(i.confidence >= 0 && i.confidence <= 1)) e.push('confidence must be within 0..1')
  if (i.observations.length === 0) e.push('observations at prediction time are required')
  if (i.alternatives.length === 0) e.push('at least one alternative hypothesis is required')
  if (!LOOP_PHASES.includes(i.originPhase)) e.push(`originPhase must be one of ${LOOP_PHASES.join(', ')}`)
  if (!RECORD_SOURCES.includes(i.source)) e.push(`source must be one of ${RECORD_SOURCES.join(', ')}`)
  return e
}

function hashOf(body: PreOutcomeInput): string {
  return sha256Hex(canonicalJson({ schema: RECORD_SCHEMA, ...body }))
}

export function sealRecord(input: PreOutcomeInput): SealedRecord {
  const errors = validatePreOutcome(input)
  if (errors.length) throw new Error(`pre-outcome record rejected: ${errors.join('; ')}`)
  const body: PreOutcomeInput = JSON.parse(JSON.stringify(input))
  return deepFreeze({ schema: RECORD_SCHEMA, ...body, hash: hashOf(body) })
}

export function verifyRecord(r: SealedRecord): boolean {
  const { schema: _s, hash, ...body } = r
  return _s === RECORD_SCHEMA && hash === hashOf(body as PreOutcomeInput)
}

export type IntuitionVerdict = 'correct' | 'incorrect' | 'unresolved'
export type FailureClass = 'none' | 'method' | 'hypothesis'

export interface GradeInput {
  recordId: string
  preHash: string
  gradedAt: string
  /** The seat that graded it. Never the lane or provider that made the prediction. */
  gradedBy: string
  /** 9. observed outcome and its evidence provenance (each entry must be checkable) */
  outcome: string
  outcomeProvenance: string[]
  /** 10. */
  verdict: IntuitionVerdict
  /** 11. */
  failureClass: FailureClass
  methodSignature?: MethodSignature
  /** hypothesis disproof only: the field-7 test actually ran, on an unbroken provenance chain */
  discriminatingTestRan?: boolean
  chainClean?: boolean
  /** 12. what should change in future recognition */
  futureChange: string
}

export type Grade = Readonly<GradeInput>

export function validateGrade(g: GradeInput, record: SealedRecord): string[] {
  const e: string[] = []
  if (g.recordId !== record.id || g.preHash !== record.hash) e.push('grade does not name this record and its sealed hash')
  if (!verifyRecord(record)) e.push('the sealed record fails its own hash')
  if (Number.isNaN(Date.parse(g.gradedAt)) || Date.parse(g.gradedAt) < Date.parse(record.recordedAt)) e.push('gradedAt must not precede recordedAt')
  if (!g.gradedBy.trim()) e.push('gradedBy is required')
  else if ([record.lane, record.actingProvider].some(x => x.toLowerCase() === g.gradedBy.trim().toLowerCase())) e.push('a prediction cannot be graded by its own lane or provider')
  if (!g.outcome.trim()) e.push('outcome is required')
  if (g.outcomeProvenance.length === 0 || g.outcomeProvenance.some(p => !p.trim())) e.push('outcome needs checkable provenance')
  if (!g.futureChange.trim()) e.push('futureChange (field 12) is required')
  if (g.failureClass === 'method') {
    if (!g.methodSignature || !METHOD_SIGNATURES.includes(g.methodSignature)) e.push(`method failure needs a mechanistic signature (${METHOD_SIGNATURES.join(', ')})`)
    if (g.verdict !== 'unresolved') e.push('a method failure leaves the intuition unresolved: the instrument failed, the hypothesis was not tested')
  } else if (g.failureClass === 'hypothesis') {
    if (g.discriminatingTestRan !== true || g.chainClean !== true) e.push('hypothesis disproof needs the pre-registered discriminating test to have run on a clean provenance chain')
    if (g.verdict !== 'incorrect') e.push('hypothesis disproof means the verdict is incorrect')
  } else {
    if (g.verdict === 'incorrect') e.push('an incorrect verdict needs failureClass "hypothesis"; without a disproof it is unresolved')
  }
  return e
}

export function sealGrade(g: GradeInput, record: SealedRecord): Grade {
  const errors = validateGrade(g, record)
  if (errors.length) throw new Error(`grade rejected: ${errors.join('; ')}`)
  return deepFreeze(JSON.parse(JSON.stringify(g)) as GradeInput)
}
