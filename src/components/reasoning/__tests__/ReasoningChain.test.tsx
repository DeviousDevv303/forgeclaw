import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ReasoningChainComponent } from '../ReasoningChain'
import type { ReasoningChain, ReasoningStep } from '../../../types/reasoning'

function makeStep(id: string, status: ReasoningStep['status'] = 'done', label = 'Step'): ReasoningStep {
  return {
    id,
    icon: '✅',
    label,
    status,
    timestamp: new Date().toISOString(),
  }
}

const completeChain: ReasoningChain = {
  id: 'chain-001',
  rootLabel: 'Reasoning trace',
  steps: [
    makeStep('s1', 'done', 'Assumptions'),
    makeStep('s2', 'done', 'Heuristics'),
    makeStep('s3', 'done', 'Convergence'),
  ],
  startedAt: new Date(Date.now() - 2000).toISOString(),
  completedAt: new Date().toISOString(),
}

const activeChain: ReasoningChain = {
  id: 'chain-002',
  rootLabel: 'Live reasoning',
  steps: [
    makeStep('s1', 'done', 'Assumptions'),
    makeStep('s2', 'active', 'Heuristics'),
  ],
  startedAt: new Date().toISOString(),
}

const emptyChain: ReasoningChain = {
  id: 'chain-003',
  rootLabel: 'Empty chain',
  steps: [],
  startedAt: new Date().toISOString(),
}

describe('ReasoningChainComponent', () => {
  it('renders the chain root label', () => {
    render(<ReasoningChainComponent chain={completeChain} />)
    expect(screen.getByText('Reasoning trace')).toBeInTheDocument()
  })

  it('starts expanded by default', () => {
    render(<ReasoningChainComponent chain={completeChain} />)
    expect(screen.getByText('Assumptions')).toBeInTheDocument()
    expect(screen.getByText('Heuristics')).toBeInTheDocument()
  })

  it('shows step count in header', () => {
    render(<ReasoningChainComponent chain={completeChain} />)
    expect(screen.getByText(/3 steps/)).toBeInTheDocument()
  })

  it('shows "done" label when chain is complete', () => {
    render(<ReasoningChainComponent chain={completeChain} />)
    expect(screen.getByText(/done/)).toBeInTheDocument()
  })

  it('clicking toggle collapses the chain', () => {
    render(<ReasoningChainComponent chain={completeChain} />)
    expect(screen.getByText('Assumptions')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByText('Assumptions')).not.toBeInTheDocument()
  })

  it('clicking toggle again re-expands', () => {
    render(<ReasoningChainComponent chain={completeChain} />)
    const btn = screen.getByRole('button')
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(screen.getByText('Assumptions')).toBeInTheDocument()
  })

  it('shows "Waiting for steps..." when chain has no steps', () => {
    render(<ReasoningChainComponent chain={emptyChain} />)
    expect(screen.getByText('Waiting for steps...')).toBeInTheDocument()
  })

  it('shows active step count when chain is in progress', () => {
    render(<ReasoningChainComponent chain={activeChain} />)
    expect(screen.getByText(/2 steps/)).toBeInTheDocument()
  })

  it('shows progress bar when there are active steps', () => {
    const { container } = render(<ReasoningChainComponent chain={activeChain} />)
    const progressBar = container.querySelector('.bg-orange-500')
    expect(progressBar).toBeTruthy()
  })
})
