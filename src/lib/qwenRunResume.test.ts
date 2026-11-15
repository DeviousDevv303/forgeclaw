// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { QWEN_RESUME_WINDOW_MS, isQwenRunResumable } from './qwenRunResume'

const now = 1_800_000_000_000

describe('isQwenRunResumable', () => {
  it('re-attaches a run inside the workflow window', () => {
    expect(isQwenRunResumable({ dispatchedAt: now - 60_000 }, now)).toBe(true)
  })
  it('still re-attaches at exactly the window (> not >=)', () => {
    expect(isQwenRunResumable({ dispatchedAt: now - QWEN_RESUME_WINDOW_MS }, now)).toBe(true)
  })
  it('does not re-attach a run past the window', () => {
    expect(isQwenRunResumable({ dispatchedAt: now - QWEN_RESUME_WINDOW_MS - 1 }, now)).toBe(false)
  })
})
