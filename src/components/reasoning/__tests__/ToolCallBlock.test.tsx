import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ToolCallBlock } from '../ToolCallBlock'
import type { ToolCall } from '../types'

const baseToolCall: ToolCall = {
  id: 'tc-001',
  name: 'context.resolve',
  args: { query: 'test', depth: 1 },
  status: 'success',
  startedAt: 1000,
  completedAt: 1100,
}

describe('ToolCallBlock', () => {
  it('renders the tool name', () => {
    render(<ToolCallBlock toolCall={baseToolCall} />)
    expect(screen.getByText('context.resolve')).toBeInTheDocument()
  })

  it('args are hidden initially', () => {
    render(<ToolCallBlock toolCall={baseToolCall} />)
    expect(screen.queryByText('ARGS')).not.toBeInTheDocument()
  })

  it('clicking the button reveals args', () => {
    render(<ToolCallBlock toolCall={baseToolCall} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('ARGS')).toBeInTheDocument()
    expect(screen.getByText(/"query"/)).toBeInTheDocument()
  })

  it('clicking again collapses args', () => {
    render(<ToolCallBlock toolCall={baseToolCall} />)
    const btn = screen.getByRole('button')
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(screen.queryByText('ARGS')).not.toBeInTheDocument()
  })

  it('shows result when present and expanded', () => {
    const tc: ToolCall = { ...baseToolCall, result: '{"ok":true}' }
    render(<ToolCallBlock toolCall={tc} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('RESULT')).toBeInTheDocument()
    expect(screen.getByText(/ok.*true/)).toBeInTheDocument()
  })

  it('does not show result section when result is absent', () => {
    render(<ToolCallBlock toolCall={baseToolCall} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByText('RESULT')).not.toBeInTheDocument()
  })

  it('shows "running" label when status is running', () => {
    const tc: ToolCall = { ...baseToolCall, status: 'running' }
    render(<ToolCallBlock toolCall={tc} />)
    expect(screen.getByText('running')).toBeInTheDocument()
  })
})
