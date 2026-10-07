import { describe, expect, it } from 'vitest'
import { DEFAULT_PROVIDER, PROVIDER_IDS, resolveInitialProvider } from './providerDefaults'

describe('canonical provider defaults', () => {
  it('selects Moonshot/Kimi when there is no saved provider', () => {
    expect(DEFAULT_PROVIDER).toBe('moonshot')
    expect(resolveInitialProvider(null)).toBe('moonshot')
    expect(resolveInitialProvider('')).toBe('moonshot')
    expect(resolveInitialProvider('unknown')).toBe('moonshot')
  })

  it('preserves an explicitly saved valid provider selection across initialization', () => {
    for (const provider of PROVIDER_IDS) {
      expect(resolveInitialProvider(provider)).toBe(provider === 'nexus' ? DEFAULT_PROVIDER : provider)
    }
  })
})
