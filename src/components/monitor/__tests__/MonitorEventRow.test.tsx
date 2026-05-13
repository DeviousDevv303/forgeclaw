import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MonitorEventRow } from '../MonitorEventRow'
import type { OrchestratorEvent } from '../../../types/orchestrator'

const base: OrchestratorEvent = {
  eventId: 'evt-001',
  timestamp: new Date(Date.now() - 5000).toISOString(), // 5s ago
  type: 'task_admitted',
  severity: 'info',
  agentId: 'forgemind',
}

describe('MonitorEventRow', () => {
  it('renders agent id', () => {
    render(<MonitorEventRow event={base} now={Date.now()} />)
    expect(screen.getByText(/forgemind/)).toBeInTheDocument()
  })

  it('renders human-readable event type', () => {
    render(<MonitorEventRow event={base} now={Date.now()} />)
    expect(screen.getByText(/task admitted/)).toBeInTheDocument()
  })

  it('shows age in seconds for recent events', () => {
    const now = Date.now()
    const event: OrchestratorEvent = { ...base, timestamp: new Date(now - 10000).toISOString() }
    render(<MonitorEventRow event={event} now={now} />)
    expect(screen.getByText('10s')).toBeInTheDocument()
  })

  it('shows age in minutes for older events', () => {
    const now = Date.now()
    const event: OrchestratorEvent = { ...base, timestamp: new Date(now - 120000).toISOString() }
    render(<MonitorEventRow event={event} now={now} />)
    expect(screen.getByText('2m')).toBeInTheDocument()
  })

  it('shows task id slice when taskSpec is present', () => {
    const event: OrchestratorEvent = {
      ...base,
      taskSpec: {
        taskId: 'abcdef1234567890',
        agentId: 'forgemind',
        intent: 'test',
        payload: {},
        timeout: 5000,
        requestedScopes: [],
      },
    }
    render(<MonitorEventRow event={event} now={Date.now()} />)
    expect(screen.getByText(/abcdef12/)).toBeInTheDocument()
  })

  it('renders correct icon for task_rejected', () => {
    const event: OrchestratorEvent = { ...base, type: 'task_rejected', severity: 'warning' }
    const { container } = render(<MonitorEventRow event={event} now={Date.now()} />)
    expect(container.textContent).toContain('✗')
  })

  it('renders correct icon for authority_violation', () => {
    const event: OrchestratorEvent = { ...base, type: 'authority_violation', severity: 'warning' }
    const { container } = render(<MonitorEventRow event={event} now={Date.now()} />)
    expect(container.textContent).toContain('⚠')
  })

  it('renders correct icon for recovery_triggered', () => {
    const event: OrchestratorEvent = { ...base, type: 'recovery_triggered', severity: 'warning' }
    const { container } = render(<MonitorEventRow event={event} now={Date.now()} />)
    expect(container.textContent).toContain('↺')
  })
})
