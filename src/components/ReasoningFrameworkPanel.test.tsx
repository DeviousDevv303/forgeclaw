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
})
