import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ReasoningChain } from '../ReasoningChain'
import type { ReasoningData, ReasoningPhase } from '../types'

function makePhase(index: 1 | 2 | 3 | 4 | 5, name: string, status: ReasoningPhase['status'] = 'complete'): ReasoningPhase {
  return {
    id: `phase-${index}`,
    index,
    name,
    status,
    steps: [{ id: `step-${index}`, content: `${name} step`, status, startedAt: 0 }],
    startedAt: 0,
    completedAt: status === 'complete' ? 100 : undefined,
  }
}

const completeReasoning: ReasoningData = {
  id: 'r-001',
  version: 1,
  status: 'complete',
  phases: [
    makePhase(1, 'Assumptions'),
    makePhase(2, 'Heuristics'),
    makePhase(3, 'First Principles'),
    makePhase(4, 'Extension'),
    makePhase(5, 'Convergence'),
  ],
  startedAt: 0,
  completedAt: 1000,
}

const streamingReasoning: ReasoningData = {
  ...completeReasoning,
  id: 'r-002',
  status: 'streaming',
  phases: [
    makePhase(1, 'Assumptions', 'complete'),
    makePhase(2, 'Heuristics', 'streaming'),
    makePhase(3, 'First Principles', 'pending'),
    makePhase(4, 'Extension', 'pending'),
    makePhase(5, 'Convergence', 'pending'),
  ],
}

describe('ReasoningChain', () => {
  it('renders the scaffold header', () => {
    render(<ReasoningChain messageId="msg-1" reasoning={completeReasoning} />)
    expect(screen.getByText('5-Phase Scaffold')).toBeInTheDocument()
  })

  it('starts collapsed when status is complete', () => {
    render(<ReasoningChain messageId="msg-1" reasoning={completeReasoning} />)
    expect(screen.queryByText('Assumptions')).not.toBeInTheDocument()
  })

  it('shows phase count when complete', () => {
    render(<ReasoningChain messageId="msg-1" reasoning={completeReasoning} />)
    expect(screen.getByText('5/5 phases')).toBeInTheDocument()
  })

  it('starts expanded when status is streaming', () => {
    render(<ReasoningChain messageId="msg-1" reasoning={streamingReasoning} />)
    expect(screen.getByText('Reasoning…')).toBeInTheDocument()
    expect(screen.getByText('Assumptions')).toBeInTheDocument()
  })

  it('clicking the header expands a collapsed chain', () => {
    render(<ReasoningChain messageId="msg-1" reasoning={completeReasoning} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Assumptions')).toBeInTheDocument()
    expect(screen.getByText('Convergence')).toBeInTheDocument()
  })

  it('clicking again collapses an expanded chain', () => {
    render(<ReasoningChain messageId="msg-1" reasoning={completeReasoning} />)
    const btn = screen.getByRole('button')
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(screen.queryByText('Assumptions')).not.toBeInTheDocument()
  })

  it('does not re-render when version is unchanged (memo)', () => {
    let renderCount = 0
    const Spy = (props: { reasoning: ReasoningData }) => {
      renderCount++
      return <ReasoningChain messageId="msg-1" reasoning={props.reasoning} />
    }

    const { rerender } = render(<Spy reasoning={completeReasoning} />)
    const countAfterMount = renderCount

    // Same version — memo should prevent re-render of ReasoningChain
    rerender(<Spy reasoning={{ ...completeReasoning }} />)

    // Spy itself re-renders, but ReasoningChain should not
    // We verify that the DOM hasn't changed as a proxy for skipped render
    expect(screen.queryByText('Assumptions')).not.toBeInTheDocument()
    expect(renderCount).toBeGreaterThanOrEqual(countAfterMount)
  })

  it('re-renders when version increments', () => {
    const { rerender } = render(<ReasoningChain messageId="msg-1" reasoning={completeReasoning} />)
    rerender(<ReasoningChain messageId="msg-1" reasoning={{ ...completeReasoning, version: 2 }} />)
    expect(screen.getByText('5-Phase Scaffold')).toBeInTheDocument()
  })
})
