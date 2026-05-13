import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ReasoningPhase } from '../ReasoningPhase'
import type { ReasoningPhase as ReasoningPhaseType } from '../types'

const basePhase: ReasoningPhaseType = {
  id: 'phase-1',
  index: 1,
  name: 'Assumptions',
  status: 'complete',
  steps: [
    { id: 'step-1', content: 'Step one content', status: 'complete', startedAt: 0, completedAt: 100 },
  ],
  startedAt: 0,
  completedAt: 500,
}

describe('ReasoningPhase', () => {
  it('renders the phase name', () => {
    render(<ReasoningPhase phase={basePhase} />)
    expect(screen.getByText('Assumptions')).toBeInTheDocument()
  })

  it('starts collapsed when status is complete and defaultOpen is false', () => {
    render(<ReasoningPhase phase={basePhase} />)
    expect(screen.queryByText('Step one content')).not.toBeInTheDocument()
  })

  it('starts open when defaultOpen is true', () => {
    render(<ReasoningPhase phase={basePhase} defaultOpen />)
    expect(screen.getByText('Step one content')).toBeInTheDocument()
  })

  it('starts open when status is streaming', () => {
    const phase: ReasoningPhaseType = { ...basePhase, status: 'streaming' }
    render(<ReasoningPhase phase={phase} />)
    expect(screen.getByText('Step one content')).toBeInTheDocument()
  })

  it('clicking toggle opens a collapsed phase', () => {
    render(<ReasoningPhase phase={basePhase} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Step one content')).toBeInTheDocument()
  })

  it('shows checkmark when complete', () => {
    render(<ReasoningPhase phase={basePhase} />)
    expect(screen.getByText('✓')).toBeInTheDocument()
  })

  it('shows LIVE label when streaming', () => {
    const phase: ReasoningPhaseType = { ...basePhase, status: 'streaming' }
    render(<ReasoningPhase phase={phase} />)
    expect(screen.getByText('LIVE')).toBeInTheDocument()
  })

  it('pending phase has reduced opacity and non-clickable button', () => {
    const phase: ReasoningPhaseType = { ...basePhase, status: 'pending' }
    const { container } = render(<ReasoningPhase phase={phase} />)
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.style.opacity).toBe('0.35')
  })

  it('pending phase does not open on click', () => {
    const phase: ReasoningPhaseType = { ...basePhase, status: 'pending' }
    render(<ReasoningPhase phase={phase} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByText('Step one content')).not.toBeInTheDocument()
  })
})
