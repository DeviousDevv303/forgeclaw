// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeTool, FORGE_TOOLS } from './forgeTools'

afterEach(() => { vi.unstubAllGlobals() })

const ctx = { ghToken: 't', ghOwner: 'o', ghRepo: 'r', actor: 'operator', requestGuardianApproval: async () => true } as never
const call = (input: Record<string, unknown>) => executeTool({ id: '1', name: 'kalshi_markets', input }, ctx)
const market = { ticker: 'KX-A', title: 'Will A happen?', status: 'active', close_time: '2099-01-01T00:00:00Z', yes_bid_dollars: '0.9000', yes_ask_dollars: '0.9200', no_ask_dollars: '0.1100', last_price_dollars: '0.9100', volume_fp: '5000.00', volume_24h_fp: '100.00', open_interest_fp: '2500.00' }

describe('kalshi_markets tool', () => {
  it('is registered, read-only in effect, and requires nothing', () => {
    const def = FORGE_TOOLS.find(t => t.name === 'kalshi_markets')!
    expect(def).toBeDefined()
    expect(def.parameters.required).toEqual([])
    expect(def.description).toMatch(/never recommends a bet/)
  })

  it('returns live-shaped prices through the real executor, with the disclaimer and no GitHub token sent to Kalshi', async () => {
    const seen: Array<{ url: string; headers: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => { seen.push({ url: String(url), headers: init?.headers }); return Response.json({ markets: [market] }) }))
    const out = await call({ query: 'a happen', limit: '5' })
    expect(out).toContain('KX-A — Will A happen?')
    expect(out).toContain('implied 92%')
    expect(out).toContain('not a guarantee')
    expect(seen[0].url).toContain('external-api.kalshi.com/trade-api/v2/markets')
    expect(JSON.stringify(seen[0].headers)).not.toMatch(/token|authorization/i)
  })

  it('a blocked fetch is a named tool error, never "no markets"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const out = await call({ query: 'anything' })
    expect(out).toMatch(/TOOL ERROR/)
    expect(out).toMatch(/could not be reached/)
    expect(out).not.toMatch(/No open Kalshi markets matched/)
  })

  it('shows the order book for a ticker and refuses one without a ticker', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(String(url)).toContain('/markets/KX-A/orderbook')
      return Response.json({ orderbook_fp: { yes_dollars: [['0.9000', '250.00']], no_dollars: [['0.0900', '40.00']] } })
    }))
    expect(await call({ ticker: 'KX-A', orderbook: true })).toContain('YES bids (best first): $0.90 x250')
    expect(await call({ orderbook: true })).toMatch(/needs a ticker/)
  })
})
