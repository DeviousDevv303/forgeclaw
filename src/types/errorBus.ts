export type FailureSeverity = 'warn' | 'error' | 'critical'
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
