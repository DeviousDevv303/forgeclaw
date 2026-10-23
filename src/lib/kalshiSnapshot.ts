// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

/**
 * Last-known-good Kalshi market snapshots, so a failed live read degrades to labelled,
 * timestamped data instead of a dead end.
 *
 * The honesty rule is unchanged: a snapshot is data Kalshi actually returned, stamped
 * with the time it was fetched. It is never a guessed price. Past `maxAgeMs` a snapshot
 * is not used at all, and the read fails as before.
 *
 * Scope: display reads only (kalshi_markets listings). Settlement and order paths never
 * read snapshots — those need live data or nothing.
 */

import type { KalshiMarket, KalshiQuery } from './kalshiMarkets'

/**
 * Default maximum snapshot age. Per-call override via KalshiDeps.maxSnapshotAgeMs.
 *
 * Why 15 minutes (owner decision, 2026-10-23): the markets this was built for (KXHIGH* daily
 * temperature buckets) reprice over hours, so 15 min of staleness is well inside their noise,
 * while short enough that a snapshot cannot quietly stand in for a whole session of live reads.
 * It is per call, not global, because faster markets will need a tighter limit — a hardcoded
 * threshold becomes a law nobody remembers choosing.
 */
export const KALSHI_SNAPSHOT_MAX_AGE_MS = 15 * 60_000
/** Distinct queries remembered; oldest dropped first. */
export const KALSHI_SNAPSHOT_MAX_ENTRIES = 12
/** Markets kept per query (the most traded). Bounded so localStorage stays small. */
export const KALSHI_SNAPSHOT_MAX_MARKETS = 50
export const KALSHI_SNAPSHOT_STORAGE_KEY = 'forgeclaw_kalshi_snapshots'

export interface KalshiSnapshot {
  key: string
  /** When Kalshi answered (ms epoch) — age is measured from this, never from a write or commit time. */
  fetchedAt: number
  /** Markets matched at fetch time, before the per-snapshot cap. */
  matched: number
  scanned: number
  markets: KalshiMarket[]
}

export interface KalshiSnapshotStore {
  load(): KalshiSnapshot[]
  save(snapshots: KalshiSnapshot[]): void
}

/** The cache key: the filters that change which markets come back. `limit` is display-only. */
export function snapshotKey(q: KalshiQuery): string {
  const parts: Array<[string, unknown]> = [
    ['ticker', q.ticker], ['event_ticker', q.event_ticker], ['series_ticker', q.series_ticker],
    ['query', q.query?.trim().toLowerCase() || undefined], ['closes_within_hours', q.closes_within_hours], ['min_yes_ask', q.min_yes_ask],
  ]
  return JSON.stringify(parts.filter(([, v]) => v !== undefined && v !== null && v !== ''))
}

/** Drop the long rules text: a snapshot is for prices, and the cap is on bytes. */
function slim(m: KalshiMarket): KalshiMarket {
  const rest = { ...m }
  delete rest.rules_primary
  return rest
}

export function localStorageSnapshotStore(storageKey = KALSHI_SNAPSHOT_STORAGE_KEY): KalshiSnapshotStore {
  return {
    load() {
      try {
        const raw = localStorage.getItem(storageKey)
        const parsed: unknown = raw ? JSON.parse(raw) : []
        return Array.isArray(parsed)
          ? parsed.filter((s): s is KalshiSnapshot => !!s && typeof s.key === 'string' && Number.isFinite(s.fetchedAt) && Array.isArray(s.markets))
          : []
      } catch {
        return []
      }
    },
    save(snapshots) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(snapshots))
      } catch {
        // Storage full, private mode or no storage: the fallback is best-effort, the live read is unaffected.
      }
    },
  }
}

export function recordSnapshot(store: KalshiSnapshotStore, q: KalshiQuery, markets: KalshiMarket[], scanned: number, fetchedAt: number): void {
  const key = snapshotKey(q)
  const entry: KalshiSnapshot = { key, fetchedAt, matched: markets.length, scanned, markets: markets.slice(0, KALSHI_SNAPSHOT_MAX_MARKETS).map(slim) }
  const rest = store.load().filter(s => s.key !== key)
  store.save([entry, ...rest].slice(0, KALSHI_SNAPSHOT_MAX_ENTRIES))
}

/**
 * The freshest usable snapshot for this query: same filters exactly, or — for a single
 * ticker — any snapshot that holds that ticker. Null when nothing is within maxAgeMs.
 */
export function findSnapshot(store: KalshiSnapshotStore, q: KalshiQuery, nowMs: number, maxAgeMs: number): KalshiSnapshot | null {
  const fresh = (s: KalshiSnapshot) => s.fetchedAt <= nowMs && nowMs - s.fetchedAt <= maxAgeMs
  const all = store.load().filter(fresh).sort((a, b) => b.fetchedAt - a.fetchedAt)
  const key = snapshotKey(q)
  const exact = all.find(s => s.key === key)
  if (exact) return exact
  if (q.ticker) {
    const holder = all.find(s => s.markets.some(m => m.ticker === q.ticker))
    if (holder) {
      const markets = holder.markets.filter(m => m.ticker === q.ticker)
      return { ...holder, key, matched: markets.length, markets }
    }
  }
  return null
}

export function formatAge(ms: number): string {
  const min = Math.floor(ms / 60_000)
  return min < 1 ? `${Math.max(0, Math.round(ms / 1000))} s` : `${min} min`
}
