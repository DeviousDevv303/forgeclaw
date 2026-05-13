import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { SystemMonitor } from '../SystemMonitor'
import type { AgentActivityEvent } from '../../../types/reasoning'

function makeEvent(i: number, type: AgentActivityEvent['type'] = 'agent_status'): AgentActivityEvent {
  if (type === 'agent_status') {
    return { type: 'agent_status', agentId: 'forgemind', status: 'working', timestamp: Date.now() - i * 1000 }
  }
  if (type === 'error') {
    return { type: 'error', agentId: 'forgemind', message: `Error ${i}`, timestamp: Date.now() - i * 1000 }
  }
  return { type: 'tool_call', agentId: 'forgemind', tool: `tool-${i}`, args: {}, timestamp: Date.now() - i * 1000 }
}

describe('SystemMonitor', () => {
  it('renders the Cristian\'s Computer header', () => {
    render(<SystemMonitor events={[]} />)
    expect(screen.getByText("Cristian's Computer")).toBeInTheDocument()
  })

  it('shows "System idle" when no events', () => {
    render(<SystemMonitor events={[]} />)
    expect(screen.getByText('System idle')).toBeInTheDocument()
  })

  it('shows event count when events are present', () => {
    const events = [makeEvent(1), makeEvent(2), makeEvent(3)]
    render(<SystemMonitor events={events} />)
    expect(screen.getByText('3 events')).toBeInTheDocument()
  })

  it('starts collapsed — event rows not visible', () => {
    const events = [makeEvent(1)]
    render(<SystemMonitor events={events} />)
    expect(screen.queryByText('working')).not.toBeInTheDocument()
  })

  it('clicking toggle expands the panel', () => {
    const events = [makeEvent(1)]
    render(<SystemMonitor events={events} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('working')).toBeInTheDocument()
  })

  it('clicking toggle again collapses the panel', () => {
    const events = [makeEvent(1)]
    render(<SystemMonitor events={events} />)
    const btn = screen.getByRole('button')
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(screen.queryByText('working')).not.toBeInTheDocument()
  })

  it('shows error indicator when events include an error', () => {
    const events = [makeEvent(1, 'error')]
    render(<SystemMonitor events={events} />)
    expect(screen.getByText('● Error')).toBeInTheDocument()
  })

  it('windows to last 20 events', () => {
    const events = Array.from({ length: 25 }, (_, i) => makeEvent(i, 'tool_call'))
    render(<SystemMonitor events={events} />)
    fireEvent.click(screen.getByRole('button'))
    // Each tool_call event renders the 'TOOL' label via MonitorEventRow
    const rows = screen.getAllByText('TOOL')
    expect(rows.length).toBe(20)
  })

  it('shows active pulse icon when isActive is true', () => {
    render(<SystemMonitor events={[]} isActive />)
    expect(screen.getByText('⚡')).toBeInTheDocument()
  })

  it('shows idle icon when isActive is false', () => {
    render(<SystemMonitor events={[]} isActive={false} />)
    expect(screen.getByText('💤')).toBeInTheDocument()
  })
})
