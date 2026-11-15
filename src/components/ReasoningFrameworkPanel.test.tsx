// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReasoningFrameworkPanel } from './ReasoningFrameworkPanel'

beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe('Settings: your reasoning framework', () => {
  it('saves into this browser, shows it active, and clears', () => {
    render(<ReasoningFrameworkPanel />)
    expect(screen.getByText(/not set/)).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Phase A: look' } })
    fireEvent.click(screen.getByRole('button', { name: 'SAVE' }))
    expect(localStorage.getItem('fc_owner_scaffold_v1')).toBe('Phase A: look')
    expect(screen.getByText(/active/)).toBeTruthy()
    cleanup()
    render(<ReasoningFrameworkPanel />)
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Phase A: look')
    fireEvent.click(screen.getByRole('button', { name: 'CLEAR' }))
    expect(localStorage.getItem('fc_owner_scaffold_v1')).toBeNull()
  })

  // 2026-10-23: the box used to cut a long paste at 3,000 characters with no sign, dropping the framework's later phases.
  it('takes a long framework whole, and never cuts silently', () => {
    render(<ReasoningFrameworkPanel />)
    const full = `PHASE 1 assumptions ${'a'.repeat(4000)} PHASE 5 CONVERGENCE`
    fireEvent.change(screen.getByRole('textbox'), { target: { value: full } })
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'SAVE' }))
    expect(localStorage.getItem('fc_owner_scaffold_v1')).toContain('PHASE 5 CONVERGENCE')

    const tooLong = `${'b'.repeat(12_000)}LOST PHASE`
    fireEvent.change(screen.getByRole('textbox'), { target: { value: tooLong } })
    expect(screen.getByRole('alert').textContent).toMatch(/only the first 12,000 characters are used.*LOST PHASE/)
    fireEvent.click(screen.getByRole('button', { name: 'SAVE' }))
    expect(screen.getByRole('status').textContent).toMatch(/last 10 characters were past the 12,000 limit and were cut/)
  })

  it('flags a framework that the old 3,000 limit probably cut', () => {
    localStorage.setItem('fc_owner_scaffold_v1', 'x'.repeat(3000))
    render(<ReasoningFrameworkPanel />)
    expect(screen.getByRole('alert').textContent).toMatch(/exactly 3,000 characters, the old limit, so it was probably cut/)
  })
})
