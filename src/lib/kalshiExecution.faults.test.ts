// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

// @vitest-environment jsdom
// Fault-matrix harness for /funds approve. A fake VENUE keeps the truth (which orders actually
// landed and filled) while the client the app sees fails in seeded, deterministic ways: lost
// responses after the order landed, 5xx/408 after landing, 409 duplicates, lookups that cannot
// see a landed order. After every owner action the invariants below are checked against the
// venue's own records, not against what the app said.
import { generateKeyPairSync, webcrypto } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { KalshiCredentials } from './kalshiAuth'
import { applyFundsCommand, emptyFunds, loadFunds, proposePosition, saveFunds } from './fundsLedger'
import { runFundsCommandWithExecution } from './kalshiExecution'
import { KalshiApiError, KalshiNetworkError, type KalshiClient, type KalshiOrderLookup } from './kalshiTrade'

Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })

const NOW = Date.parse('2026-10-23T15:00:00Z')
const { privateKey } = generateKeyPairSync('ed25519')
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const KEY_ID = 'FAULT-HARNESS-KEY-ID'
const creds: KalshiCredentials = { keyId: KEY_ID, privateKeyPem: PEM, env: 'demo' }

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface VenueOrder { fills: number }

function seedProposal(): string {
  let state = applyFundsCommand(emptyFunds(), { kind: 'limits', changes: { capAmount: 100000 } }, NOW).state
  state = applyFundsCommand(state, { kind: 'deposit', amount: 1000 }, NOW).state
  const proposed = proposePosition(state, {
    venue: 'kalshi', market: 'KX-FAULT', side: 'yes', price: 0.4, probability: 0.55,
    rationale: 'NWS forecast gives 60% rain for the window and three models agree; market lags the update.',
    sources: ['https://weather.gov/forecast'],
  }, NOW)
  saveFunds(proposed.state)
  return proposed.position.id
}

function buildWorld(rand: () => number) {
  const venue = new Map<string, VenueOrder>()
  const postCalls = new Map<string, number>()
  const pick = (table: Array<[number, string]>): string => {
    const r = rand()
    let acc = 0
    for (const [p, name] of table) { acc += p; if (r < acc) return name }
    return table[table.length - 1][1]
  }
  const client: KalshiClient = {
    async getBalance() {
      const roll = rand()
      if (roll < 0.04) throw new KalshiNetworkError('balance unreachable')
      return { balanceCents: roll < 0.08 ? 100 : 50000, balanceDollars: roll < 0.08 ? 1 : 500, portfolioValueCents: 0, updatedTs: 0, breakdown: null }
    },
    async getMarketQuote() {
      const roll = rand()
      if (roll < 0.03) throw new KalshiNetworkError('quote unreachable')
      if (roll < 0.05) return null
      return { yesAsk: 0.42, noAsk: 0.44, status: 'active', exchangeIndex: 0 }
    },
    async createOrder(input) {
      postCalls.set(input.clientOrderId, (postCalls.get(input.clientOrderId) ?? 0) + 1)
      // Kalshi's documented behaviour: a repeated client_order_id is rejected with 409.
      if (venue.has(input.clientOrderId)) throw new KalshiApiError(409, 'already_exists', 'Order with this client_order_id already exists.')
      const land = (fills: number) => { venue.set(input.clientOrderId, { fills }) }
      const result = (fills: number) => ({ orderId: `ord-${input.clientOrderId}`, clientOrderId: input.clientOrderId, fillCount: fills, remainingCount: input.count - fills, ...(fills > 0 ? { averageFillPrice: 0.42, averageFeePaid: 0.0171 } : {}) })
      switch (pick([[0.30, 'fill'], [0.08, 'partial'], [0.08, 'zero'], [0.14, 'net-before'], [0.14, 'net-after-fill'], [0.05, 'net-after-zero'], [0.05, 'refuse'], [0.06, '5xx-after'], [0.04, '5xx-before'], [0.03, '408-after'], [0.03, '429']])) {
        case 'fill': land(input.count); return result(input.count)
        case 'partial': { const n = Math.max(1, Math.floor(input.count / 2)); land(n); return result(n) }
        case 'zero': land(0); return result(0)
        case 'net-before': throw new KalshiNetworkError('socket closed before send')
        case 'net-after-fill': land(input.count); throw new KalshiNetworkError('response lost')
        case 'net-after-zero': land(0); throw new KalshiNetworkError('response lost')
        case 'refuse': throw new KalshiApiError(400, 'insufficient_shard_balance', 'insufficient shard balance')
        case '5xx-after': land(input.count); throw new KalshiApiError(503, 'unavailable', 'upstream error')
        case '5xx-before': throw new KalshiApiError(500, 'internal', 'upstream error')
        case '408-after': land(input.count); throw new KalshiApiError(408, 'timeout', 'request timeout')
        default: throw new KalshiApiError(429, 'rate_limited', 'slow down')
      }
    },
    async findOrderByClientOrderId(clientOrderId): Promise<KalshiOrderLookup> {
      const landed = venue.get(clientOrderId)
      const roll = rand()
      // V2-order visibility in this lookup is unproven: a landed order may read as a clean miss.
      if (landed) {
        if (roll < 0.55) return { kind: 'found', order: { orderId: `ord-${clientOrderId}`, clientOrderId, status: landed.fills > 0 ? 'executed' : 'canceled', fillCount: landed.fills, remainingCount: 0, ...(landed.fills > 0 ? { averageFillPrice: 0.42, totalFees: 0.2 } : {}) } }
        return roll < 0.8 ? { kind: 'not_found' } : { kind: 'unknown', reason: 'lookup failed' }
      }
      return roll < 0.7 ? { kind: 'not_found' } : { kind: 'unknown', reason: 'lookup failed' }
    },
    async getSettlements() { return [] },
  }
  return { client, venue, postCalls }
}

