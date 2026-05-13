export interface ReasoningStep {
  id: string
  icon: '🔍' | '⚙️' | '✅' | '❌' | '📝' | '🧪' | '🚀'
  label: string
  status: 'active' | 'done' | 'error' | 'pending'
  timestamp: string // ISO8601
  durationMs?: number
  body?: string
  children?: ReasoningStep[]
}

export interface ReasoningChain {
  id: string
  rootLabel: string
  steps: ReasoningStep[]
  startedAt: string
  completedAt?: string
}

export type ReasoningPhase =
  | 'assumptions'
  | 'heuristics'
  | 'first_principles'
  | 'extension'
  | 'convergence'

export interface PhaseTransition {
  from: ReasoningPhase | null
  to: ReasoningPhase
  timestamp: string
  trigger: string
}
