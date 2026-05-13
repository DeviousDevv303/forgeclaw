export interface AgentLane {
  agentId: string
  status: 'idle' | 'working' | 'blocked' | 'reviewing'
  currentTask?: string
  lastActivity: number // unix ms
  sha?: string         // last staged/reviewed commit
}

export interface Proposal {
  id: string
  from: string         // agentId
  proposal: string
  status: 'pending' | 'acknowledged' | 'rejected'
  timestamp: number
}

export interface AgentSnapshot {
  agentId: string
  timestamp: number
  status: 'idle' | 'working' | 'blocked' | 'reviewing'
  currentTask?: string
  sha?: string
  message?: string
  priority: 'info' | 'blocker' | 'proposal'
}

export interface CristianDecision {
  targetId: string     // baseName (filename without .json) of the snapshot being responded to
  decision: 'acknowledged' | 'rejected' | 'deferred'
  note?: string
  timestamp: number
}
