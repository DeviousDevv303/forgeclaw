// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  ensureAgentSession,
  getAgentSessionsSnapshot,
  setActiveAgentId,
  updateAgentSession,
} from './agentSessionStore'

describe('persistent specialist sessions', () => {
  it('retains the active agent conversation and loading state outside the panel component', () => {
    const agent = { id: `test-agent-${Date.now()}`, name: 'GitHub specialist', systemPrompt: 'Work on GitHub tasks.' }
    ensureAgentSession(agent)
    setActiveAgentId(agent.id)
    updateAgentSession(agent.id, session => ({
      ...session,
      loading: true,
      messages: [
        { role: 'user', content: 'Inspect the repository.' },
        { role: 'assistant', content: 'Working…', streaming: true },
      ],
    }))

    const snapshot = getAgentSessionsSnapshot()
    expect(snapshot.activeAgentId).toBe(agent.id)
    expect(snapshot.sessions[agent.id]?.loading).toBe(true)
    expect(snapshot.sessions[agent.id]?.messages).toHaveLength(2)
  })
})
