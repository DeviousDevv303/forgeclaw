// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ReasoningPhase — INTERNAL ONLY.
// Zero JSX render paths. Guardian review logic only.
// If a React component imports ReasoningPhase for rendering, that is a bug.
export const ReasoningPhase = {
  ASSUME:          'assume',
  HEURISTIC:       'heuristic',
  FIRST_PRINCIPLE: 'first_principle',
  EXTEND:          'extend',
  CONVERGE:        'converge',
} as const

export type ReasoningPhase = typeof ReasoningPhase[keyof typeof ReasoningPhase]

export interface ReasoningTrace {
  traceId: string
  timestamp: string              // ISO 8601 ms precision
  agent: string                  // 'ForgeClaw' | 'KimiClaw' | 'Guardian' | etc.
  status: 'thinking' | 'done' | 'error' | 'blocked'

  thought: string                // Raw natural language — no phase labels, no headers
  parentTraceId?: string
  childTraces: string[]
  linkedToolCalls: string[]
  linkedPhase: ReasoningPhase    // INTERNAL. Never rendered.

  confidence?: number            // 0.0–1.0. Rendered as faded/italic if < 0.7
  innerMonologue?: string
}
