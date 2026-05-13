import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MonitorEventRow } from '../MonitorEventRow'
import type { AgentActivityEvent } from '../../../types/reasoning'

describe('MonitorEventRow', () => {
  it('renders TOOL label for tool_call events', () => {
    const event: AgentActivityEvent = { type: 'tool_call', agentId: 'forgemind', tool: 'grep', args: {}, timestamp: Date.now() }
    render(<MonitorEventRow event={event} />)
    expect(screen.getByText('TOOL')).toBeInTheDocument()
    expect(screen.getByText('grep')).toBeInTheDocument()
  })

  it('renders READ label for file_read events', () => {
    const event: AgentActivityEvent = { type: 'file_read', agentId: 'forgemind', path: 'src/App.tsx', timestamp: Date.now() }
    render(<MonitorEventRow event={event} />)
    expect(screen.getByText('READ')).toBeInTheDocument()
    expect(screen.getByText('src/App.tsx')).toBeInTheDocument()
  })

  it('renders WRITE label for file_write events', () => {
    const event: AgentActivityEvent = { type: 'file_write', agentId: 'forgemind', path: 'src/output.ts', timestamp: Date.now() }
    render(<MonitorEventRow event={event} />)
    expect(screen.getByText('WRITE')).toBeInTheDocument()
    expect(screen.getByText('src/output.ts')).toBeInTheDocument()
  })

  it('renders REASON label for reasoning_phase events', () => {
    const event: AgentActivityEvent = { type: 'reasoning_phase', agentId: 'forgemind', phase: 'assumptions', body: 'body', timestamp: Date.now() }
    render(<MonitorEventRow event={event} />)
    expect(screen.getByText('REASON')).toBeInTheDocument()
    expect(screen.getByText('assumptions')).toBeInTheDocument()
  })

  it('renders STATUS label for agent_status events', () => {
    const event: AgentActivityEvent = { type: 'agent_status', agentId: 'forgemind', status: 'working', timestamp: Date.now() }
    render(<MonitorEventRow event={event} />)
    expect(screen.getByText('STATUS')).toBeInTheDocument()
    expect(screen.getByText('working')).toBeInTheDocument()
  })

  it('renders ERROR label for error events', () => {
    const event: AgentActivityEvent = { type: 'error', agentId: 'forgemind', message: 'Something went wrong', timestamp: Date.now() }
    render(<MonitorEventRow event={event} />)
    expect(screen.getByText('ERROR')).toBeInTheDocument()
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('truncates long error messages to 40 chars', () => {
    const longMsg = 'A'.repeat(60)
    const event: AgentActivityEvent = { type: 'error', agentId: 'forgemind', message: longMsg, timestamp: Date.now() }
    render(<MonitorEventRow event={event} />)
    expect(screen.getByText('A'.repeat(40))).toBeInTheDocument()
    expect(screen.queryByText(longMsg)).not.toBeInTheDocument()
  })

  it('renders a timestamp', () => {
    const ts = new Date('2026-01-01T12:30:45Z').getTime()
    const event: AgentActivityEvent = { type: 'agent_status', agentId: 'forgemind', status: 'idle', timestamp: ts }
    render(<MonitorEventRow event={event} />)
    // timestamp is rendered as localeTimeString — just verify something time-like is in the DOM
    const { container } = render(<MonitorEventRow event={event} />)
    expect(container.textContent).toMatch(/\d{2}:\d{2}:\d{2}/)
  })
})
