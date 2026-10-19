// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setLangForTests } from '../lib/i18n'
import { formatElapsed, WAITING_NOTE_DELAY_S } from '../lib/waitingNote'
import { WaitingNote } from './WaitingNote'

describe('formatElapsed', () => {
  it('formats m:ss and never goes negative', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(59.9)).toBe('0:59')
    expect(formatElapsed(65)).toBe('1:05')
    expect(formatElapsed(754)).toBe('12:34')
    expect(formatElapsed(-5)).toBe('0:00')
  })
})

describe('WaitingNote', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-19T12:00:00Z')); __setLangForTests('en') })
  afterEach(() => { cleanup(); vi.useRealTimers(); __setLangForTests('en') })
  const started = () => Date.now()

  it('stays hidden for quick answers', () => {
    render(<WaitingNote startedAt={started()} deepseek />)
    act(() => { vi.advanceTimersByTime((WAITING_NOTE_DELAY_S - 2) * 1000) })
    expect(screen.queryByTestId('waiting-note')).toBeNull()
  })

  it('shows a ticking timer and the DeepSeek expectation once the wait is long', () => {
    render(<WaitingNote startedAt={started()} deepseek />)
    act(() => { vi.advanceTimersByTime(65_000) })
    expect(screen.getByTestId('waiting-note').textContent).toContain('Working… 1:05')
    expect(screen.getByRole('status').textContent).toMatch(/2 to 3 minutes.*STOP/)
  })

  it('does not claim DeepSeek timing for other providers', () => {
    render(<WaitingNote startedAt={started()} deepseek={false} />)
    act(() => { vi.advanceTimersByTime(20_000) })
    expect(screen.getByTestId('waiting-note').textContent).toContain('Working… 0:20')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('speaks Spanish when the interface is Spanish', () => {
    __setLangForTests('es')
    render(<WaitingNote startedAt={started()} deepseek />)
    act(() => { vi.advanceTimersByTime(30_000) })
    expect(screen.getByTestId('waiting-note').textContent).toContain('Trabajando… 0:30')
    expect(screen.getByRole('status').textContent).toContain('DETENER')
  })
})
