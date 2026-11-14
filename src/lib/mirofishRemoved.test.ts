// @vitest-environment node
// MiroFish was removed 2026-11-14 (owner's direction). The Nexus checkpoint was trained on mirofish_sim, so it may still
// emit the call: it must end as a plain refusal that sends nothing, never a dispatch, and the removed tools must not
// be offered to any model.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeTool, FORGE_TOOLS, type ToolContext } from './forgeTools'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

const ctx: ToolContext = { ghToken: 't', ghOwner: 'o', ghRepo: 'r', actor: 'agent', requestGuardianApproval: async () => true }

describe('MiroFish is gone', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('neither tool is defined, so no model is offered one', () => {
    const names = FORGE_TOOLS.map(t => t.name)
    expect(names).not.toContain('mirofish_sim')
    expect(names).not.toContain('mirofish_sim_result')
  })

  it.each(['mirofish_sim', 'mirofish_sim_result'])('a model-emitted %s call is refused and nothing is sent', async (name) => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await executeTool({ id: '1', name, input: { card_id: 'X', market_ticker: 'Y', sides: 'A|B', packet: 'p'.repeat(300) } }, ctx)
    expect(out).toBe(`[TOOL ERROR] Unknown tool: ${name}`)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
