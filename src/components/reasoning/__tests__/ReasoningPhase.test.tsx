import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ReasoningPhase } from '../ReasoningPhase'
import type { ReasoningStep } from '../../../types/reasoning'

function makeStep(overrides: Partial<ReasoningStep> = {}): ReasoningStep {
  const defaults: ReasoningStep = {
    id: 'step-1',
    icon: '🔍',
    label: 'Assumptions',
    status: 'done',
    timestamp: new Date().toISOString(),
    body: 'Step body content',
  }
  return { ...defaults, ...overrides } as ReasoningStep
}

describe('ReasoningPhase', () => {
  it('renders the step label', () => {
    render(<ReasoningPhase step={makeStep()} />)
    expect(screen.getByText('Assumptions')).toBeInTheDocument()
  })

  it('renders the step icon', () => {
    render(<ReasoningPhase step={makeStep({ icon: '⚙️' })} />)
    expect(screen.getByText('⚙️')).toBeInTheDocument()
  })

  it('starts collapsed when status is done', () => {
    render(<ReasoningPhase step={makeStep({ status: 'done' })} />)
    expect(screen.queryByText('Step body content')).not.toBeInTheDocument()
  })

  it('starts collapsed when status is pending', () => {
    render(<ReasoningPhase step={makeStep({ status: 'pending' })} />)
    expect(screen.queryByText('Step body content')).not.toBeInTheDocument()
  })

  it('starts expanded when status is active', () => {
    render(<ReasoningPhase step={makeStep({ status: 'active' })} />)
    expect(screen.getByText('Step body content')).toBeInTheDocument()
  })

  it('starts expanded when status is error', () => {
    render(<ReasoningPhase step={makeStep({ status: 'error' })} />)
    expect(screen.getByText('Step body content')).toBeInTheDocument()
  })

  it('clicking toggle expands a collapsed step', () => {
    render(<ReasoningPhase step={makeStep({ status: 'done' })} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Step body content')).toBeInTheDocument()
  })

  it('clicking toggle collapses an expanded step', () => {
    render(<ReasoningPhase step={makeStep({ status: 'active' })} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByText('Step body content')).not.toBeInTheDocument()
  })

  it('shows duration when durationMs is provided', () => {
    render(<ReasoningPhase step={makeStep({ status: 'done', durationMs: 420 })} />)
    expect(screen.getByText(/420ms/)).toBeInTheDocument()
  })

  it('renders child steps when expanded', () => {
    const step = makeStep({
      status: 'active',
      children: [makeStep({ id: 'child-1', label: 'Child Step', body: 'Child body' })],
    })
    render(<ReasoningPhase step={step} />)
    expect(screen.getByText('Child Step')).toBeInTheDocument()
  })

  it('does not show children toggle when no children', () => {
    render(<ReasoningPhase step={makeStep({ children: [] })} />)
    const btn = screen.getByRole('button')
    expect(btn.textContent).not.toContain('▶')
  })
})
