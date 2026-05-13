export type StepStatus = 'pending' | 'streaming' | 'complete' | 'error'

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  result?: string
  status: 'pending' | 'running' | 'success' | 'error'
  startedAt: number
  completedAt?: number
}

export interface ReasoningStep {
  id: string
  content: string
  status: StepStatus
  toolCalls?: ToolCall[]
  startedAt: number
  completedAt?: number
}

export interface ReasoningPhase {
  id: string
  index: 1 | 2 | 3 | 4 | 5
  name: string
  status: StepStatus
  steps: ReasoningStep[]
  startedAt: number
  completedAt?: number
}

export interface ReasoningData {
  id: string
  version: number
  phases: ReasoningPhase[]
  status: StepStatus
  startedAt: number
  completedAt?: number
}

export const PHASE_NAMES: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'Assumptions',
  2: 'Heuristics',
  3: 'First Principles',
  4: 'Extension',
  5: 'Convergence',
}

export const PHASE_ICONS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: '◈',
  2: '⟳',
  3: '∴',
  4: '⤳',
  5: '⊕',
}
