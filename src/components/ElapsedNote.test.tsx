// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ElapsedNote } from './ElapsedNote'
import { ELAPSED_NOTE_DELAY_MS, formatElapsed } from '../lib/elapsed'

afterEach(() => { cleanup(); vi.useRealTimers() })

describe('ElapsedNote', () => {
  it('formats elapsed time as m:ss', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(65_400)).toBe('1:05')
    expect(formatElapsed(14 * 60_000 + 9_000)).toBe('14:09')
  })

  it('stays hidden for quick replies, then ticks and names the DeepSeek wait', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    render(<ElapsedNote since={1_000_000} deepSeek />)
    expect(screen.queryByRole('status')).toBeNull()

    act(() => { vi.advanceTimersByTime(ELAPSED_NOTE_DELAY_MS + 1_000) })
    expect(screen.getByRole('status').textContent).toBe('Still working · 0:06 · DeepSeek usually takes 10–17 min')

    act(() => { vi.advanceTimersByTime(4 * 60_000) })
    expect(screen.getByRole('status').textContent).toContain('Still working · 4:06')
  })

  it('omits the DeepSeek hint for other providers', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    render(<ElapsedNote since={1_000_000} deepSeek={false} />)
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(screen.getByRole('status').textContent).toBe('Still working · 0:10')
  })
})