const SEEDS = 400

describe('fault matrix: /funds approve against a venue that loses responses', () => {
  beforeEach(() => { localStorage.clear() })

  it(`holds the money invariants across ${SEEDS} seeded fault schedules`, async () => {
    const violations: string[] = []
    for (let seed = 1; seed <= SEEDS; seed++) {
      localStorage.clear()
      const rand = mulberry32(seed)
      const { client, venue, postCalls } = buildWorld(rand)
      const id = seedProposal()
      const deps = { creds, client, now: () => NOW, relayUrl: '', delay: async () => {} }
      const fail = (what: string) => violations.push(`seed ${seed}: ${what}`)
      const venueFills = () => [...venue.values()].reduce((sum, o) => sum + o.fills, 0)

      for (let step = 1; step <= 5; step++) {
        const before = loadFunds().positions.find(p => p.id === id)!
        if (before.status === 'placed') break
        const callsBefore = [...postCalls.values()].reduce((s, n) => s + n, 0)
        const wasResume = before.status === 'approved'
        const reply = (await runFundsCommandWithExecution(`/funds approve ${id}`, deps)) ?? ''
        const after = loadFunds().positions.find(p => p.id === id)!
        const callsDelta = [...postCalls.values()].reduce((s, n) => s + n, 0) - callsBefore

        // I1: a key is never sent twice.
        for (const [key, n] of postCalls) if (n > 1) fail(`step ${step}: key ${key} POSTed ${n} times`)
        // I2: a resumed approval never sends.
        if (wasResume && callsDelta > 0) fail(`step ${step}: a resumed approve sent ${callsDelta} POST(s)`)
        // I3: "Placed" means the venue filled what the ledger recorded.
        if (reply.startsWith('Placed')) {
          const key = after.clientOrderId ?? ''
          const landed = venue.get(key)
          if (after.status !== 'placed') fail(`step ${step}: replied Placed but ledger status is ${after.status}`)
          else if (!landed || landed.fills <= 0) fail(`step ${step}: replied Placed but the venue has no fill for ${key}`)
          else if (after.contracts !== undefined && (after as { filledContracts?: number }).filledContracts !== undefined && (after as { filledContracts?: number }).filledContracts !== landed.fills) fail(`step ${step}: ledger fill ${(after as { filledContracts?: number }).filledContracts} != venue fill ${landed.fills}`)
        }
        // I4: "Nothing was spent" is never said while the venue holds a fill for this position.
        if (/Nothing was spent/i.test(reply) && venueFills() > 0) fail(`step ${step}: said "Nothing was spent" but the venue holds ${venueFills()} filled contract(s)`)
        // I5: no more contracts filled at the venue than the position asked for.
        if (venueFills() > before.contracts) fail(`step ${step}: venue fills ${venueFills()} exceed the position's ${before.contracts} contracts (double order)`)
        // I6: the app never believes "proposed" while a fill exists (the lost-fill double-order setup).
        if (after.status === 'proposed' && venueFills() > 0) fail(`step ${step}: ledger is back to proposed but the venue holds ${venueFills()} filled contract(s)`)
        // I7: an Unknown reply keeps the approval and its key.
        if (reply.startsWith('Unknown:') && (after.status !== 'approved' || !after.clientOrderId)) fail(`step ${step}: Unknown reply but status ${after.status}, key ${after.clientOrderId ?? 'none'}`)
        // I8: no key material in any reply.
        if (reply.includes(KEY_ID) || reply.includes('BEGIN PRIVATE KEY')) fail(`step ${step}: key material in a reply`)
      }
    }
    expect(violations.slice(0, 12)).toEqual([])
  }, 120_000)
})
