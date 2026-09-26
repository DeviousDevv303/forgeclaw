/*
 * ForgeClaw — Authorized Agent runtime sections 2–7 and validation 1–12.
 *
 * Decisions: use mocked Ollama-compatible responses and a tiny localStorage
 * implementation to verify persistence and lifecycle behavior without requiring
 * a running phone service. Tests exercise the module-level worker, not React.
 *
 * Unfinished/untested: browser navigation and full Android process-kill recovery
 * require a browser/device acceptance run; reload recovery is covered by the
 * persisted task shape and runtime initialization contract.
 */

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAgentTask, getAgentTask, initializeAgentTasks, subscribeAgentTask } from './agentTaskRuntime'

const storage = new Map<string, string>()
const localStorageMock = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value) },
  removeItem: (key: string) => { storage.delete(key) },
}

function waitForTerminal(taskId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('task did not reach a terminal state')), 2_000)
    subscribeAgentTask(taskId, task => {
      if (task.status === 'completed' || task.status === 'failed') {
        clearTimeout(timeout)
        resolve()
      }
    })
  })
}

describe('persisted Agent task runtime', () => {
  beforeEach(() => {
    storage.clear()
    Object.assign(globalThis, { localStorage: localStorageMock })
    vi.restoreAllMocks()
    initializeAgentTasks()
  })

  it('persists Chat-delegated work and completes through the Agent worker', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ model: 'test', message: { role: 'assistant', content: 'agent result' }, done: true, done_reason: 'stop' }), { status: 200 }))
    const task = createAgentTask({
      agentId: 'forgemind', agentKey: 'forgemind-chat', intent: 'chat-agent-delegation',
      task: 'do a safe task', systemPrompt: 'You are a test agent.', provider: 'ollama', model: 'test', allowedTools: [],
      conversation: [{ role: 'user', content: 'do a safe task' }],
    }, { apiKey: 'http://127.0.0.1:11434', toolContext: { ghToken: '', ghOwner: 'test', ghRepo: 'test' } })
    await waitForTerminal(task.taskId)
    const stored = getAgentTask(task.taskId)
    expect(stored?.status).toBe('completed')
    expect(stored?.result).toBe('agent result')
    expect(stored?.conversation.at(-1)?.content).toBe('agent result')
    expect(localStorageMock.getItem('forgeclaw_agent_tasks_v1')).toContain(task.taskId)
  })

  it('marks provider failure as failed and never completed', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    const task = createAgentTask({
      agentId: 'forgemind', agentKey: 'test-agent', intent: 'agent-panel-conversation',
      task: 'fail safely', systemPrompt: 'You are a test agent.', provider: 'ollama', model: 'test', allowedTools: ['memory_read'],
      conversation: [{ role: 'user', content: 'fail safely' }],
    }, { apiKey: 'http://127.0.0.1:11434', toolContext: { ghToken: '', ghOwner: 'test', ghRepo: 'test' } })
    await waitForTerminal(task.taskId)
    const stored = getAgentTask(task.taskId)
    expect(stored?.status).toBe('failed')
    expect(stored?.result).toBeUndefined()
    expect(stored?.error).toContain('Failed to fetch')
  })
})
