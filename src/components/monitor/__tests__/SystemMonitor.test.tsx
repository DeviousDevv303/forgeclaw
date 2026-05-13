import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { SystemMonitor } from '../SystemMonitor'
import type { OrchestratorEvent } from '../../../types/orchestrator'

function makeEvent(i: number, type: OrchestratorEvent['type'] = 'task_admitted'): OrchestratorEvent {
  return {
    eventId: `evt-${i}`,
    timestamp: new Date(Date.now() - i * 1000).toISOString(),
    type,
    severity: 'info',
    agentId: 'forgemind',
  }
}

describe('SystemMonitor', () => {
  it('renders nothing when events are empty and collapsed', () => {
    const { container } = render(<SystemMonitor events={[]} />)
    // With 0 events, collapsed=false by default so header is shown
    expect(container.firstChild).toBeTruthy()
  })

  it('shows event count', () => {
    const events = [makeEvent(1), makeEvent(2), makeEvent(3)]
    render(<SystemMonitor events={events} />)
    expect(screen.getByText(/3 events/)).toBeInTheDocument()
  })

  it('shows singular "event" for exactly 1 event', () => {
    render(<SystemMonitor events={[makeEvent(1)]} />)
    expect(screen.getByText(/1 event\b/)).toBeInTheDocument()
  })

  it('clicking toggle collapses the panel', () => {
    const events = [makeEvent(1)]
    render(<SystemMonitor events={events} />)
    // Panel starts expanded (collapsed=false), so event rows are visible
    expect(screen.getByText(/task admitted/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByText(/task admitted/)).not.toBeInTheDocument()
  })

  it('clicking toggle again re-expands', () => {
    const events = [makeEvent(1)]
    render(<SystemMonitor events={events} />)
    const btn = screen.getByRole('button')
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(screen.getByText(/task admitted/)).toBeInTheDocument()
  })

  it('windows to 20 events maximum', () => {
    const events = Array.from({ length: 25 }, (_, i) => makeEvent(i))
    render(<SystemMonitor events={events} />)
    // 25 events present, only 20 rows rendered (each shows agent id "forgemind")
    const rows = screen.getAllByText(/forgemind/)
    expect(rows.length).toBe(20)
  })

  it('renders "no events yet" when events are empty and panel is open', () => {
    render(<SystemMonitor events={[]} />)
    expect(screen.getByText('no events yet')).toBeInTheDocument()
  })
})
