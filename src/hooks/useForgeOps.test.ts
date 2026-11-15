// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { MAX_EVENTS, useForgeOps } from './useForgeOps'

describe('useForgeOps event history', () => {
  it('keeps 500 events per session (was 60) and drops the oldest beyond that', () => {
    expect(MAX_EVENTS).toBe(500)
    const { result } = renderHook(() => useForgeOps())
    act(() => { for (let i = 0; i < 520; i++) result.current.emit({ type: 'CHECKPOINT', iter: i, total: 520 }) })
    const events = result.current.state.events
    expect(events.length).toBe(500)
    expect(events[0]).toMatchObject({ type: 'CHECKPOINT', iter: 20 })
    expect(events[499]).toMatchObject({ iter: 519 })
  })
})
