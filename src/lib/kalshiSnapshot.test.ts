// @vitest-environment node
// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
import { beforeEach, describe, expect, it } from 'vitest'
import {
  KALSHI_DISCLAIMER, KALSHI_STALE_DISCLAIMER, KalshiError, fetchKalshiMarket, resetKalshiReadSpacing, runKalshiMarkets,
  type KalshiDeps, type KalshiMarket,
} from './kalshiMarkets'
import {
  KALSHI_SNAPSHOT_MAX_ENTRIES, KALSHI_SNAPSHOT_MAX_MARKETS, findSnapshot, recordSnapshot, snapshotKey,
  type KalshiSnapshot, type KalshiSnapshotStore,
} from './kalshiSnapshot'
import { clearErrorLog, getErrorLog } from './errorLog'

const T0 = Date.parse('2026-10-23T21:00:00Z')
const MIN = 60_000
const mk = (over: Partial<KalshiMarket>): KalshiMarket => ({
  ticker: 'KXHIGHNY-A', title: 'NYC high above 60°F?', status: 'active', close_time: '2026-10-24T04:00:00Z',
  yes_bid_dollars: '0.4000', yes_ask_dollars: '0.4200', no_ask_dollars: '0.5900', last_price_dollars: '0.4100',
  volume_fp: '5000.00', volume_24h_fp: '100.00', open_interest_fp: '2500.00', ...over,
})
const ok = (body: unknown) => ({ ok: true, status: 200, headers: new Headers(), json: async () => body }) as unknown as Response
const limited = (headers: Record<string, string> = {}) => ({ ok: false, status: 429, headers: new Headers(headers), json: async () => ({}) }) as unknown as Response

const memStore = (): KalshiSnapshotStore & { all: () => KalshiSnapshot[] } => {
  let s: KalshiSnapshot[] = []
  return { load: () => s, save: x => { s = x }, all: () => s }
}

/** A fake wall clock and market clock, so retries and ages cost no real time. */
const harness = (store: KalshiSnapshotStore) => {
  let wall = 1_000_000
  let market = T0
  const deps = (fetcher: KalshiDeps['fetcher'], extra: Partial<KalshiDeps> = {}): KalshiDeps => ({
    fetcher, snapshots: store, now: () => market, clock: () => wall, delay: async (ms: number) => { wall += ms }, ...extra,
  })
  return { deps, advance: (ms: number) => { market += ms } }
}

beforeEach(() => {
  resetKalshiReadSpacing()
  clearErrorLog()
})

