// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { limitNexusContext, MAX_NEXUS_CONTEXT_TOKENS, conservativeTokenCount } from './nexusContext'

describe('NEXUS browser context budget', () => {
  it('keeps the conservative prompt budget at or below 4096 tokens', () => {
    const result = limitNexusContext(
      'system '.repeat(4000),
      [{ role: 'user', content: 'history '.repeat(200000) }],
    )
    expect(result.tokenCount).toBeLessThanOrEqual(MAX_NEXUS_CONTEXT_TOKENS)
    expect(conservativeTokenCount(result.systemPrompt) + result.messages.reduce((sum, message) => sum + conservativeTokenCount(message.content), 0)).toBeLessThanOrEqual(MAX_NEXUS_CONTEXT_TOKENS)
  })

  it('drops old messages and preserves the newest message under a million-token class input', () => {
    const history = Array.from({ length: 20000 }, (_, index) => ({
      role: index % 2 ? 'assistant' as const : 'user' as const,
      content: `old-${index} ${'x'.repeat(500)}`,
    }))
    const result = limitNexusContext('system', [...history, { role: 'user', content: 'NEWEST_MESSAGE' }])
    expect(result.tokenCount).toBeLessThanOrEqual(MAX_NEXUS_CONTEXT_TOKENS)
    expect(result.messages.at(-1)?.content).toContain('NEWEST_MESSAGE')
    expect(result.messages.length).toBeLessThan(history.length)
  })
})
