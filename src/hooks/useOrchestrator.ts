import { useState, useCallback } from 'react'
import type { AgentContract, AgentId, AuthorityScope, OrchestratorEvent, TaskSpec } from '../types/orchestrator'
import type { EmitFailureOptions } from './useErrorBus'

// ─── v1 Agent Contracts (hardcoded) ──────────────────────────────────────────

const AGENT_CONTRACTS: Record<AgentId, AgentContract> = {
  forgemind: {
    id: 'forgemind',
    version: '1.0.0',
    capabilities: [
      { name: 'chat', scopes: ['corpus:read', 'corpus:write', 'errorBus:emit', 'localStorage:read', 'localStorage:write'], description: 'Send prompts and receive structured reasoning responses' },
      { name: 'corpus_export', scopes: ['corpus:read'], description: 'Export JSONL corpus of interactions' },
    ],
    maxScopes: ['corpus:read', 'corpus:write', 'errorBus:emit', 'localStorage:read', 'localStorage:write', 'llm:generate'],
    maxRetries: 3,
    inputSchema: { prompt: 'string' },
    outputSchema: { content: 'string', phases: 'object' },
  },
  repoagent: {
    id: 'repoagent',
    version: '1.0.0',
    capabilities: [
      { name: 'repo_browse', scopes: ['github:read'], description: 'Browse repository file tree and read file contents' },
      { name: 'repo_push', scopes: ['github:read', 'github:write'], description: 'Edit and push file changes to repository' },
      { name: 'workflow_dispatch', scopes: ['github:read', 'github:dispatch'], description: 'Trigger GitHub Actions workflow runs' },
    ],
    maxScopes: ['github:read', 'github:write', 'github:dispatch', 'errorBus:emit'],
    maxRetries: 2,
    inputSchema: { repoUrl: 'string', path: 'string' },
    outputSchema: { content: 'string', sha: 'string' },
  },
  ollama: {
    id: 'ollama',
    version: '1.0.0',
    capabilities: [
      { name: 'local_inference', scopes: ['errorBus:emit'], description: 'Run local model inference via Ollama' },
    ],
    maxScopes: ['errorBus:emit'],
    maxRetries: 1,
    inputSchema: { prompt: 'string', model: 'string' },
    outputSchema: { response: 'string' },
  },
  claude: {
    id: 'claude',
    version: '1.0.0',
    capabilities: [
      { name: 'cloud_inference', scopes: ['errorBus:emit'], description: 'Run cloud inference via Anthropic API' },
    ],
    maxScopes: ['errorBus:emit'],
    maxRetries: 2,
    inputSchema: { prompt: 'string', apiKey: 'string' },
    outputSchema: { content: 'string' },
  },
  github: {
    id: 'github',
    version: '1.0.0',
    capabilities: [
      { name: 'api_access', scopes: ['github:read', 'github:write', 'github:dispatch'], description: 'GitHub REST API access' },
    ],
    maxScopes: ['github:read', 'github:write', 'github:dispatch', 'errorBus:emit'],
    maxRetries: 2,
    inputSchema: { endpoint: 'string', token: 'string' },
    outputSchema: { data: 'unknown' },
  },
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseOrchestratorOptions {
  emitFailure: (opts: EmitFailureOptions) => string
}

export function useOrchestrator({ emitFailure }: UseOrchestratorOptions) {
  const [taskQueue, setTaskQueue] = useState<TaskSpec[]>([])
  const [events, setEvents] = useState<OrchestratorEvent[]>([])

  const getAgentContract = useCallback((agentId: AgentId): AgentContract | undefined => {
    return AGENT_CONTRACTS[agentId]
  }, [])

  const emitOrchestratorEvent = useCallback((event: OrchestratorEvent) => {
    setEvents(prev => [event, ...prev])
    emitFailure({
      source: 'orchestrator',
      severity: event.severity,
      message: `[${event.type}] agent=${event.agentId}${event.reason ? ` — ${event.reason}` : ''}`,
      context: { eventId: event.eventId, taskId: event.taskSpec?.taskId },
    })
  }, [emitFailure])

  const admitTask = useCallback((taskSpec: TaskSpec): boolean => {
    const contract = AGENT_CONTRACTS[taskSpec.agentId]
    const baseEvent = {
      eventId: `orch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      agentId: taskSpec.agentId,
      taskSpec,
    }

    if (!contract) {
      emitOrchestratorEvent({
        ...baseEvent,
        type: 'task_rejected',
        severity: 'error',
        reason: `No contract found for agent '${taskSpec.agentId}'`,
      })
      return false
    }

    // Authority check: requestedScopes ⊆ agent.maxScopes
    const unauthorizedScopes = taskSpec.requestedScopes.filter(
      (scope: AuthorityScope) => !contract.maxScopes.includes(scope)
    )

    if (unauthorizedScopes.length > 0) {
      emitOrchestratorEvent({
        ...baseEvent,
        type: 'authority_violation',
        severity: 'warning',
        reason: `Unauthorized scopes: ${unauthorizedScopes.join(', ')}`,
      })
      return false
    }

    // Admit
    setTaskQueue(prev => [...prev, taskSpec])
    emitOrchestratorEvent({
      ...baseEvent,
      type: 'task_admitted',
      severity: 'info',
    })
    return true
  }, [emitOrchestratorEvent])

  const resolveTask = useCallback((taskId: string) => {
    setTaskQueue(prev => prev.filter(t => t.taskId !== taskId))
  }, [])

  return { taskQueue, events, admitTask, resolveTask, getAgentContract, contracts: AGENT_CONTRACTS }
}