describe('last-good snapshot fallback', () => {
  it('a live read records a snapshot; a later 429 shows it labelled STALE with its age and the cause', async () => {
    const store = memStore()
    const h = harness(store)
    const live = await runKalshiMarkets({ series_ticker: 'KXHIGHNY' }, h.deps(async () => ok({ markets: [mk({})] })))
    expect(live).toContain(KALSHI_DISCLAIMER)
    expect(store.all()).toHaveLength(1)

    h.advance(7 * MIN)
    const stale = await runKalshiMarkets({ series_ticker: 'KXHIGHNY' }, h.deps(async () => limited({ 'Retry-After': '9' })))
    expect(stale.startsWith('STALE — live Kalshi read failed (HTTP 429, Retry-After: 9).')).toBe(true)
    expect(stale).toContain(`fetched ${new Date(T0).toISOString()} (7 min old; limit 15 min)`)
    expect(stale).toContain('These are not live prices')
    expect(stale).toContain('bid $0.40 / ask $0.42 (implied 42%)')
    // The live disclaimer says "now"; snapshot output must not.
    expect(stale).toContain(KALSHI_STALE_DISCLAIMER)
    expect(stale).not.toContain(KALSHI_DISCLAIMER)
  })

  it('past the age limit the read fails as before, and says no snapshot was usable', async () => {
    const store = memStore()
    const h = harness(store)
    await runKalshiMarkets({ series_ticker: 'KXHIGHNY' }, h.deps(async () => ok({ markets: [mk({})] })))
    h.advance(15 * MIN + 1)
    const err = await runKalshiMarkets({ series_ticker: 'KXHIGHNY' }, h.deps(async () => limited())).catch(e => e)
    expect(err).toBeInstanceOf(KalshiError)
    expect(err.httpStatus).toBe(429)
    expect(err.retryAfter).toBeNull()
    expect(err.message).toMatch(/^Kalshi rate-limited this read: HTTP 429 on \/markets after 2 spaced retries · Retry-After: none · not an empty market list\. No snapshot within 15 min to fall back to/)
  })

  it('the age limit is per call: maxSnapshotAgeMs widens or narrows it', async () => {
    const store = memStore()
    const h = harness(store)
    await runKalshiMarkets({ series_ticker: 'KXHIGHNY' }, h.deps(async () => ok({ markets: [mk({})] })))
    h.advance(30 * MIN)
    const wide = await runKalshiMarkets({ series_ticker: 'KXHIGHNY' }, h.deps(async () => limited(), { maxSnapshotAgeMs: 60 * MIN }))
    expect(wide).toContain('(30 min old; limit 60 min)')
    await expect(runKalshiMarkets({ series_ticker: 'KXHIGHNY' }, h.deps(async () => limited(), { maxSnapshotAgeMs: 0 }))).rejects.toThrow('No snapshot within')
  })

  it('a single-ticker read can be answered from any fresh snapshot that holds that ticker', async () => {
    const store = memStore()
    const h = harness(store)
    await runKalshiMarkets({ series_ticker: 'KXHIGHNY' }, h.deps(async () => ok({ markets: [mk({}), mk({ ticker: 'KXHIGHNY-B', title: 'NYC high above 65°F?' })] })))
    const out = await runKalshiMarkets({ ticker: 'KXHIGHNY-B' }, h.deps(async () => limited()))
    expect(out).toContain('STALE')
    expect(out).toContain('KXHIGHNY-B — NYC high above 65°F?')
    expect(out).not.toContain('KXHIGHNY-A —')
  })

  it('a different query never borrows another query\'s snapshot', async () => {
    const store = memStore()
    const h = harness(store)
    await runKalshiMarkets({ series_ticker: 'KXHIGHNY' }, h.deps(async () => ok({ markets: [mk({})] })))
    await expect(runKalshiMarkets({ series_ticker: 'KXHIGHMIA' }, h.deps(async () => limited()))).rejects.toThrow('No snapshot within')
  })

  it('transport failures fall back too, and keep the flags the tool layer logs on', async () => {
    const store = memStore()
    const h = harness(store)
    await runKalshiMarkets({ series_ticker: 'KXHIGHNY' }, h.deps(async () => ok({ markets: [mk({})] })))
    const out = await runKalshiMarkets({ series_ticker: 'KXHIGHNY' }, h.deps(async () => { throw new TypeError('Failed to fetch') }))
    expect(out).toContain('STALE — live Kalshi read failed (Kalshi unreachable)')

    const err = await runKalshiMarkets({ series_ticker: 'KXHIGHMIA' }, h.deps(async () => { throw new TypeError('Failed to fetch') })).catch(e => e)
    expect(err.transportFailure).toBe(true)
    expect(err.relayMissing).toBe(true)
    expect(err.message).toContain('No snapshot within 15 min')
  })

  it('snapshots: null disables the fallback entirely', async () => {
    const store = memStore()
    const h = harness(store)
    await runKalshiMarkets({ series_ticker: 'KXHIGHNY' }, h.deps(async () => ok({ markets: [mk({})] })))
    await expect(runKalshiMarkets({ series_ticker: 'KXHIGHNY' }, h.deps(async () => limited(), { snapshots: null }))).rejects.toThrow('HTTP 429')
  })

  it('settlement reads (fetchKalshiMarket) never use a snapshot', async () => {
    const store = memStore()
    const h = harness(store)
    await runKalshiMarkets({ ticker: 'KXHIGHNY-A' }, h.deps(async () => ok({ markets: [mk({})] })))
    await expect(fetchKalshiMarket('KXHIGHNY-A', h.deps(async () => limited()))).rejects.toThrow('HTTP 429')
  })

  it('a cancelled run is never answered from a snapshot', async () => {
    const store = memStore()
    const h = harness(store)
    await runKalshiMarkets({ series_ticker: 'KXHIGHNY' }, h.deps(async () => ok({ markets: [mk({})] })))
    const ctrl = new AbortController()
    ctrl.abort()
    const err = await runKalshiMarkets({ series_ticker: 'KXHIGHNY' }, h.deps(async () => { throw new DOMException('Aborted', 'AbortError') }, { signal: ctrl.signal })).catch(e => e)
    expect(err).toBeInstanceOf(DOMException)
  })

  it('a snapshot stamped in the future (clock skew) is not treated as fresh', () => {
    const store = memStore()
    recordSnapshot(store, { series_ticker: 'X' }, [mk({})], 1, T0 + 5 * MIN)
    expect(findSnapshot(store, { series_ticker: 'X' }, T0, 15 * MIN)).toBeNull()
  })
})

