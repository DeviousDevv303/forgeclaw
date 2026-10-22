// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { DEEPSEEK_RESUME_WINDOW_MS, isDeepSeekRunResumable } from './deepseekRunResume'

const now = 1_800_000_000_000

describe('isDeepSeekRunResumable', () => {
  it('re-attaches a run inside the workflow window', () => {
    expect(isDeepSeekRunResumable({ dispatchedAt: now - 60_000 }, now)).toBe(true)
  })
  it('still re-attaches at exactly the window (> not >=)', () => {
    expect(isDeepSeekRunResumable({ dispatchedAt: now - DEEPSEEK_RESUME_WINDOW_MS }, now)).toBe(true)
  })
  it('does not re-attach a run past the window', () => {
    expect(isDeepSeekRunResumable({ dispatchedAt: now - DEEPSEEK_RESUME_WINDOW_MS - 1 }, now)).toBe(false)
  })
})
