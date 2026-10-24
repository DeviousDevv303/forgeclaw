// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

/**
 * The Stage 2 server snapshot: Kalshi prices the server-side loop fetched
 * (tools/server-loop/kalshi-snapshot.mjs, on a 15-minute workflow) and
 * committed to the `kalshi-snapshot-data` branch. Listings read prices from
 * here first, so the owner's browser stops spending its per-IP Kalshi quota
 * on reads a server can make once for every reader.
 *
 * This is NOT kalshiSnapshot.ts (the local last-good store): that cache
 * holds what THIS browser read live; this module holds what the server
 * fetched. They are different artifacts with different failure modes, and
 * neither ever feeds a money path — settlement, the order book at approve
 * time, and the approve-time re-quote stay live-only.
 *
 * The honesty rules are the house rules, enforced by shape, not trust:
 * - The snapshot document is validated field by field. Any drift — an
 *   unparseable fetched_at, a non-numeric price, an error field from a
 *   failed fetch — makes the WHOLE snapshot unavailable. A price is never
 *   repaired, defaulted, or guessed; a market Kalshi listed without a
 *   quote carries nulls, which read here as absent fields, exactly as the
 *   live payload's missing fields do.
 * - Freshness is measured from the snapshot's own fetched_at stamp, never
 *   from when this browser happened to download the file.
 */

import type { KalshiMarket, KalshiQuery } from './kalshiMarkets'

export const KALSHI_SERVER_SNAPSHOT_URL =
  'https://raw.githubusercontent.com/DeviousDevv303/forgeclaw/kalshi-snapshot-data/kalshi-snapshot.json'

/**
 * Default maximum server-snapshot age. Per-call override via KalshiDeps.maxServerSnapshotAgeMs.
 *
 * Why 15 minutes: it is the snapshot workflow's cadence — a healthy loop keeps a file
 * younger than this on the branch, and one missed tick ages the snapshot out rather than
 * letting 30-minute-old prices pose as current. It matches the local last-good limit
 * (KALSHI_SNAPSHOT_MAX_AGE_MS) so both fallback layers make the same freshness promise.
 */
export const KALSHI_SERVER_SNAPSHOT_MAX_AGE_MS = 900_000

export interface KalshiServerSnapshotMarket extends KalshiMarket {
  /** The series the server fetcher read this market under; absent for watchlist tickers. */
  series_ticker?: string
}

export interface KalshiServerSnapshot {
  /** When the server fetcher read Kalshi (ms epoch), from the snapshot's own fetched_at. */
  fetchedAt: number
  markets: KalshiServerSnapshotMarket[]
}

export interface KalshiServerSnapshotSource {
  /** The raw parsed snapshot JSON. Rejects on any transport failure; shape is parseServerSnapshot's job. */
  load(): Promise<unknown>
}

/** A source that reads the data branch's raw file. The fetcher is injected so tests stay offline. */
export function httpServerSnapshotSource(
  fetcher: (url: string, init?: RequestInit) => Promise<Response>,
  url: string = KALSHI_SERVER_SNAPSHOT_URL,
): KalshiServerSnapshotSource {
  return {
    async load() {
      const res = await fetcher(url, { headers: { Accept: 'application/json' } })
      if (!res.ok) throw new Error(`Server snapshot answered HTTP ${res.status}.`)
      return res.json()
    },
  }
}

const PRICE_FIELDS = ['yes_bid', 'yes_ask', 'no_bid', 'no_ask', 'last_price'] as const

/**
 * One snapshot price field: null is Kalshi reporting no quote (honest
 * absence, kept); a finite number in [0, 1] is a price; anything else is
 * shape drift, marked with the undefined sentinel so the caller fails the
 * whole snapshot closed.
 */
function priceField(value: unknown): number | null | undefined {
  if (value === null) return null
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) return value
  return undefined
}

/** Volume / open interest: null = not reported; a finite non-negative number = the count; anything else = drift. */
function countField(value: unknown): number | null | undefined {
  if (value === null) return null
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  return undefined
}

