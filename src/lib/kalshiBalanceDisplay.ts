// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

/**
 * The "Kalshi (live)" balance block: the exchange's own numbers, formatted for the
 * Funds panel, the funds_status tool and the typed /funds status — one shared
 * formatter, so every surface shows the same honest picture.
 *
 * The honesty rules (owner-approved balance plan, 2026-10-23, five conditions):
 * - This block reports ONLY what Kalshi answered. It sits next to the local ledger
 *   and never merges with it: when a live read fails, the fallback is the last good
 *   LIVE read, labelled STALE with its age — never the ledger's number dressed up
 *   as the exchange's.
 * - The aggregate carries its warning verbatim: orders spend from one shard, so a
 *   healthy total can sit next to an empty shard. Per-shard lines come from the
 *   balance response's own breakdown; a shard Kalshi did not report is absent from
 *   the list, never shown as $0.
 * - Past the max age a snapshot is not used at all (the #266 kalshiSnapshot rule):
 *   the read reports that it could not be read, and why.
 * - Display only. This module reads; the approval gate never reads this module's
 *   snapshot — it makes its own live reads, exactly as before.
 */

import { KalshiApiError, KalshiNetworkError, type KalshiBalance, type KalshiClient } from './kalshiTrade'
import { money } from './fundsLedger'
import { formatAge } from './kalshiSnapshot'
import { describeSignedReadsPause } from './kalshiMarkets'

/**
 * Maximum age for a last-good balance snapshot. Why 15 minutes (same reasoning as
 * the market snapshots, #266): a balance changes only on fills, settlements and
 * transfers, so a quarter hour of staleness cannot misrepresent an idle account —
 * while past it, showing a number as "the balance" would be a claim nobody made.
 */
export const KALSHI_BALANCE_MAX_AGE_MS = 15 * 60_000
export const KALSHI_BALANCE_STORAGE_KEY = 'forgeclaw_kalshi_balance_snapshot'

/** The shards Kalshi partitions balances across, with the names the owner knows them by. */
export const SHARD_LABELS: Record<number, string> = { 0: 'general', 1: 'combos', 2: 'crypto', 3: 'sports' }

/** A shard's display name; an index outside the known set stays a bare number — no guessed label. */
export function shardLabel(exchangeIndex: number): string {
  const label = SHARD_LABELS[exchangeIndex]
  return label ? `shard ${exchangeIndex} (${label})` : `shard ${exchangeIndex}`
}

export interface KalshiBalanceSnapshot {
  /** The last balance Kalshi actually returned. */
  balance: KalshiBalance
  /** When that read was fetched (ms epoch) — age is measured from this. */
  fetchedAt: number
  /** The exchange the read belongs to ('demo' | 'prod'): a demo snapshot never renders as a prod balance. */
  env: string
}

export interface KalshiBalanceSnapshotStore {
  load(): KalshiBalanceSnapshot | null
  save(snapshot: KalshiBalanceSnapshot): void
}

export function localStorageBalanceStore(storageKey = KALSHI_BALANCE_STORAGE_KEY): KalshiBalanceSnapshotStore {
  return {
    load() {
      try {
        const raw = localStorage.getItem(storageKey)
        const parsed: unknown = raw ? JSON.parse(raw) : null
        if (!parsed || typeof parsed !== 'object') return null
        const s = parsed as Partial<KalshiBalanceSnapshot>
        const b = s.balance as Partial<KalshiBalance> | undefined
        if (!b || typeof b.balanceDollars !== 'number' || !Number.isFinite(s.fetchedAt) || typeof s.env !== 'string') return null
        return { balance: b as KalshiBalance, fetchedAt: s.fetchedAt as number, env: s.env }
      } catch {
        return null
      }
    },
    save(snapshot) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(snapshot))
      } catch {
        // Storage full or unavailable: the snapshot is best-effort; the live read is unaffected.
      }
    },
  }
}

const clock = (ms: number): string => `${new Date(ms).toISOString().slice(11, 19)} UTC`

/**
 * The block itself, from a balance Kalshi returned. `stale` is set only when the
 * balance is served from the last-good snapshot after a failed read; its age is
 * computed against `nowMs`, both stamped on the block.
 */
