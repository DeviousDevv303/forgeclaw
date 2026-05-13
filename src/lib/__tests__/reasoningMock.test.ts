import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('buildMockReasoning', () => {
  const originalEnv = import.meta.env.DEV

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('throws when called outside DEV mode', async () => {
    vi.stubEnv('DEV', false)
    const { buildMockReasoning } = await import('../reasoningMock')
    expect(() => buildMockReasoning()).toThrow('development utility')
  })

  it('returns a complete ReasoningData with 5 phases in DEV mode', async () => {
    vi.stubEnv('DEV', true)
    const { buildMockReasoning } = await import('../reasoningMock')
    const result = buildMockReasoning()

    expect(result.status).toBe('complete')
    expect(result.phases).toHaveLength(5)
    expect(result.version).toBe(1)
    expect(result.id).toMatch(/^reasoning-mock-/)
  })

  it('phases have correct names in order', async () => {
    vi.stubEnv('DEV', true)
    const { buildMockReasoning } = await import('../reasoningMock')
    const { phases } = buildMockReasoning()

    const names = phases.map(p => p.name)
    expect(names).toEqual(['Assumptions', 'Heuristics', 'First Principles', 'Extension', 'Convergence'])
  })

  it('every phase has at least one step', async () => {
    vi.stubEnv('DEV', true)
    const { buildMockReasoning } = await import('../reasoningMock')
    const { phases } = buildMockReasoning()

    for (const phase of phases) {
      expect(phase.steps.length).toBeGreaterThan(0)
      expect(phase.status).toBe('complete')
    }
  })

  it('tool calls have unique ids', async () => {
    vi.stubEnv('DEV', true)
    const { buildMockReasoning } = await import('../reasoningMock')
    const { phases } = buildMockReasoning()

    const allToolCallIds = phases
      .flatMap(p => p.steps)
      .flatMap(s => s.toolCalls ?? [])
      .map(tc => tc.id)

    const unique = new Set(allToolCallIds)
    expect(unique.size).toBe(allToolCallIds.length)
  })

  // Suppress unused-variable warning — originalEnv documents intent
  it('has a stable type shape (ReasoningData)', async () => {
    void originalEnv
    vi.stubEnv('DEV', true)
    const { buildMockReasoning } = await import('../reasoningMock')
    const result = buildMockReasoning()

    expect(typeof result.id).toBe('string')
    expect(typeof result.version).toBe('number')
    expect(typeof result.startedAt).toBe('number')
    expect(result.completedAt).toBeDefined()
  })
})
