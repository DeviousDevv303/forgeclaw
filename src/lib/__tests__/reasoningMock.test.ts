import { describe, it, expect } from 'vitest'
import { simulateReasoningStream, collectMockEvents } from '../reasoningMock'

describe('simulateReasoningStream', () => {
  it('is a generator that yields AgentActivityEvents', () => {
    const gen = simulateReasoningStream('test-agent')
    const first = gen.next()
    expect(first.done).toBe(false)
    expect(first.value).toHaveProperty('type')
    expect(first.value).toHaveProperty('agentId', 'test-agent')
    expect(first.value).toHaveProperty('timestamp')
  })

  it('yields all 5 reasoning phases', () => {
    const events = [...simulateReasoningStream()]
    const phases = events
      .filter(e => e.type === 'reasoning_phase')
      .map(e => e.type === 'reasoning_phase' ? e.phase : null)
    expect(phases).toContain('assumptions')
    expect(phases).toContain('heuristics')
    expect(phases).toContain('first_principles')
    expect(phases).toContain('extension')
    expect(phases).toContain('convergence')
  })

  it('starts with agent_status working and ends with agent_status idle', () => {
    const events = [...simulateReasoningStream()]
    const first = events[0]
    const last = events[events.length - 1]
    expect(first.type).toBe('agent_status')
    if (first.type === 'agent_status') expect(first.status).toBe('working')
    expect(last.type).toBe('agent_status')
    if (last.type === 'agent_status') expect(last.status).toBe('idle')
  })

  it('includes tool_call events', () => {
    const events = [...simulateReasoningStream()]
    expect(events.some(e => e.type === 'tool_call')).toBe(true)
  })

  it('includes file_read or file_write events', () => {
    const events = [...simulateReasoningStream()]
    expect(events.some(e => e.type === 'file_read' || e.type === 'file_write')).toBe(true)
  })

  it('uses "forgemind" as default agentId', () => {
    const events = [...simulateReasoningStream()]
    expect(events.every(e => e.agentId === 'forgemind')).toBe(true)
  })
})

describe('collectMockEvents', () => {
  it('returns an array of events', () => {
    const events = collectMockEvents()
    expect(Array.isArray(events)).toBe(true)
    expect(events.length).toBeGreaterThan(0)
  })

  it('returns same events as spreading the generator', () => {
    const fromGenerator = [...simulateReasoningStream('agent-x')]
    const fromCollect = collectMockEvents('agent-x')
    expect(fromCollect.length).toBe(fromGenerator.length)
    expect(fromCollect[0].type).toBe(fromGenerator[0].type)
  })

  it('accepts a custom agentId', () => {
    const events = collectMockEvents('my-agent')
    expect(events.every(e => e.agentId === 'my-agent')).toBe(true)
  })
})
