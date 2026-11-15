import { describe, expect, it } from 'vitest'
import { ANTHROPIC_MODELS, DEFAULT_ANTHROPIC_MODEL, resolveAnthropicModel } from './anthropicProvider'

describe('resolveAnthropicModel', () => {
  it('keeps a saved model that is still offered', () => {
    expect(resolveAnthropicModel('claude-sonnet-5-5')).toBe('claude-sonnet-5-5')
  })
  it.each(['claude-3-5-haiku-latest', 'claude-3-7-sonnet-latest', 'claude-sonnet-4-20250514', '', null, undefined])(
    'migrates stale or missing value %s to the default', (stored) => {
      expect(resolveAnthropicModel(stored)).toBe(DEFAULT_ANTHROPIC_MODEL)
    })
  it('offers only current model strings', () => {
    expect(ANTHROPIC_MODELS.map(m => m.id)).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'])
  })
})
