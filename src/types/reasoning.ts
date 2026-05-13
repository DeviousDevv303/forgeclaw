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

// ─── Agent Activity Event Union ─────────────────────────────────────────────

export type AgentActivityEvent =
  | { type: 'tool_call'; agentId: string; tool: string; args: unknown; timestamp: number; durationMs?: number }
  | { type: 'file_read' | 'file_write'; agentId: string; path: string; timestamp: number }
  | { type: 'reasoning_phase'; agentId: string; phase: ReasoningPhase; body: string; timestamp: number }
  | { type: 'agent_status'; agentId: string; status: 'idle' | 'working' | 'error'; timestamp: number }
  | { type: 'error'; agentId: string; message: string; timestamp: number }

// ─── Message Role Extension ─────────────────────────────────────────────────

export type MessageRole = 'user' | 'assistant' | 'reasoning' | 'monitor'
