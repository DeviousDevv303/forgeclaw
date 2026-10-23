// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

// @vitest-environment jsdom
// Separate from kalshiTool.test.ts (node env) because this test needs localStorage:
// the relay URL it exercises is the owner's Settings value (kalshiAuth.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeTool } from './forgeTools'
import { KALSHI_RELAY_URL_STORAGE } from './kalshiAuth'

afterEach(() => { vi.unstubAllGlobals() })
beforeEach(() => { localStorage.clear() })

const ctx = { ghToken: 't', ghOwner: 'o', ghRepo: 'r', actor: 'operator', requestGuardianApproval: async () => true } as never
const market = { ticker: 'KX-A', title: 'Will A happen?', status: 'active', close_time: '2099-01-01T00:00:00Z', yes_bid_dollars: '0.9000', yes_ask_dollars: '0.9200', no_ask_dollars: '0.1100', last_price_dollars: '0.9100', volume_fp: '5000.00', volume_24h_fp: '100.00', open_interest_fp: '2500.00' }

describe('kalshi_markets tool — relay fallback (Settings relay URL)', () => {
  it('falls back to the Settings relay when Kalshi cannot be reached directly, and renders the markets', async () => {
    localStorage.setItem(KALSHI_RELAY_URL_STORAGE, 'https://relay.example')
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      seen.push(String(url))
      if (String(url).includes('external-api.kalshi.com')) throw new TypeError('Failed to fetch')
      if (String(url) === 'https://relay.example/v1/kalshi') return Response.json({ status: 200, body: JSON.stringify({ markets: [market] }) })
      throw new Error(`unexpected fetch ${url}`)
    }))
    const out = await executeTool({ id: '1', name: 'kalshi_markets', input: { query: 'a happen', limit: '5' } }, ctx)
    expect(out).toContain('KX-A — Will A happen?')
    expect(out).toContain('implied 92%')
    expect(seen.filter(u => u === 'https://relay.example/v1/kalshi')).toHaveLength(1)
  })

  it('the order book rides the same fallback transport', async () => {
    localStorage.setItem(KALSHI_RELAY_URL_STORAGE, 'https://relay.example')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('external-api.kalshi.com')) throw new TypeError('Failed to fetch')
      if (String(url) === 'https://relay.example/v1/kalshi') return Response.json({ status: 200, body: JSON.stringify({ orderbook_fp: { yes_dollars: [['0.9000', '250.00']], no_dollars: [['0.0900', '40.00']] } }) })
      throw new Error(`unexpected fetch ${url}`)
    }))
    const out = await executeTool({ id: '1', name: 'kalshi_markets', input: { ticker: 'KX-A', orderbook: true } }, ctx)
    expect(out).toContain('YES bids (best first): $0.90 x250')
  })
})
