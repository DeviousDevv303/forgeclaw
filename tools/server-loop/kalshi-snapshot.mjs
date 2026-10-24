// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

/**
 * Server loop Stage 2 — the Kalshi price snapshot fetcher.
 *
 * Reads Kalshi's PUBLIC market-data API (no key, no account, no credentials —
 * the same unauthenticated reads the app makes) for the watchlist series and
 * tickers, and writes ONE JSON snapshot. A scheduled workflow commits that
 * file to the `kalshi-snapshot-data` branch; the app reads it from there
 * instead of calling Kalshi from the owner's browser, whose per-IP quota is
 * what kept draining (the 429 wall). This runner's egress is a different
 * bucket, and one fetch every 15 minutes serves every read until it goes
 * stale.
 *
 * Honesty rules, same as everywhere in this project:
 * - Prices are copied from Kalshi's answer, never derived, rounded into
 *   existence, or guessed. A market Kalshi lists without a quote is written
 *   with null price fields — absence, not invention.
 * - On any fetch failure the snapshot is still written, with an `error`
 *   field naming what failed and NO fabricated prices, and the process
 *   exits non-zero AFTER writing — the failure is visible in the data the
 *   app reads (it fails closed on the error field) and in the run's status.
 *
 * Usage: node tools/server-loop/kalshi-snapshot.mjs [output-path]
 *   output-path defaults to ./kalshi-snapshot.json (the caller's cwd).
 *   The watchlist defaults to kalshi-watchlist.json beside this script;
 *   override with KALSHI_WATCHLIST=<path>.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const KALSHI_API_BASE = 'https://external-api.kalshi.com/trade-api/v2'
export const SNAPSHOT_SOURCE = 'kalshi-public-api'

const PAGE_LIMIT = 1000
/**
 * Pages fetched per series before stopping. Why 5: the watchlist holds
 * game/fight series — the largest observed (KXNCAAFGAME) is ~450 open
 * markets, one page — so 5 pages (5,000 markets) is a ceiling against a
 * runaway cursor, not an expected working size.
 */
const MAX_PAGES_PER_SERIES = 5
const REQUEST_TIMEOUT_MS = 30_000

/** "0.5100" -> 0.51; absent or non-numeric -> null (Kalshi reported no value). */
export function numOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** A contract price: a finite number in [0, 1], else null. Out-of-range is junk, never clamped into a price. */
export function priceOrNull(value) {
  const n = numOrNull(value)
  return n !== null && n >= 0 && n <= 1 ? n : null
}

/**
 * One Kalshi market record -> its snapshot entry. Only the fields the app
 * reads are carried; the long rules text stays behind (a snapshot is for
 * prices, and the file is committed every 15 minutes).
 */
export function toSnapshotMarket(raw, seriesTicker) {
  if (!raw || typeof raw.ticker !== 'string' || !raw.ticker) return null
  return {
    ticker: raw.ticker,
    event_ticker: typeof raw.event_ticker === 'string' ? raw.event_ticker : null,
    series_ticker: seriesTicker ?? null,
    title: typeof raw.title === 'string' ? raw.title : null,
    yes_sub_title: typeof raw.yes_sub_title === 'string' ? raw.yes_sub_title : null,
    yes_bid: priceOrNull(raw.yes_bid_dollars),
    yes_ask: priceOrNull(raw.yes_ask_dollars),
    no_bid: priceOrNull(raw.no_bid_dollars),
    no_ask: priceOrNull(raw.no_ask_dollars),
    last_price: priceOrNull(raw.last_price_dollars),
    volume: numOrNull(raw.volume_fp),
    open_interest: numOrNull(raw.open_interest_fp),
    status: typeof raw.status === 'string' ? raw.status : null,
    close_time: typeof raw.close_time === 'string' ? raw.close_time : null,
  }
}

/** The snapshot document. `error` is null on a clean fetch; on failure it names what failed and markets holds only what was really read. */
export function buildSnapshot({ fetchedAt, httpStatus, markets, error }) {
  return {
    fetched_at: fetchedAt,
    source: SNAPSHOT_SOURCE,
    http_status: httpStatus,
    error: error ?? null,
    markets,
  }
}

async function fetchMarketsPage(fetchFn, url) {
  const res = await fetchFn(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) {
    const err = new Error(`Kalshi returned HTTP ${res.status} for ${url.split('?')[0]}`)
    err.httpStatus = res.status
    throw err
  }
  const data = await res.json()
  if (!data || !Array.isArray(data.markets)) {
    const err = new Error(`Kalshi response for ${url.split('?')[0]} had no "markets" array`)
    err.httpStatus = res.status
    throw err
  }
  return { markets: data.markets, cursor: typeof data.cursor === 'string' && data.cursor ? data.cursor : null, status: res.status }
}