function toKalshiMarket(entry: unknown): KalshiServerSnapshotMarket | null {
  if (!entry || typeof entry !== 'object') return null
  const e = entry as Record<string, unknown>
  if (typeof e.ticker !== 'string' || !e.ticker) return null
  if (e.event_ticker !== null && typeof e.event_ticker !== 'string') return null
  if (e.series_ticker !== null && e.series_ticker !== undefined && typeof e.series_ticker !== 'string') return null
  if (e.title !== null && e.title !== undefined && typeof e.title !== 'string') return null
  if (e.yes_sub_title !== null && e.yes_sub_title !== undefined && typeof e.yes_sub_title !== 'string') return null
  if (e.status !== null && e.status !== undefined && typeof e.status !== 'string') return null
  if (e.close_time !== null && typeof e.close_time !== 'string') return null
  const prices = {} as Record<(typeof PRICE_FIELDS)[number], number | null>
  for (const field of PRICE_FIELDS) {
    const v = priceField(e[field])
    if (v === undefined) return null
    prices[field] = v
  }
  const volume = countField(e.volume)
  if (volume === undefined) return null
  const openInterest = countField(e.open_interest)
  if (openInterest === undefined) return null
  const dollars = (n: number | null): string | undefined => (n === null ? undefined : String(n))
  return {
    ticker: e.ticker,
    event_ticker: typeof e.event_ticker === 'string' ? e.event_ticker : undefined,
    series_ticker: typeof e.series_ticker === 'string' ? e.series_ticker : undefined,
    title: typeof e.title === 'string' ? e.title : undefined,
    yes_sub_title: typeof e.yes_sub_title === 'string' ? e.yes_sub_title : undefined,
    close_time: typeof e.close_time === 'string' ? e.close_time : undefined,
    status: typeof e.status === 'string' ? e.status : undefined,
    yes_bid_dollars: dollars(prices.yes_bid),
    yes_ask_dollars: dollars(prices.yes_ask),
    no_bid_dollars: dollars(prices.no_bid),
    no_ask_dollars: dollars(prices.no_ask),
    last_price_dollars: dollars(prices.last_price),
    volume_fp: volume === null ? undefined : String(volume),
    open_interest_fp: openInterest === null ? undefined : String(openInterest),
  }
}

/**
 * Validate the snapshot document. Returns null — unavailable — on ANY shape
 * drift: wrong source, a failed fetch's error field, an unparseable
 * fetched_at, a non-array markets field, or one malformed market entry.
 * Failing the whole snapshot on one bad entry is deliberate: a document
 * that drifted in one place cannot be trusted in another, and the live
 * read path is always there to take over.
 */
export function parseServerSnapshot(raw: unknown): KalshiServerSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  if (s.source !== 'kalshi-public-api') return null
  // A failed fetch writes its error and carries no prices to serve; an
  // error field that is neither null nor absent is drift either way.
  if (s.error !== undefined && s.error !== null) return null
  const fetchedAt = typeof s.fetched_at === 'string' ? Date.parse(s.fetched_at) : NaN
  if (!Number.isFinite(fetchedAt)) return null
  if (!Array.isArray(s.markets)) return null
  const markets: KalshiServerSnapshotMarket[] = []
  for (const entry of s.markets) {
    const market = toKalshiMarket(entry)
    if (!market) return null
    markets.push(market)
  }
  return { fetchedAt, markets }
}

/**
 * Load and validate the snapshot, then apply the freshness gate: a stamp in
 * the future is drift, not freshness, and past maxAgeMs the snapshot is
 * unavailable. Any failure — transport, shape, age — returns null, and the
 * caller falls back to the live read exactly as it did before Stage 2.
 */
export async function loadServerSnapshot(
  source: KalshiServerSnapshotSource,
  nowMs: number,
  maxAgeMs: number,
): Promise<KalshiServerSnapshot | null> {
  let raw: unknown
  try {
    raw = await source.load()
  } catch {
    return null
  }
  const snap = parseServerSnapshot(raw)
  if (!snap) return null
  if (snap.fetchedAt > nowMs) return null
  if (nowMs - snap.fetchedAt > maxAgeMs) return null
  return snap
}

/**
 * The snapshot's markets for a query's scope, or null when the snapshot
 * does not cover that scope at all. A listing with no ticker / event /
 * series scope is never answered from the snapshot: the snapshot holds
 * only the watchlist, so claiming a general listing from it would report
 * "no markets matched" for markets it never read.
 */
export function serverSnapshotMarketsFor(
  snap: KalshiServerSnapshot,
  q: Pick<KalshiQuery, 'ticker' | 'event_ticker' | 'series_ticker'>,
): KalshiServerSnapshotMarket[] | null {
  if (q.ticker) {
    const market = snap.markets.find(m => m.ticker === q.ticker)
    return market ? [market] : null
  }
  if (q.event_ticker) {
    const markets = snap.markets.filter(m => m.event_ticker === q.event_ticker)
    return markets.length ? markets : null
  }
  if (q.series_ticker) {
    const markets = snap.markets.filter(m => m.series_ticker === q.series_ticker)
    return markets.length ? markets : null
  }
  return null
}
