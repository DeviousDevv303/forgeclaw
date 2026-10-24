// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

/**
 * Stage 2 server snapshot reader: the document the server loop commits to
 * the kalshi-snapshot-data branch, validated fail-closed. The behaviors
 * pinned here are the contract the fetcher and the app share: real prices
 * convert, absent quotes stay absent, and any shape drift — including a
 * failed fetch's error document — makes the snapshot unavailable so the
 * live read takes over. Nothing here may ever turn into a guessed price.
 */

import { describe, expect, it } from 'vitest'
import {
  KALSHI_SERVER_SNAPSHOT_MAX_AGE_MS, httpServerSnapshotSource, loadServerSnapshot, parseServerSnapshot,
  serverSnapshotMarketsFor, type KalshiServerSnapshotSource,
} from './kalshiServerSnapshot'

const NOW = Date.parse('2026-10-24T12:00:00Z')
const FIVE_MIN_AGO = new Date(NOW - 5 * 60_000).toISOString()

const snapMarket = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
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
  ...over,
})

const snapDoc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  fetched_at: FIVE_MIN_AGO,
  source: 'kalshi-public-api',
  http_status: 200,
  error: null,
  markets: [snapMarket()],
  ...over,
})

const sourceReturning = (raw: unknown): KalshiServerSnapshotSource => ({ load: async () => raw })

describe('parseServerSnapshot', () => {
  it('converts a fetcher document into app markets, numbers back into the dollar-string shape the app reads', () => {
    const snap = parseServerSnapshot(snapDoc())
    expect(snap?.fetchedAt).toBe(Date.parse(FIVE_MIN_AGO))
    expect(snap?.markets).toHaveLength(1)
    const m = snap!.markets[0]
    expect(m.ticker).toBe('KXUFCFIGHT-26OCT24OKISAN-SAN')
    expect(m.series_ticker).toBe('KXUFCFIGHT')
    expect(m.title).toBe('Daniel Gustavo Santos wins')
    expect(m.yes_bid_dollars).toBe('0.5')
    expect(m.yes_ask_dollars).toBe('0.51')
    expect(m.no_ask_dollars).toBe('0.5')
    expect(m.last_price_dollars).toBe('0.51')
    expect(m.volume_fp).toBe('21623.88')
    expect(m.open_interest_fp).toBe('20073.95')
    expect(m.status).toBe('active')
    expect(m.close_time).toBe('2026-10-26T14:40:00Z')
  })

  it('keeps a quote Kalshi never reported absent — undefined fields, never a zero price', () => {
    const snap = parseServerSnapshot(snapDoc({ markets: [snapMarket({ yes_bid: null, yes_ask: null, last_price: null })] }))
    const m = snap!.markets[0]
    expect(m.yes_bid_dollars).toBeUndefined()
    expect(m.yes_ask_dollars).toBeUndefined()
    expect(m.last_price_dollars).toBeUndefined()
  })

  it('refuses a failed fetch’s document: an error field means no prices to serve', () => {
    expect(parseServerSnapshot(snapDoc({ error: 'KXNFLGAME: Kalshi returned HTTP 429', markets: [] }))).toBeNull()
    expect(parseServerSnapshot(snapDoc({ error: 42 }))).toBeNull()
  })

  it('fails closed on document-level drift: wrong source, unparseable stamp, missing markets', () => {
    expect(parseServerSnapshot(null)).toBeNull()
    expect(parseServerSnapshot('snapshot')).toBeNull()
    expect(parseServerSnapshot(snapDoc({ source: 'someone-else' }))).toBeNull()
    expect(parseServerSnapshot(snapDoc({ fetched_at: 'not a date' }))).toBeNull()
    expect(parseServerSnapshot(snapDoc({ fetched_at: 1790000000 }))).toBeNull()
    expect(parseServerSnapshot(snapDoc({ markets: undefined }))).toBeNull()
    expect(parseServerSnapshot(snapDoc({ markets: {} }))).toBeNull()
  })

  it('fails the whole snapshot on one drifted market entry — a document wrong in one place is trusted nowhere', () => {
    expect(parseServerSnapshot(snapDoc({ markets: [snapMarket(), snapMarket({ ticker: 'KX-B', yes_bid: '0.50' })] }))).toBeNull()
    expect(parseServerSnapshot(snapDoc({ markets: [snapMarket({ yes_ask: 1.5 })] }))).toBeNull()
    expect(parseServerSnapshot(snapDoc({ markets: [snapMarket({ volume: -3 })] }))).toBeNull()
    expect(parseServerSnapshot(snapDoc({ markets: [snapMarket({ ticker: '' })] }))).toBeNull()
    expect(parseServerSnapshot(snapDoc({ markets: [null] }))).toBeNull()
  })
})