/** Every open market in one series, paged. Throws on the first failed page — partial series data is not written as if complete. */
async function fetchSeries(fetchFn, seriesTicker) {
  const out = []
  let cursor = null
  let status = null
  for (let page = 0; page < MAX_PAGES_PER_SERIES; page++) {
    const p = new URLSearchParams({ series_ticker: seriesTicker, status: 'open', limit: String(PAGE_LIMIT) })
    if (cursor) p.set('cursor', cursor)
    const got = await fetchMarketsPage(fetchFn, `${KALSHI_API_BASE}/markets?${p.toString()}`)
    status = got.status
    out.push(...got.markets)
    cursor = got.cursor
    if (!cursor) break
  }
  return { markets: out, status }
}

/** The watchlist tickers, read in one call. Their series is not asserted — the entries carry series_ticker: null. */
async function fetchTickers(fetchFn, tickers) {
  const p = new URLSearchParams({ tickers: tickers.join(',') })
  const got = await fetchMarketsPage(fetchFn, `${KALSHI_API_BASE}/markets?${p.toString()}`)
  return { markets: got.markets, status: got.status }
}

/**
 * Fetch the whole watchlist and assemble the snapshot. Never throws: the
 * result is { snapshot, ok } — on failure the snapshot carries the error and
 * whatever was really read (possibly nothing), and ok is false so the caller
 * exits non-zero after writing it.
 */
export async function collectSnapshot({ fetchFn = fetch, watchlist, fetchedAt }) {
  const byTicker = new Map()
  const failures = []
  let httpStatus = null
  const series = Array.isArray(watchlist?.series) ? watchlist.series.filter(s => typeof s === 'string' && s) : []
  const tickers = Array.isArray(watchlist?.tickers) ? watchlist.tickers.filter(s => typeof s === 'string' && s) : []

  for (const seriesTicker of series) {
    try {
      const { markets, status } = await fetchSeries(fetchFn, seriesTicker)
      httpStatus = status ?? httpStatus
      for (const raw of markets) {
        const entry = toSnapshotMarket(raw, seriesTicker)
        if (entry && !byTicker.has(entry.ticker)) byTicker.set(entry.ticker, entry)
      }
    } catch (error) {
      if (typeof error?.httpStatus === 'number') httpStatus = error.httpStatus
      failures.push(`${seriesTicker}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (tickers.length) {
    try {
      const { markets, status } = await fetchTickers(fetchFn, tickers)
      httpStatus = status ?? httpStatus
      for (const raw of markets) {
        const entry = toSnapshotMarket(raw, null)
        if (entry && !byTicker.has(entry.ticker)) byTicker.set(entry.ticker, entry)
      }
    } catch (error) {
      if (typeof error?.httpStatus === 'number') httpStatus = error.httpStatus
      failures.push(`tickers: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const snapshot = buildSnapshot({
    fetchedAt,
    httpStatus,
    markets: [...byTicker.values()],
    error: failures.length ? failures.join('; ') : null,
  })
  return { snapshot, ok: failures.length === 0 }
}

function loadWatchlist() {
  const path = process.env.KALSHI_WATCHLIST || fileURLToPath(new URL('./kalshi-watchlist.json', import.meta.url))
  return JSON.parse(readFileSync(path, 'utf8'))
}

async function main() {
  const outPath = process.argv[2] || 'kalshi-snapshot.json'
  // Stamped at the START of the run: the snapshot may only ever look older
  // than the reads it holds, never fresher.
  const fetchedAt = new Date().toISOString()
  let result
  try {
    result = await collectSnapshot({ watchlist: loadWatchlist(), fetchedAt })
  } catch (error) {
    // Even a broken watchlist produces the honest artifact: an error
    // snapshot with no prices, so the app fails closed instead of guessing.
    result = {
      snapshot: buildSnapshot({
        fetchedAt,
        httpStatus: null,
        markets: [],
        error: `fetcher failed before reading Kalshi: ${error instanceof Error ? error.message : String(error)}`,
      }),
      ok: false,
    }
  }
  writeFileSync(outPath, `${JSON.stringify(result.snapshot, null, 2)}\n`)
  const { markets, error } = result.snapshot
  console.log(`kalshi-snapshot: wrote ${outPath} — ${markets.length} markets, fetched_at ${fetchedAt}${error ? `, ERROR: ${error}` : ''}`)
  if (!result.ok) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`kalshi-snapshot: fatal: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
}
