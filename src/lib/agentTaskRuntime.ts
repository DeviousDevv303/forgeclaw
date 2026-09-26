/*
 * ForgeClaw — Authorized Agent runtime sections 2–7 and validation sections 1–12.
 *
 * Decisions: use a small localStorage-backed task/event store to avoid a new
 * dependency and keep the runtime usable on an offline Android device. The
 * worker is module-level, not React-owned, so unmounting AgentsPanel does not
 * stop execution. Only explicitly supplied allowedTools are exposed to the
 * existing managed-agent executor; Chat delegation supplies an empty list.
 * Tasks store provider/model/system prompt metadata but never persist API keys.
 *
 * Unfinished/untested: a browser process cannot execute after the entire page
 * process is killed. On reload, persisted running tasks are recovered as queued
 * and resumed when App supplies the current provider configuration.
 */

import { runSubAgent } from './managedAgent'
import type { ProviderId } from './modelProviders'
import { FORGE_TOOLS } from './forgeTools'
import type { ToolContext } from './forgeTools'
import { safeGetItem, safeJsonParse, safeSetItem } from './storage'

export type AgentTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface AgentTaskEvent {
  id: string
  taskId: string
  timestamp: string
  type: 'created' | 'started' | 'progress' | 'completed' | 'failed' | 'recovered' | 'cancelled'
  message: string
  output?: string
}

export interface AgentTask {
  taskId: string
  agentId: 'forgemind' | 'repoagent' | 'github'
  agentKey: string
  intent: string
  task: string
  systemPrompt: string
  provider: ProviderId
  model: string
  allowedTools: string[]
  conversation: Array<{ role: 'user' | 'assistant'; content: string }>
  status: AgentTaskStatus
  result?: string
  error?: string
  createdAt: string
  updatedAt: string
  recoveredAt?: string
  events: AgentTaskEvent[]
}

export interface AgentTaskExecutionConfig {
  apiKey: string
  toolContext: ToolContext
}

type TaskListener = (task: AgentTask) => void

const TASKS_KEY = 'forgeclaw_agent_tasks_v1'
const tasks = new Map<string, AgentTask>()
const listeners = new Map<string, Set<TaskListener>>()
const activeRuns = new Set<string>()
let loaded = false

function now(): string { return new Date().toISOString() }
function taskId(): string { return `agent-task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }

function persist(): void {
  safeSetItem(TASKS_KEY, JSON.stringify([...tasks.values()].slice(-100)))
}

function notify(task: AgentTask): void {
  persist()
  listeners.get(task.taskId)?.forEach(listener => listener({ ...task, events: [...task.events] }))
}

function addEvent(task: AgentTask, type: AgentTaskEvent['type'], message: string, output?: string): void {
  task.events = [...task.events.slice(-99), { id: `${task.taskId}-${task.events.length + 1}`, taskId: task.taskId, timestamp: now(), type, message, output }]
  task.updatedAt = now()
}

function load(): void {
  if (loaded) return
  loaded = true
  const stored = safeJsonParse<AgentTask[]>(safeGetItem(TASKS_KEY), [])
  for (const raw of stored) {
    if (!raw || typeof raw.taskId !== 'string') continue
    const task = { ...raw, conversation: Array.isArray(raw.conversation) ? raw.conversation : [{ role: 'user' as const, content: raw.task }], events: Array.isArray(raw.events) ? raw.events : [] }
    if (task.status === 'running') {
      task.status = 'queued'
      task.recoveredAt = now()
      addEvent(task, 'recovered', 'Recovered an incomplete task after runtime reload; awaiting worker configuration.')
    }
    tasks.set(task.taskId, task)
  }
  persist()
}

function get(taskIdValue: string): AgentTask | undefined {
  load()
  const task = tasks.get(taskIdValue)
  return task ? { ...task, events: [...task.events] } : undefined
}

async function run(task: AgentTask, config: AgentTaskExecutionConfig): Promise<void> {
  if (activeRuns.has(task.taskId) || task.status === 'cancelled' || task.status === 'completed') return
  activeRuns.add(task.taskId)
  task.status = 'running'
  addEvent(task, 'started', 'Agent worker started outside the mounted UI.')
  notify(task)
  try {
    const result = await runSubAgent(
      task.systemPrompt,
      task.task,
      task.allowedTools,
      task.provider,
      task.model,
      config.apiKey,
      FORGE_TOOLS,
      config.toolContext,
    )
    task.result = result
    task.conversation = [...task.conversation.filter(message => message.role === 'user'), { role: 'assistant', content: result }]
    task.status = 'completed'
    addEvent(task, 'completed', 'Agent task completed.', result)
  } catch (error) {
    task.status = 'failed'
    task.error = error instanceof Error ? error.message : String(error)
    task.conversation = [...task.conversation.filter(message => message.role === 'user'), { role: 'assistant', content: `[ERROR]: ${task.error}` }]
    addEvent(task, 'failed', 'Agent task failed; it was not marked completed.', task.error)
  } finally {
    activeRuns.delete(task.taskId)
    notify(task)
  }
}

export function initializeAgentTasks(): void {
  load()
}

export function createAgentTask(input: Omit<AgentTask, 'taskId' | 'status' | 'createdAt' | 'updatedAt' | 'events'>, config: AgentTaskExecutionConfig): AgentTask {
  load()
  const timestamp = now()
  const task: AgentTask = { ...input, taskId: taskId(), status: 'queued', createdAt: timestamp, updatedAt: timestamp, events: [] }
  addEvent(task, 'created', 'Task persisted and queued for the Agent worker.')
  tasks.set(task.taskId, task)
  notify(task)
  void run(task, config)
  return { ...task, events: [...task.events] }
}

export function resumePendingAgentTasks(provider: ProviderId, model: string, config: AgentTaskExecutionConfig): void {
  load()
  for (const task of tasks.values()) {
    if (task.status === 'queued' && task.provider === provider && task.model === model) void run(task, config)
  }
}

export function getAgentTask(taskIdValue: string): AgentTask | undefined { return get(taskIdValue) }

export function listAgentTasks(agentKey?: string): AgentTask[] {
  load()
  return [...tasks.values()].filter(task => !agentKey || task.agentKey === agentKey).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(task => ({ ...task, events: [...task.events] }))
}

export function subscribeAgentTask(taskIdValue: string, listener: TaskListener): () => void {
  load()
  const set = listeners.get(taskIdValue) ?? new Set<TaskListener>()
  set.add(listener)
  listeners.set(taskIdValue, set)
  const current = tasks.get(taskIdValue)
  if (current) listener({ ...current, events: [...current.events] })
  return () => {
    set.delete(listener)
    if (set.size === 0) listeners.delete(taskIdValue)
  }
}

export function cancelAgentTask(taskIdValue: string): AgentTask | undefined {
  const task = get(taskIdValue)
  if (!task || task.status === 'completed' || task.status === 'failed') return task
  task.status = 'cancelled'
  addEvent(task, 'cancelled', 'Task cancelled before completion.')
  tasks.set(task.taskId, task)
  notify(task)
  return { ...task, events: [...task.events] }
}
