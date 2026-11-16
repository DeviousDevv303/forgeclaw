// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// What the NEXUS tab says about the model itself. Every value here traces to something in the repository, and
// nexusModelState.test.ts fails if one drifts: the checkpoint hash is recomputed from the served runtime parts, the size and
// window are read from the provider definition, and the graded numbers are read from nexus-llm/loop-state.json.
// When a new checkpoint ships, this file changes with it, or the test stops the build.
import { NEXUS_CHECKPOINT_SHA256, NEXUS_MAX_CALLS, NEXUS_MODEL_ID, NEXUS_MODEL_LABEL } from './ai/nexusIntelligenceContext'

export interface Counted { hits: number; n: number }

export const NEXUS_MODEL_STATE = {
  id: NEXUS_MODEL_ID,
  label: NEXUS_MODEL_LABEL,
  run: 25,
  sha256: NEXUS_CHECKPOINT_SHA256,
  parameters: '4.48M',
  contextTokens: 640,
  maxCalls: NEXUS_MAX_CALLS,
  /** The record this checkpoint was graded in: nexus-llm/loop-state.json, verdicts.run25. */
  graded: {
    on: '2026-11-08',
    verdict: 'Meets bar, does not surpass',
    gate: 'ELIGIBLE',
    v1: { hits: 59, n: 84 } as Counted,
    domains: { hits: 41, n: 47 } as Counted,
    closedLoop: { hits: 16, n: 18 } as Counted,
    fabrication: '0.0%',
    source: 'nexus-llm/loop-state.json · run25',
  },
} as const

export const pct = (c: Counted): string => `${((c.hits / c.n) * 100).toFixed(1)}%`