describe('snapshot store bounds', () => {
  it('keeps at most KALSHI_SNAPSHOT_MAX_ENTRIES queries, newest first, one per query', () => {
    const store = memStore()
    for (let i = 0; i < KALSHI_SNAPSHOT_MAX_ENTRIES + 3; i++) recordSnapshot(store, { series_ticker: `S${i}` }, [mk({})], 1, T0 + i)
    recordSnapshot(store, { series_ticker: 'S14' }, [mk({})], 1, T0 + 99)
    expect(store.all()).toHaveLength(KALSHI_SNAPSHOT_MAX_ENTRIES)
    expect(store.all()[0].key).toBe(snapshotKey({ series_ticker: 'S14' }))
    expect(store.all().filter(s => s.key === snapshotKey({ series_ticker: 'S14' }))).toHaveLength(1)
  })

  it('caps markets per snapshot and drops the long rules text', () => {
    const store = memStore()
    const many = Array.from({ length: KALSHI_SNAPSHOT_MAX_MARKETS + 10 }, (_, i) => mk({ ticker: `T${i}`, rules_primary: 'x'.repeat(2000) }))
    recordSnapshot(store, { query: 'nyc' }, many, many.length, T0)
    const [snap] = store.all()
    expect(snap.markets).toHaveLength(KALSHI_SNAPSHOT_MAX_MARKETS)
    expect(snap.matched).toBe(many.length)
    expect(snap.markets.some(m => 'rules_primary' in m)).toBe(false)
  })

  it('limit is display-only and query words are case-insensitive in the key', () => {
    expect(snapshotKey({ query: 'NYC High', limit: 3 })).toBe(snapshotKey({ query: 'nyc high' }))
  })
})

describe('read-failure attribution', () => {
  it('every non-OK answer is logged with its status and raw Retry-After, retries included', async () => {
    const h = harness(memStore())
    const replies = [limited({ 'Retry-After': '3' }), limited(), limited()]
    await runKalshiMarkets({ series_ticker: 'KXHIGHNY' }, h.deps(async () => replies.shift()!)).catch(() => undefined)
    const kalshi = getErrorLog().filter(e => e.source === 'kalshi').reverse()
    expect(kalshi.map(e => e.message)).toEqual(['read HTTP 429 /markets', 'read HTTP 429 /markets', 'read HTTP 429 /markets'])
    expect(kalshi.map(e => e.details)).toEqual(['attempt 1 · Retry-After: 3', 'attempt 2 · Retry-After: none', 'attempt 3 · Retry-After: none'])
  })

  it('a successful read logs nothing', async () => {
    const h = harness(memStore())
    await runKalshiMarkets({ series_ticker: 'KXHIGHNY' }, h.deps(async () => ok({ markets: [mk({})] })))
    expect(getErrorLog().filter(e => e.source === 'kalshi')).toEqual([])
  })
})
