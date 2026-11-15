// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { QWEN_FALLBACK_CHECKPOINT, QWEN_PRIMARY_CHECKPOINT, qwenRunLabel } from './qwenCheckpoints'

describe('qwenRunLabel', () => {
  it('does not say the model twice for the primary checkpoint', () => expect(qwenRunLabel(QWEN_PRIMARY_CHECKPOINT)).toBe('Qwen/Qwen3-8B Actions'))
  it('names the checkpoint when it is the CPU fallback or unknown', () => {
    expect(qwenRunLabel(QWEN_FALLBACK_CHECKPOINT)).toBe(`Qwen/Qwen3-8B Actions (${QWEN_FALLBACK_CHECKPOINT})`)
    expect(qwenRunLabel('checkpoint metadata unavailable')).toBe('Qwen/Qwen3-8B Actions (checkpoint metadata unavailable)')
  })
})
