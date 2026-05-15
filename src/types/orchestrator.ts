import type { FailureSeverity } from './errorBus'

export type AgentId = 'forgemind' | 'repoagent' | 'ollama' | 'claude' | 'github'

export type AuthorityScope =
  | 'corpus:read' | 'corpus:write'
  | 'github:read' | 'github:write' | 'github:dispatch'
  | 'localStorage:read' | 'localStorage:write'
  | 'errorBus:emit'
  | 'agent:delegate'  // reserved for v2, not enforced
  | 'llm:generate'

export interface Capability {
  name: string
  scopes: AuthorityScope[]
  description: string
}

export interface AgentContract {
  id: AgentId
  version: string
  capabilities: Capability[]
  maxScopes: AuthorityScope[]
  maxRetries: number
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  // Guardian policy fields
  vetoAuthority?: boolean              // can this agent block other agents' tasks
  requiresGuardianValidation?: boolean // all tool executions require Guardian co-sign
  escalationThreshold?: number         // confidence below this triggers escalation (0.0–1.0)
  reviewerChain?: AgentId[]            // ordered list of agents that review this agent's output
  excludedScopes?: AuthorityScope[]    // scopes explicitly denied even if in maxScopes
}

export interface TaskSpec {
  taskId: string
  agentId: AgentId
  intent: string
  payload: unknown
  timeout: number
  requestedScopes: AuthorityScope[]
  fallback?: Omit<TaskSpec, 'fallback'>
}

export interface OrchestratorEvent {
  eventId: string
  timestamp: string
  type: 'task_admitted' | 'task_rejected' | 'authority_violation' | 'recovery_triggered'
  severity: FailureSeverity
  agentId: AgentId
  taskSpec?: TaskSpec
  reason?: string
}
