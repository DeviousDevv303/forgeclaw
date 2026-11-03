// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReasoningTrace, tracePreview } from './ReasoningTrace'

const count = (n: number) => `${n} lines`
describe('closed reasoning-trace bar', () => {
  it('shows the app-written first line (phase, plan, tools) as before', () => {
    expect(tracePreview(['Phase: execution', 'Plan:'], count, 'ready')).toBe('Phase: execution')
    expect(tracePreview(['Tools:'], count, 'ready')).toBe('Tools:')
  })
  it("never shows a provider's raw reasoning, including a fragment cut mid-sentence", () => {
    expect(tracePreview(["Then that's exactly what we need to get you is an automation timer"], count, 'ready')).toBe('1 lines')
    expect(tracePreview(['Status: BLOCKED (USER_CONSTRAINT) — nothing merged, no state changed.', 'second'], count, 'ready')).toBe('2 lines')
  })
  it('an empty trace says it is ready', () => expect(tracePreview([], count, 'ready')).toBe('ready'))
  it('renders no reasoning text until the bar is opened, and the full text after', () => {
    const raw = 'Now I have everything for the report. Let me assemble:\nsecond line'
    let open = false
    const { rerender } = render(<ReasoningTrace trace={raw} isOpen={open} onToggle={() => { open = !open }} />)
    expect(screen.queryByText(/Now I have everything/)).toBeNull()
    fireEvent.click(screen.getByRole('button'))
    rerender(<ReasoningTrace trace={raw} isOpen={open} onToggle={() => {}} />)
    expect(screen.getByText(/Now I have everything/)).toBeTruthy()
    cleanup()
  })
})
