// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  KALSHI_BALANCE_MAX_AGE_MS, formatKalshiBalanceBlock, readKalshiBalanceBlock, shardLabel,
  type KalshiBalanceSnapshot, type KalshiBalanceSnapshotStore,
} from './kalshiBalanceDisplay'
import { KalshiNetworkError, type KalshiBalance, type KalshiClient } from './kalshiTrade'

const T0 = Date.parse('2026-10-23T15:00:00Z')

const balance = (over: Partial<KalshiBalance> = {}): KalshiBalance => ({
  balanceCents: 2500,
  balanceDollars: 25,
  portfolioValueCents: 2500,
  updatedTs: T0 / 1000 - 60,
  breakdown: [
    { exchangeIndex: 3, balanceDollars: 5 },
    { exchangeIndex: 0, balanceDollars: 20 },
  ],
  ...over,
})

function memoryStore(initial: KalshiBalanceSnapshot | null = null): KalshiBalanceSnapshotStore & { saved: KalshiBalanceSnapshot | null } {
  const store = {
    saved: initial,
    load: () => store.saved,
    save: (s: KalshiBalanceSnapshot) => { store.saved = s },
  }
  return store
}

function fakeClient(behavior: { aggregate?: KalshiBalance | Error; scoped?: Record<number, number> }): KalshiClient {
  const unused = async (): Promise<never> => { throw new Error('not used by the balance display') }
  return {
    async getBalance(exchangeIndex?: number) {
      if (exchangeIndex !== undefined) {
        const dollars = behavior.scoped?.[exchangeIndex]
        if (dollars === undefined) throw new KalshiNetworkError('scoped read failed')
        return balance({ balanceCents: Math.round(dollars * 100), balanceDollars: dollars, breakdown: null })
      }
      if (behavior.aggregate instanceof Error) throw behavior.aggregate
      return behavior.aggregate ?? balance()
    },
    createOrder: unused,
    findOrderByClientOrderId: unused,
    getSettlements: unused,
    getMarketQuote: unused,
  }
}

describe('formatKalshiBalanceBlock', () => {
  it('shows the aggregate with its one-shard warning verbatim, per-shard lines with labels, and both timestamps', () => {
    const block = formatKalshiBalanceBlock(balance(), { env: 'prod', fetchedAt: T0, nowMs: T0, stale: false })
    expect(block).toContain('Kalshi (live) — prod')
    expect(block).toContain('Total across shards — orders spend from one shard: $25.00')
    expect(block).toContain('shard 0 (general): $20.00')
    expect(block).toContain('shard 3 (sports): $5.00')
    expect(block).toContain('Read 15:00:00 UTC')
    expect(block).toContain('Kalshi last balance update 14:59:00 UTC')
    expect(block).not.toContain('STALE')
  })

  it('an unreported breakdown is stated as not reported — no shard lines are invented', () => {
    const block = formatKalshiBalanceBlock(balance({ breakdown: null }), { env: 'demo', fetchedAt: T0, nowMs: T0, stale: false })
    expect(block).toContain('Per-shard balances: not reported by this read.')
    expect(block).not.toContain('shard 0')
  })

  it('an unknown shard index gets a bare number, never a guessed label', () => {
    expect(shardLabel(7)).toBe('shard 7')
    const block = formatKalshiBalanceBlock(balance({ breakdown: [{ exchangeIndex: 7, balanceDollars: 1 }] }), { env: 'demo', fetchedAt: T0, nowMs: T0, stale: false })
    expect(block).toContain('shard 7: $1.00')
  })

  it('a stale block says so, with the age of the read it is serving', () => {
    const block = formatKalshiBalanceBlock(balance(), { env: 'demo', fetchedAt: T0, nowMs: T0 + 5 * 60_000, stale: true })
    expect(block).toContain('STALE: last good read 5 min ago')
  })
})

describe('readKalshiBalanceBlock', () => {
  it('a successful read is formatted fresh and becomes the last-good snapshot', async () => {
    const store = memoryStore()
    const block = await readKalshiBalanceBlock(fakeClient({}), { env: 'demo', now: () => T0, store })
    expect(block).toContain('Total across shards — orders spend from one shard: $25.00')
    expect(block).not.toContain('STALE')
    expect(store.saved?.fetchedAt).toBe(T0)
    expect(store.saved?.balance.balanceDollars).toBe(25)
  })

  it('when the response omits the breakdown, scoped reads fill it in', async () => {
    const store = memoryStore()
    const client = fakeClient({ aggregate: balance({ breakdown: null }), scoped: { 0: 20, 1: 0, 2: 0, 3: 5 } })
    const block = await readKalshiBalanceBlock(client, { env: 'demo', now: () => T0, store })
    expect(block).toContain('shard 0 (general): $20.00')
    expect(block).toContain('shard 3 (sports): $5.00')
    expect(block).not.toContain('not reported')
  })

  it('a failed read serves the last good LIVE read, marked STALE — the number is Kalshi’s, never a substitute', async () => {
    const store = memoryStore({ balance: balance(), fetchedAt: T0 - 2 * 60_000, env: 'demo' })
    const block = await readKalshiBalanceBlock(fakeClient({ aggregate: new KalshiNetworkError('offline') }), { env: 'demo', now: () => T0, store })
    expect(block).toContain('STALE: last good read 2 min ago')
    expect(block).toContain('Total across shards — orders spend from one shard: $25.00')
  })

  it('a failed read with no usable snapshot says it could not be read — and names no balance at all', async () => {
    const store = memoryStore()
    const block = await readKalshiBalanceBlock(fakeClient({ aggregate: new KalshiNetworkError('offline') }), { env: 'demo', now: () => T0, store })
    expect(block).toContain('Kalshi (live): could not be read — this browser could not reach Kalshi.')
    expect(block).not.toContain('$')
  })

  it('a snapshot older than the max age is not served: the read reports failure instead', async () => {
    const store = memoryStore({ balance: balance(), fetchedAt: T0 - KALSHI_BALANCE_MAX_AGE_MS - 1, env: 'demo' })
    const block = await readKalshiBalanceBlock(fakeClient({ aggregate: new KalshiNetworkError('offline') }), { env: 'demo', now: () => T0, store })
    expect(block).toContain('could not be read')
    expect(block).not.toContain('$25.00')
  })

  it('a demo snapshot never stands in for a prod read', async () => {
    const store = memoryStore({ balance: balance(), fetchedAt: T0 - 60_000, env: 'demo' })
    const block = await readKalshiBalanceBlock(fakeClient({ aggregate: new KalshiNetworkError('offline') }), { env: 'prod', now: () => T0, store })
    expect(block).toContain('could not be read')
    expect(block).not.toContain('$25.00')
  })
})

describe('the approval gate never reads the display snapshot', () => {
  it('kalshiExecution imports no balance-snapshot store; its only display-module use is the status formatter path', () => {
    const src = readFileSync(new URL('./kalshiExecution.ts', import.meta.url), 'utf8')
    expect(src).not.toContain('localStorageBalanceStore')
    expect(src).not.toContain('KALSHI_BALANCE_STORAGE_KEY')
    // The import plus exactly one call: runFundsCommandWithExecution's /funds status.
    // A second call site — above all in preSendGates — fails this test on purpose:
    // the gate makes its own live reads and never consumes displayed data.
    expect(src.match(/readKalshiBalanceBlock/g)).toHaveLength(2)
  })
})