describe('loadServerSnapshot', () => {
  it('serves a fresh snapshot and measures age from its own fetched_at stamp', async () => {
    const snap = await loadServerSnapshot(sourceReturning(snapDoc()), NOW, KALSHI_SERVER_SNAPSHOT_MAX_AGE_MS)
    expect(snap?.fetchedAt).toBe(NOW - 5 * 60_000)
  })

  it('a snapshot exactly at the age limit still serves; one past it does not', async () => {
    const atLimit = snapDoc({ fetched_at: new Date(NOW - KALSHI_SERVER_SNAPSHOT_MAX_AGE_MS).toISOString() })
    expect(await loadServerSnapshot(sourceReturning(atLimit), NOW, KALSHI_SERVER_SNAPSHOT_MAX_AGE_MS)).not.toBeNull()
    const pastLimit = snapDoc({ fetched_at: new Date(NOW - KALSHI_SERVER_SNAPSHOT_MAX_AGE_MS - 1).toISOString() })
    expect(await loadServerSnapshot(sourceReturning(pastLimit), NOW, KALSHI_SERVER_SNAPSHOT_MAX_AGE_MS)).toBeNull()
  })

  it('a stamp in the future is drift, not freshness', async () => {
    const future = snapDoc({ fetched_at: new Date(NOW + 60_000).toISOString() })
    expect(await loadServerSnapshot(sourceReturning(future), NOW, KALSHI_SERVER_SNAPSHOT_MAX_AGE_MS)).toBeNull()
  })

  it('a transport failure is unavailability, never an exception the caller must handle', async () => {
    const down: KalshiServerSnapshotSource = { load: async () => { throw new TypeError('Failed to fetch') } }
    expect(await loadServerSnapshot(down, NOW, KALSHI_SERVER_SNAPSHOT_MAX_AGE_MS)).toBeNull()
  })

  it('honours a per-call age limit tighter or looser than the default', async () => {
    const twentyMin = snapDoc({ fetched_at: new Date(NOW - 20 * 60_000).toISOString() })
    expect(await loadServerSnapshot(sourceReturning(twentyMin), NOW, 30 * 60_000)).not.toBeNull()
    expect(await loadServerSnapshot(sourceReturning(twentyMin), NOW, 10 * 60_000)).toBeNull()
  })
})

describe('serverSnapshotMarketsFor', () => {
  const snap = parseServerSnapshot(snapDoc({
    markets: [
      snapMarket(),
      snapMarket({ ticker: 'KXUFCFIGHT-26OCT24OKISAN-OKI' }),
      snapMarket({ ticker: 'KXNFLGAME-26NOV02CHISEA-SEA', event_ticker: 'KXNFLGAME-26NOV02CHISEA', series_ticker: 'KXNFLGAME' }),
    ],
  }))!

  it('answers an exact ticker only when the snapshot holds it', () => {
    expect(serverSnapshotMarketsFor(snap, { ticker: 'KXUFCFIGHT-26OCT24OKISAN-OKI' })?.map(m => m.ticker)).toEqual(['KXUFCFIGHT-26OCT24OKISAN-OKI'])
    expect(serverSnapshotMarketsFor(snap, { ticker: 'KX-NOTHING' })).toBeNull()
  })

  it('answers an event with every market the snapshot holds for it', () => {
    expect(serverSnapshotMarketsFor(snap, { event_ticker: 'KXUFCFIGHT-26OCT24OKISAN' })).toHaveLength(2)
    expect(serverSnapshotMarketsFor(snap, { event_ticker: 'KX-OTHER' })).toBeNull()
  })

  it('answers a series with the markets the fetcher read under it', () => {
    expect(serverSnapshotMarketsFor(snap, { series_ticker: 'KXNFLGAME' })?.map(m => m.ticker)).toEqual(['KXNFLGAME-26NOV02CHISEA-SEA'])
    expect(serverSnapshotMarketsFor(snap, { series_ticker: 'KXHIGHNY' })).toBeNull()
  })

  it('never answers an unscoped listing — the snapshot holds only the watchlist', () => {
    expect(serverSnapshotMarketsFor(snap, {})).toBeNull()
  })
})

describe('httpServerSnapshotSource', () => {
  it('reads the JSON body of an OK answer', async () => {
    const source = httpServerSnapshotSource(async () => ({ ok: true, status: 200, json: async () => snapDoc() }) as unknown as Response)
    expect(await loadServerSnapshot(source, NOW, KALSHI_SERVER_SNAPSHOT_MAX_AGE_MS)).not.toBeNull()
  })

  it('a non-OK answer (the data branch not seeded yet, say) is unavailability', async () => {
    const source = httpServerSnapshotSource(async () => ({ ok: false, status: 404, json: async () => ({}) }) as unknown as Response)
    expect(await loadServerSnapshot(source, NOW, KALSHI_SERVER_SNAPSHOT_MAX_AGE_MS)).toBeNull()
  })
})
