export interface GuardianTrace {
  R0: boolean  // Contract exists (precondition)
  R1: boolean  // Identity valid (precondition)
  R2: boolean  // Scope authorized (precondition)
  R3: boolean  // Escalation threshold met (heuristic)
  R4: boolean  // High-impact scope detected (heuristic)
  R5: boolean  // Default path (always true)
}

export interface GuardianDecision {
  action: 'ALLOW' | 'BLOCK'
  triggeredRule: 0 | 1 | 2 | 3 | 4 | 5
  trace: GuardianTrace
}

export interface GuardianContext {
  errors: Array<{ agentId: string; timestamp: string }>
  identityValid: boolean
  contracts: Record<string, { maxScopes: string[] }>
}

export interface GuardianLogEntry {
  taskId: string
  agentId: string
  decision: 'ALLOW' | 'BLOCK'
  triggeredRule: 0 | 1 | 2 | 3 | 4 | 5
  trace: GuardianTrace
  timestamp: string
}
