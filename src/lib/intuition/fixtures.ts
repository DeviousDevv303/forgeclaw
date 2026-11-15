/*
 * Copyright (c) 2026 DeviousDevv303 (Cristian)
 * ForgeClaw — Personal AI Assistant
 * Built with love for Cristian Jr., Layla, and Jozae
 */

/** Test fixtures for the Synthetic Intuition ledger. Not shipped data: these are made-up records for exercising the pipeline. */
import { addGrade, addRecord, emptyLedger, type IntuitionLedger } from './ledger'
import type { GradeInput, PreOutcomeInput } from './record'
import { DRAFT_REGISTRY, type PatternRegistry } from './patternClasses'

export const FROZEN_TEST_REGISTRY: PatternRegistry = {
  version: 'test-1',
  status: 'frozen',
  classes: [
    { id: 'tape.drift-consistent', parent: null, signature: 'Recognition of drift-consistent tape patterns, graded against settled outcomes.', falsifier: 'A settled outcome on a clean chain that the pattern assigned low probability to.' },
    { id: 'tape.drift-consistent.thin', parent: 'tape.drift-consistent', signature: 'The drift pattern restricted to thin books with under ten resting orders.', falsifier: 'A thin-book settle that resolves against the drift on a clean chain.' },
  ],
}

export function pre(id: string, over: Partial<PreOutcomeInput> = {}): PreOutcomeInput {
  return {
    id, recordedAt: '2026-11-01T10:00:00Z', regime: 'weekday-us', environment: 'desk journal',
    observations: ['tape drifted up for 40 minutes'], hypothesis: 'NO side holds', confidence: 0.6,
    alternatives: ['drift is noise'], discriminatingTest: 'settle at 18:30 resolves NO', actions: ['read tape'],
    lane: 'claude', actingProvider: 'anthropic', patternClassId: 'tape.drift-consistent', patternClassVersion: 'test-1',
    originPhase: 'first-principles', source: 'live', ...over,
  }
}

export function grade(id: string, preHash: string, verdict: 'correct' | 'incorrect' | 'unresolved', over: Partial<GradeInput> = {}): GradeInput {
  const base: GradeInput = {
    recordId: id, preHash, gradedAt: '2026-11-02T10:00:00Z', gradedBy: 'muse', outcome: 'settled', outcomeProvenance: ['kalshi settle result'],
    verdict, failureClass: verdict === 'incorrect' ? 'hypothesis' : 'none', futureChange: 'none yet',
    ...(verdict === 'incorrect' ? { discriminatingTestRan: true, chainClean: true } : {}),
  }
  return { ...base, ...over }
}

/** Ledger with `hits` correct and `misses` incorrect LIVE graded records for the first test class, regime weekday-us. */
export function ledgerWith(hits: number, misses: number, extra: (l: IntuitionLedger) => IntuitionLedger = l => l): IntuitionLedger {
  let l = emptyLedger()
  for (let i = 0; i < hits + misses; i++) {
    const id = `r${String(i).padStart(3, '0')}`
    l = addRecord(l, pre(id))
    l = addGrade(l, grade(id, l.records[id].hash, i < hits ? 'correct' : 'incorrect'))
  }
  return extra(l)
}
export { DRAFT_REGISTRY }