export function formatKalshiBalanceBlock(balance: KalshiBalance, opts: { env: string; fetchedAt: number; nowMs: number; stale: boolean }): string {
  const header = `Kalshi (live) — ${opts.env}${opts.stale ? ` — STALE: last good read ${formatAge(opts.nowMs - opts.fetchedAt)} ago` : ''}`
  const lines = [
    header,
    `Total across shards — orders spend from one shard: ${money(balance.balanceDollars)}`,
    `Read ${clock(opts.fetchedAt)} · Kalshi last balance update ${balance.updatedTs !== null ? clock(balance.updatedTs * 1000) : 'not reported'}`,
  ]
  if (balance.breakdown === null) {
    lines.push('Per-shard balances: not reported by this read.')
  } else if (balance.breakdown.length === 0) {
    lines.push('Per-shard balances: Kalshi reported an empty breakdown for this read.')
  } else {
    for (const shard of [...balance.breakdown].sort((a, b) => a.exchangeIndex - b.exchangeIndex)) {
      lines.push(`  ${shardLabel(shard.exchangeIndex)}: ${money(shard.balanceDollars)}`)
    }
  }
  return lines.join('\n')
}

/** Why a balance read failed, in the same words the funds status path has always used. */
export function describeBalanceReadError(error: unknown): string {
  if (error instanceof KalshiApiError) return `Kalshi refused (${error.code}: ${error.message})`
  if (error instanceof KalshiNetworkError) return 'this browser could not reach Kalshi'
  return 'unknown error'
}

/**
 * When the aggregate response omits the breakdown, per-shard balances come from
 * scoped reads (GET /portfolio/balance?exchange_index=N) — the fallback the plan
 * names. All-or-nothing: a scoped read that fails leaves the breakdown unreported
 * rather than showing a partial list as if it were the whole partition.
 */
async function withScopedBreakdown(client: KalshiClient, balance: KalshiBalance): Promise<KalshiBalance> {
  try {
    const entries = []
    for (const exchangeIndex of Object.keys(SHARD_LABELS).map(Number)) {
      const scoped = await client.getBalance(exchangeIndex)
      entries.push({ exchangeIndex, balanceDollars: scoped.balanceDollars })
    }
    return { ...balance, breakdown: entries }
  } catch {
    return balance
  }
}

/**
 * Read the live balance and format the block. On success the read becomes the
 * last-good snapshot. On failure: the snapshot, while it is same-env and inside
 * the max age, formatted STALE — or the plain could-not-be-read line, which is
 * the only honest answer left. The ledger is never consulted here.
 */
export async function readKalshiBalanceBlock(
  client: KalshiClient,
  opts: { env: string; now?: () => number; store?: KalshiBalanceSnapshotStore },
): Promise<string> {
  const now = opts.now ?? Date.now
  const store = opts.store ?? localStorageBalanceStore()
  // While market-read signing is paused the reader is told, on every surface that shows this block
  // (typed /funds status, the funds_status tool, the Funds panel): a paused key is otherwise silent.
  const withPauseNote = (block: string): string => {
    const note = describeSignedReadsPause(now())
    return note ? `${block}\n${note}` : block
  }
  try {
    let balance = await client.getBalance()
    if (balance.breakdown === null) balance = await withScopedBreakdown(client, balance)
    const fetchedAt = now()
    store.save({ balance, fetchedAt, env: opts.env })
    return withPauseNote(formatKalshiBalanceBlock(balance, { env: opts.env, fetchedAt, nowMs: fetchedAt, stale: false }))
  } catch (error) {
    const snapshot = store.load()
    const nowMs = now()
    if (snapshot && snapshot.env === opts.env && snapshot.fetchedAt <= nowMs && nowMs - snapshot.fetchedAt <= KALSHI_BALANCE_MAX_AGE_MS) {
      return withPauseNote(formatKalshiBalanceBlock(snapshot.balance, { env: opts.env, fetchedAt: snapshot.fetchedAt, nowMs, stale: true }))
    }
    return withPauseNote(`Kalshi (live): could not be read — ${describeBalanceReadError(error)}.`)
  }
}
