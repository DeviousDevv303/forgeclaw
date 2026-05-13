export interface AgentLane {
  agentId: string
  status: 'idle' | 'working' | 'blocked' | 'reviewing'
  currentTask?: string
  lastActivity: number // unix ms
  sha?: string // last staged/reviewed commit
}

export interface Proposal {
  id: string
  from: string
  proposal: string
  status: 'pending' | 'acknowledged' | 'rejected'
  timestamp: number
}

export interface AgentSnapshot {
  agentId: string
  status: 'idle' | 'working' | 'blocked' | 'reviewing'
  currentTask?: string
  sha?: string
  priority: 'info' | 'blocker' | 'proposal'
  message?: string
  timestamp: number
}

export interface CristianDecision {
  targetId: string
  decision: 'acknowledged' | 'rejected' | 'deferred'
  note?: string
  timestamp: number
}
