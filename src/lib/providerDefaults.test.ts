import { describe, expect, it } from 'vitest'
import { DEFAULT_PROVIDER, PROVIDER_IDS, resolveInitialProvider } from './providerDefaults'

describe('canonical provider defaults', () => {
  it('selects the combined CORPUS/NEXUS runtime when there is no saved provider', () => {
    expect(DEFAULT_PROVIDER).toBe('corpus')
    expect(resolveInitialProvider(null)).toBe('corpus')
    expect(resolveInitialProvider('')).toBe('corpus')
    expect(resolveInitialProvider('unknown')).toBe('corpus')
  })

  it('preserves an explicitly saved valid provider selection across initialization', () => {
    for (const provider of PROVIDER_IDS) {
      expect(resolveInitialProvider(provider)).toBe(provider === 'nexus' ? DEFAULT_PROVIDER : provider)
    }
  })
})
