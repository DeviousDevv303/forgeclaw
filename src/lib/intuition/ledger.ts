/*
 * Copyright (c) 2026 DeviousDevv303 (Cristian)
 * ForgeClaw — Personal AI Assistant
 * Built with love for Cristian Jr., Layla, and Jozae
 */

/**
 * Synthetic Intuition, Step 0: the evidence ledger and packet journal (forgeclaw #235 verdict).
 *
 * No Signal Without Sediment: the only thing that earns live leverage is a sealed prediction with a valid grade from a
 * different seat, from a LIVE source. Synthetic minimal pairs and mined #235 episodes may train, but are counted as
 * excluded here and never feed a bound ("the model must not grade its own homework"; #235's ratio is escalation-biased).
 * Method-failure and unresolved grades carry no verdict, so they add nothing to hits or denominators.
 * The ledger has no execution authority: it stores records, grades and journal entries and computes numbers. Nothing else.
 */
import { boundFor, type BoundResult } from './boundMath'
import { sealGrade, sealRecord, verifyRecord, type Grade, type GradeInput, type PreOutcomeInput, type SealedRecord } from './record'

export interface JournalEntry {
  packetHash: string
  packet: string
  registryVersion: string
  registryStatus: 'draft' | 'frozen'
  estimator: string
  bucketEdges: string
  patternClassId: string
  regime: string
  bucket: number
  hits: number
  n: number
  /** The exact graded records the bucket was computed from. The harness fails closed if any stops resolving. */
  recordIds: string[]
  lanes: string[]
  providers: string[]
  evidenceFrom: string
  evidenceTo: string
  journaledAt: string
}

export interface IntuitionLedger {
  records: Record<string, SealedRecord>
  grades: Record<string, Grade>
  journal: JournalEntry[]
}

export function emptyLedger(): IntuitionLedger { return { records: {}, grades: {}, journal: [] } }

export function addRecord(l: IntuitionLedger, input: PreOutcomeInput): IntuitionLedger {
  if (l.records[input.id]) throw new Error(`record ${input.id} already sealed; a prediction is never rewritten`)
  return { ...l, records: { ...l.records, [input.id]: sealRecord(input) } }
}

export function addGrade(l: IntuitionLedger, input: GradeInput): IntuitionLedger {
  const record = l.records[input.recordId]
  if (!record) throw new Error(`no sealed record ${input.recordId} to grade`)
  if (l.grades[input.recordId]) throw new Error(`record ${input.recordId} is already graded; grades are not edited`)
  return { ...l, grades: { ...l.grades, [input.recordId]: sealGrade(input, record) } }
}

export type Exclusion = 'ungraded' | 'synthetic' | 'mined-235' | 'unresolved' | 'tampered'

/** Does this record count toward a live bound, and if not, why not. */
export function eligibility(l: IntuitionLedger, id: string): { ok: true; hit: boolean } | { ok: false; reason: Exclusion } {
  const r = l.records[id]; const g = l.grades[id]
  if (!r) return { ok: false, reason: 'tampered' }
  if (!verifyRecord(r)) return { ok: false, reason: 'tampered' }
  if (!g) return { ok: false, reason: 'ungraded' }
  if (g.preHash !== r.hash) return { ok: false, reason: 'tampered' }
  if (r.source === 'synthetic') return { ok: false, reason: 'synthetic' }
  if (r.source === 'mined-235') return { ok: false, reason: 'mined-235' }
  if (g.verdict === 'unresolved') return { ok: false, reason: 'unresolved' }
  return { ok: true, hit: g.verdict === 'correct' }
}

export interface ClassStats extends BoundResult {
  patternClassId: string
  patternClassVersion: string
  regime: string
  recordIds: string[]
  excluded: Record<Exclusion, number>
}

/** Per class, per regime, with denominators. Counts are separated by registry version: a version change never merges evidence. */
export function statsFor(l: IntuitionLedger, patternClassId: string, patternClassVersion: string, regime: string): ClassStats {
  const excluded: Record<Exclusion, number> = { ungraded: 0, synthetic: 0, 'mined-235': 0, unresolved: 0, tampered: 0 }
  const recordIds: string[] = []
  let hits = 0
  for (const r of Object.values(l.records)) {
    if (r.patternClassId !== patternClassId || r.patternClassVersion !== patternClassVersion || r.regime !== regime) continue
    const e = eligibility(l, r.id)
    if (e.ok) { recordIds.push(r.id); if (e.hit) hits++ } else excluded[e.reason]++
  }
  recordIds.sort()
  return { ...boundFor(hits, recordIds.length), patternClassId, patternClassVersion, regime, recordIds, excluded }
}

export function allStats(l: IntuitionLedger): ClassStats[] {
  const keys = new Map<string, [string, string, string]>()
  for (const r of Object.values(l.records)) keys.set(`${r.patternClassId}|${r.patternClassVersion}|${r.regime}`, [r.patternClassId, r.patternClassVersion, r.regime])
  return [...keys.values()].map(([c, v, g]) => statsFor(l, c, v, g)).sort((a, b) => (a.patternClassId + a.regime).localeCompare(b.patternClassId + b.regime))
}

// ---- persistence (browser only; every access guarded, the ledger renders empty without it) ----
const STORAGE_KEY = 'fm_intuition_ledger_v1'
export const INTUITION_CHANGED_EVENT = 'forgeclaw:intuition-changed'

export function loadLedger(): IntuitionLedger {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyLedger()
    const p = JSON.parse(raw) as IntuitionLedger
    if (!p || typeof p !== 'object' || !p.records || !p.grades || !Array.isArray(p.journal)) return emptyLedger()
    return p
  } catch { return emptyLedger() }
}

export function saveLedger(l: IntuitionLedger): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(l))
    window.dispatchEvent(new Event(INTUITION_CHANGED_EVENT))
  } catch { /* storage unavailable: nothing persisted, nothing claimed */ }
}
