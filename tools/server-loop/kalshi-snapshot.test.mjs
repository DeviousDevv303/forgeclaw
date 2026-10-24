// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

/**
 * Server loop Stage 2 — tests for the Kalshi snapshot fetcher's pure and
 * I/O-shaped layers, driven by a fake fetch answering in the recorded
 * Kalshi market shape (dollar-string prices, _fp counts):
 *   npx vitest run tools/server-loop/kalshi-snapshot.test.mjs
 *
 * The behaviors pinned here are the honesty contract: prices are copied,
 * never invented; a failed read surfaces as an error snapshot with no
 * fabricated prices; a partial failure keeps the series that really read.
 */

import { describe, expect, it } from 'vitest'

import { buildSnapshot, collectSnapshot, priceOrNull, toSnapshotMarket } from './kalshi-snapshot.mjs'

const AT = '2026-10-24T00:00:00.000Z'

/** A market in the shape Kalshi's public API returned on 2026-10-23 (KXUFCFIGHT sample). */
const rawMarket = (over = {}) => ({
  ticker: 'KXUFCFIGHT-26OCT24OKISAN-SAN',
  event_ticker: 'KXUFCFIGHT-26OCT24OKISAN',
  title: 'Daniel Gustavo Santos wins',
  yes_sub_title: 'Daniel Gustavo Santos',
  status: 'active',
  close_time: '2026-10-26T14:40:00Z',
  yes_bid_dollars: '0.5000',
  yes_ask_dollars: '0.5100',
  no_bid_dollars: '0.4900',
  no_ask_dollars: '0.5000',
  last_price_dollars: '0.5100',
  volume_fp: '21623.88',
  open_interest_fp: '20073.95',
  rules_primary: 'If Daniel Gustavo Santos wins …',
  ...over,
})

const jsonResponse = (body, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
})

describe('priceOrNull', () => {
  it('reads dollar strings and numbers, and treats out-of-range or junk as no price', () => {
    expect(priceOrNull('0.5100')).toBe(0.51)
    expect(priceOrNull(0)).toBe(0)
    expect(priceOrNull('1.0000')).toBe(1)
    expect(priceOrNull('1.5')).toBeNull()
    expect(priceOrNull('-0.10')).toBeNull()
    expect(priceOrNull('abc')).toBeNull()
    expect(priceOrNull('')).toBeNull()
    expect(priceOrNull(undefined)).toBeNull()
    expect(priceOrNull(null)).toBeNull()
  })
})

describe('toSnapshotMarket', () => {
  it('copies the prices Kalshi reported into numeric snapshot fields, stamped with the series it was read under', () => {
    expect(toSnapshotMarket(rawMarket(), 'KXUFCFIGHT')).toEqual({
      ticker: 'KXUFCFIGHT-26OCT24OKISAN-SAN',
      event_ticker: 'KXUFCFIGHT-26OCT24OKISAN',
      series_ticker: 'KXUFCFIGHT',
      title: 'Daniel Gustavo Santos wins',
      yes_sub_title: 'Daniel Gustavo Santos',
      yes_bid: 0.5,
      yes_ask: 0.51,
      no_bid: 0.49,
      no_ask: 0.5,
      last_price: 0.51,
      volume: 21623.88,
      open_interest: 20073.95,
      status: 'active',
      close_time: '2026-10-26T14:40:00Z',
    })
  })

  it('writes null for a quote Kalshi did not report — absence, never an invented price', () => {
    const entry = toSnapshotMarket(rawMarket({ yes_bid_dollars: undefined, yes_ask_dollars: undefined, last_price_dollars: undefined }), 'KXUFCFIGHT')
    expect(entry.yes_bid).toBeNull()
    expect(entry.yes_ask).toBeNull()
    expect(entry.last_price).toBeNull()
  })

  it('drops entries without a usable ticker and leaves the rules text behind', () => {
    expect(toSnapshotMarket({ yes_bid_dollars: '0.5000' }, 'KXUFCFIGHT')).toBeNull()
    expect(toSnapshotMarket(null, 'KXUFCFIGHT')).toBeNull()
    expect(toSnapshotMarket(rawMarket(), 'KXUFCFIGHT')).not.toHaveProperty('rules_primary')
  })
})

