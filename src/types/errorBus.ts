// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// STANDING RULE: Do not modify severity definitions or add predictive types

export type FailureSeverity = 'info' | 'warning' | 'error' | 'critical'
// critical: build-breaking failures, identity violations, system compromise
// error: agent/task execution failures, API errors, timeout/abort
// warning: performance degradation, heuristic anomalies, partial success
// info: contextual logging, state transitions, audit trails

export type FailureSource =
  | 'forgemind' | 'repoagent' | 'github'
  | 'orchestrator'  // authority layer telemetry
  | 'openrouter'
  | 'moonshot'

export interface FailureEvent {
  id: string
  timestamp: string
  source: FailureSource
  severity: FailureSeverity
  message: string
  context?: Record<string, unknown>
  resolved: boolean
}

// SCOPE CONSTRAINT: FailureEvent captures POST-EXECUTION observed failures only.
// No predictive failure logging. Predictive hooks are reserved for the
// Orchestrator heuristic interface (future phase).
