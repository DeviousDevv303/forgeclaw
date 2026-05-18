import type { ToolFailureClass } from '../lib/agentCore'

// Re-export so forgeOps owns the canonical AgentPhase definition
export type AgentPhase =
  | 'OBJECTIVE' | 'PLAN' | 'EXECUTION' | 'VERIFICATION' | 'NEXT_ACTION' | 'COMPLETE' | 'BLOCKED'

export type ForgeStage =
  | 'RAW_ORE' | 'SMELTING' | 'HAMMERING' | 'TEMPERING' | 'REFORGING' | 'COMPLETE' | 'BLOCKED'

export type AgentEvent =
  | { type: 'OBJECTIVE_RECEIVED'; objective: string; timestamp: number }
  | { type: 'PHASE_CHANGE'; phase: AgentPhase; timestamp: number }
  | { type: 'TOOL_START'; tool: string; timestamp: number; iter: number }
  | { type: 'TOOL_SUCCESS'; tool: string; timestamp: number }
  | { type: 'TOOL_FAILURE'; tool: string; failClass: ToolFailureClass; timestamp: number }
  | { type: 'RETRY_DECISION'; tool: string; strategy: string; shouldRetry: boolean; timestamp: number }
  | { type: 'CONFIDENCE_UPDATE'; value: number; timestamp: number }
  | { type: 'CHECKPOINT'; iter: number; total: number; timestamp: number }
  | { type: 'MISSION_COMPLETE'; timestamp: number }
  | { type: 'MISSION_BLOCKED'; reason: string; timestamp: number }
  | { type: 'RESET'; timestamp: number }

export interface ForgeOpsState {
  objective: string
  stage: ForgeStage
  phase: AgentPhase
  events: AgentEvent[]
  toolBus: Record<string, 'active' | 'idle' | 'error'>
  confidence: number
  retryCount: number
  iterCurrent: number
  iterTotal: number
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'
}

export const INITIAL_FORGE_STATE: ForgeOpsState = {
  objective: '',
  stage: 'RAW_ORE',
  phase: 'OBJECTIVE',
  events: [],
  toolBus: {},
  confidence: 0.72,
  retryCount: 0,
  iterCurrent: 0,
  iterTotal: 40,
  riskLevel: 'LOW',
}

export function phaseToStage(phase: AgentPhase): ForgeStage {
  switch (phase) {
    case 'OBJECTIVE':     return 'RAW_ORE'
    case 'PLAN':          return 'SMELTING'
    case 'EXECUTION':     return 'HAMMERING'
    case 'NEXT_ACTION':   return 'HAMMERING'
    case 'VERIFICATION':  return 'TEMPERING'
    case 'COMPLETE':      return 'COMPLETE'
    case 'BLOCKED':       return 'BLOCKED'
    default:              return 'RAW_ORE'
  }
}
