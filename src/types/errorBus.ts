// STANDING RULE: Do not modify severity definitions or add predictive types

export type FailureSeverity = 'info' | 'warning' | 'error' | 'critical'
// critical: build-breaking failures, identity violations, system compromise
// error: agent/task execution failures, API errors, timeout/abort
// warning: performance degradation, heuristic anomalies, partial success
// info: contextual logging, state transitions, audit trails

export type FailureSource = 'forgemind' | 'repoagent' | 'ollama' | 'claude' | 'github'

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
