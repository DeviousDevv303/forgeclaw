import { safeGetItem, safeSetItem } from './storage'

export interface AgentSessionAgent {
  id: string
  name: string
  systemPrompt: string
}

export interface AgentSessionMessage {
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}

export interface AgentSession {
  agent: AgentSessionAgent
  messages: AgentSessionMessage[]
  loading: boolean
}

type Listener = () => void
const SESSIONS_KEY = 'fc_agent_sessions'
const ACTIVE_KEY = 'fc_active_agent_id'

function loadSessions(): Record<string, AgentSession> {
  const parsed = safeGetItem(SESSIONS_KEY)
  try {
    const value = parsed ? JSON.parse(parsed) as Record<string, AgentSession> : {}
    return Object.fromEntries(Object.entries(value).map(([id, session]) => [id, { ...session, loading: false }]))
  } catch {
    return {}
  }
}

let sessions = loadSessions()
let activeAgentId = safeGetItem(ACTIVE_KEY)
const listeners = new Set<Listener>()
let snapshot = { sessions, activeAgentId: activeAgentId || null }

function notify(): void {
  snapshot = { sessions, activeAgentId: activeAgentId || null }
  safeSetItem(SESSIONS_KEY, JSON.stringify(sessions))
  if (activeAgentId) safeSetItem(ACTIVE_KEY, activeAgentId)
  else safeSetItem(ACTIVE_KEY, '')
  listeners.forEach(listener => listener())
}

export function subscribeAgentSessions(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getAgentSessionsSnapshot(): { sessions: Record<string, AgentSession>; activeAgentId: string | null } {
  return snapshot
}

export function getActiveAgentId(): string | null {
  return activeAgentId || null
}

export function setActiveAgentId(id: string | null): void {
  activeAgentId = id
  notify()
}

export function getAgentSession(id: string): AgentSession | undefined {
  return sessions[id]
}

export function ensureAgentSession(agent: AgentSessionAgent): AgentSession {
  if (!sessions[agent.id]) {
    sessions = { ...sessions, [agent.id]: { agent, messages: [], loading: false } }
    notify()
  } else if (sessions[agent.id].agent.name !== agent.name || sessions[agent.id].agent.systemPrompt !== agent.systemPrompt) {
    sessions = { ...sessions, [agent.id]: { ...sessions[agent.id], agent } }
    notify()
  }
  return sessions[agent.id]
}

export function updateAgentSession(id: string, update: (session: AgentSession) => AgentSession): void {
  const current = sessions[id]
  if (!current) return
  sessions = { ...sessions, [id]: update(current) }
  notify()
}
