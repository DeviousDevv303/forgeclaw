// @vitest-environment node
// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeTool, FORGE_TOOLS } from './forgeTools'
import { answerOutcome, NOT_EVIDENCE_TOOLS } from './nexusConvergence'
import { READ_ONLY_BASELINE_TOOLS } from './toolExposure'
import {
  OWNER_PRICES_FOOTER, OWNER_PRICES_HEADER, OWNER_PRICES_MAX_ENTRIES, formatOwnerPrices, parseOwnerPrice, parseOwnerPrices,
} from './kalshiOwnerPrices'

afterEach(() => { vi.unstubAllGlobals() })

describe('parseOwnerPrice', () => {
  it.each([
    ['0.42', 0.42], ['$0.42', 0.42], ['.42', 0.42], ['42c', 0.42], ['42¢', 0.42], ['42 cents', 0.42], ['42', 0.42], ['7', 0.07], ['1', 0.01], ['99c', 0.99],
  ])('%s -> %s', (raw, want) => expect(parseOwnerPrice(raw)).toBe(want))

  it.each(['0', '$1', '100', '1.5', '-0.4', 'abc', '', '0c', '100c'])('%s is rejected', raw => expect(parseOwnerPrice(raw)).toBeNull())
})

describe('parseOwnerPrices', () => {
  it('reads both entry forms, any separator, side defaulting to yes', () => {
    const { prices, rejected } = parseOwnerPrices('KXHIGHNY-25OCT24-T65 yes 42c\nkxhighmia-25oct24-t88=0.30; KXHIGHLAX-25OCT24-T75 no $0.61')
    expect(rejected).toEqual([])
    expect(prices).toEqual([
      { ticker: 'KXHIGHNY-25OCT24-T65', side: 'yes', price: 0.42 },
      { ticker: 'KXHIGHMIA-25OCT24-T88', side: 'yes', price: 0.3 },
      { ticker: 'KXHIGHLAX-25OCT24-T75', side: 'no', price: 0.61 },
    ])
  })

  it('rejects unreadable entries verbatim instead of guessing', () => {
    const { prices, rejected } = parseOwnerPrices('KX-A yes 42c, KX-B maybe 0.4, ../etc 0.4, KX-C 1.2, KX-D')
    expect(prices.map(p => p.ticker)).toEqual(['KX-A'])
    expect(rejected).toEqual(['KX-B maybe 0.4', '../etc 0.4', 'KX-C 1.2', 'KX-D'])
  })

  it('caps the number of entries and reports the overflow as rejected', () => {
    const many = Array.from({ length: OWNER_PRICES_MAX_ENTRIES + 2 }, (_, i) => `KX-${i} 0.5`).join('\n')
    const { prices, rejected } = parseOwnerPrices(many)
    expect(prices).toHaveLength(OWNER_PRICES_MAX_ENTRIES)
    expect(rejected).toHaveLength(2)
  })

  it('accepts an array, and treats anything else as empty', () => {
    expect(parseOwnerPrices(['KX-A 0.4', 'KX-B 0.6']).prices).toHaveLength(2)
    expect(parseOwnerPrices(undefined)).toEqual({ prices: [], rejected: [] })
    expect(parseOwnerPrices({ a: 1 })).toEqual({ prices: [], rejected: [] })
  })
})

describe('formatOwnerPrices', () => {
  it('labels every price as the owner\'s and never as market data', () => {
    const out = formatOwnerPrices(parseOwnerPrices('KX-A yes 42c'), 'from the Kalshi app at 5:30pm')
    expect(out.startsWith(OWNER_PRICES_HEADER)).toBe(true)
    expect(out).toContain('not read from Kalshi')
    expect(out).toContain("- KX-A YES $0.42 (implied 42%; owner's number)")
    expect(out).toContain("Owner's note: from the Kalshi app at 5:30pm")
    expect(out).toContain(OWNER_PRICES_FOOTER)
    expect(out).toContain('approval re-reads the live price')
  })

  it('shows rejected entries so the owner can fix them', () => {
    const out = formatOwnerPrices(parseOwnerPrices('KX-A 0.4, KX-B 150'))
    expect(out).toContain('Not read (fix and resend): "KX-B 150"')
  })

  it('with nothing readable, says how to write them and lists no prices', () => {
    const out = formatOwnerPrices(parseOwnerPrices('nonsense'))
    expect(out).toMatch(/^No owner prices could be read \(rejected: "nonsense"\)/)
    expect(out).not.toContain(OWNER_PRICES_HEADER)
  })
})

describe('kalshi_owner_prices tool (owner conditions, 2026-10-23)', () => {
  const ctx = { ghToken: 't', ghOwner: 'o', ghRepo: 'r', actor: 'operator', requestGuardianApproval: async () => true } as never

  it('is registered, requires prices, and tells the model never to invent them', () => {
    const def = FORGE_TOOLS.find(t => t.name === 'kalshi_owner_prices')!
    expect(def).toBeDefined()
    expect(def.parameters.required).toEqual(['prices'])
    expect(def.description).toMatch(/never invent, estimate or carry over a price/)
  })

  it('runs through the real executor with no network at all', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const out = await executeTool({ id: '1', name: 'kalshi_owner_prices', input: { prices: 'KX-A yes 42c' } }, ctx)
    expect(out).toContain(OWNER_PRICES_HEADER)
    expect(out).toContain('KX-A YES $0.42')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('condition 3: carries no evidence weight — an answer backed only by it is "completed", never "verified"', () => {
    expect(NOT_EVIDENCE_TOOLS.has('kalshi_owner_prices')).toBe(true)
    expect(answerOutcome(false, [{ name: 'kalshi_owner_prices' }])).toBe('completed')
    // A real Kalshi read alongside still counts: the guard removes the owner's numbers, not the market's.
    expect(answerOutcome(false, [{ name: 'kalshi_owner_prices' }, { name: 'kalshi_markets' }])).toBe('verified')
  })

  it('is offered to hosted models next to kalshi_markets', () => {
    expect(READ_ONLY_BASELINE_TOOLS).toContain('kalshi_owner_prices')
  })
})