describe('buildSnapshot', () => {
  it('carries the fetch stamp, source and status, with error null on a clean fetch', () => {
    const snap = buildSnapshot({ fetchedAt: AT, httpStatus: 200, markets: [], error: null })
    expect(snap).toEqual({ fetched_at: AT, source: 'kalshi-public-api', http_status: 200, error: null, markets: [] })
  })
})

describe('collectSnapshot', () => {
  it('reads every watchlist series and assembles one snapshot', async () => {
    const urls = []
    const fetchFn = async (url) => {
      urls.push(url)
      if (url.includes('series_ticker=KXUFCFIGHT')) return jsonResponse({ markets: [rawMarket()] })
      if (url.includes('series_ticker=KXNFLGAME')) return jsonResponse({ markets: [rawMarket({ ticker: 'KXNFLGAME-26NOV02CHISEA-SEA', event_ticker: 'KXNFLGAME-26NOV02CHISEA' })] })
      throw new Error(`unexpected URL ${url}`)
    }
    const { snapshot, ok } = await collectSnapshot({ fetchFn, watchlist: { series: ['KXUFCFIGHT', 'KXNFLGAME'], tickers: [] }, fetchedAt: AT })
    expect(ok).toBe(true)
    expect(snapshot.error).toBeNull()
    expect(snapshot.http_status).toBe(200)
    expect(snapshot.fetched_at).toBe(AT)
    expect(snapshot.markets.map(m => m.ticker)).toEqual(['KXUFCFIGHT-26OCT24OKISAN-SAN', 'KXNFLGAME-26NOV02CHISEA-SEA'])
    expect(snapshot.markets[1].series_ticker).toBe('KXNFLGAME')
  })

  it('follows the cursor until a series is exhausted', async () => {
    let calls = 0
    const fetchFn = async () => {
      calls++
      return calls === 1
        ? jsonResponse({ markets: [rawMarket()], cursor: 'next-page' })
        : jsonResponse({ markets: [rawMarket({ ticker: 'KXUFCFIGHT-26OCT24OKISAN-OKI', event_ticker: 'KXUFCFIGHT-26OCT24OKISAN' })] })
    }
    const { snapshot, ok } = await collectSnapshot({ fetchFn, watchlist: { series: ['KXUFCFIGHT'] }, fetchedAt: AT })
    expect(ok).toBe(true)
    expect(calls).toBe(2)
    expect(snapshot.markets).toHaveLength(2)
  })

  it('a failed series is named in the error, the series that read are kept, and the run is not ok', async () => {
    const fetchFn = async (url) => {
      if (url.includes('series_ticker=KXUFCFIGHT')) return jsonResponse({ markets: [rawMarket()] })
      return jsonResponse({ error: 'rate limited' }, 429)
    }
    const { snapshot, ok } = await collectSnapshot({ fetchFn, watchlist: { series: ['KXUFCFIGHT', 'KXNFLGAME'] }, fetchedAt: AT })
    expect(ok).toBe(false)
    expect(snapshot.error).toContain('KXNFLGAME')
    expect(snapshot.error).toContain('429')
    expect(snapshot.http_status).toBe(429)
    expect(snapshot.markets.map(m => m.ticker)).toEqual(['KXUFCFIGHT-26OCT24OKISAN-SAN'])
  })

  it('a total failure writes an error snapshot with no markets and no prices', async () => {
    const fetchFn = async () => { throw new TypeError('Failed to fetch') }
    const { snapshot, ok } = await collectSnapshot({ fetchFn, watchlist: { series: ['KXUFCFIGHT'] }, fetchedAt: AT })
    expect(ok).toBe(false)
    expect(snapshot.markets).toEqual([])
    expect(snapshot.error).toContain('KXUFCFIGHT')
    expect(snapshot.http_status).toBeNull()
  })

  it('reads watchlist tickers individually keyed, without asserting a series for them', async () => {
    const fetchFn = async (url) => {
      expect(url).toContain('tickers=KXSOME-ONE')
      return jsonResponse({ markets: [rawMarket({ ticker: 'KXSOME-ONE' })] })
    }
    const { snapshot, ok } = await collectSnapshot({ fetchFn, watchlist: { series: [], tickers: ['KXSOME-ONE'] }, fetchedAt: AT })
    expect(ok).toBe(true)
    expect(snapshot.markets).toHaveLength(1)
    expect(snapshot.markets[0].series_ticker).toBeNull()
  })
})
