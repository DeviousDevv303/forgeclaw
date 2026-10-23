// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

// @vitest-environment jsdom
import { generateKeyPairSync, webcrypto } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { KalshiCredentials } from './kalshiAuth'
import { FUNDS_STORAGE_KEY, applyFundsCommand, emptyFunds, loadFunds, proposePosition, saveFunds } from './fundsLedger'
import { autoSettleKalshiPositions, directThenRelayFetcher, runFundsCommandWithExecution } from './kalshiExecution'
import { KalshiApiError, KalshiNetworkError, type KalshiClient, type KalshiOrderResult } from './kalshiTrade'

// jsdom's WebCrypto has no Ed25519; Node's does (as in kalshiAuth.test.ts).
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })

const NOW = Date.parse('2026-10-23T15:00:00Z')
const { privateKey } = generateKeyPairSync('ed25519')
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const creds: KalshiCredentials = { keyId: 'SECRET-KEY-ID', privateKeyPem: PEM, env: 'demo' }

function seedProposal(side: 'yes' | 'no' = 'yes', price = 0.4, probability = 0.55): string {
  let state = applyFundsCommand(emptyFunds(), { kind: 'limits', changes: { capAmount: 100000 } }, NOW).state
  state = applyFundsCommand(state, { kind: 'deposit', amount: 1000 }, NOW).state
  const proposed = proposePosition(state, {
    venue: 'kalshi', market: 'KX-TEST', side, price, probability,
    rationale: 'NWS forecast gives 60% rain for the window and three models agree; market lags the update.',
    sources: ['https://weather.gov/forecast'],
  }, NOW)
  saveFunds(proposed.state)
  return proposed.position.id
}

interface FakeBehavior {
  quote?: { yesAsk: number | null; noAsk: number | null } | null
  balanceDollars?: number
  onCreate?: (call: number, input: { clientOrderId: string }) => KalshiOrderResult
  existing?: { fillCount: number; averageFillPrice?: number; totalFees?: number; orderId?: string; status?: string } | null
  settlements?: Array<Record<string, unknown>>
}

function fakeClient(behavior: FakeBehavior): { client: KalshiClient; createCalls: Array<{ side: string; priceDollars: number; clientOrderId: string }> } {
  const createCalls: Array<{ side: string; priceDollars: number; clientOrderId: string }> = []
  const client: KalshiClient = {
    async getBalance() {
      return { balanceCents: Math.round((behavior.balanceDollars ?? 500) * 100), balanceDollars: behavior.balanceDollars ?? 500, portfolioValueCents: 0 }
    },
    async getMarketQuote() {
      return behavior.quote === undefined ? { yesAsk: 0.42, noAsk: 0.44 } : behavior.quote
    },
    async createOrder(input) {
      createCalls.push({ side: input.side, priceDollars: input.priceDollars, clientOrderId: input.clientOrderId })
      if (behavior.onCreate) return behavior.onCreate(createCalls.length, input)
      return { orderId: 'ord-1', clientOrderId: input.clientOrderId, fillCount: input.count, remainingCount: 0, averageFillPrice: 0.42, averageFeePaid: 0.0171 }
    },
    async findOrderByClientOrderId(clientOrderId) {
      if (!behavior.existing) return null
      return {
        orderId: behavior.existing.orderId ?? 'ord-found', clientOrderId, status: behavior.existing.status ?? 'executed',
        fillCount: behavior.existing.fillCount, remainingCount: 0,
        ...(behavior.existing.averageFillPrice !== undefined ? { averageFillPrice: behavior.existing.averageFillPrice } : {}),
        ...(behavior.existing.totalFees !== undefined ? { totalFees: behavior.existing.totalFees } : {}),
      }
    },
    async getSettlements() {
      return (behavior.settlements ?? []) as never
    },
  }
  return { client, createCalls }
}

const deps = (client: KalshiClient) => ({ creds, client, now: () => NOW, relayUrl: '' })

beforeEach(() => { localStorage.clear() })

describe('approve places the order', () => {
  it('happy path: re-quotes, places at the live price, records the real fill', async () => {
    const id = seedProposal()
    const { client, createCalls } = fakeClient({})
    const reply = await runFundsCommandWithExecution(`/funds approve ${id}`, deps(client))
    expect(reply).toContain(`Placed ${id}`)
    expect(reply).toContain('at $0.42')
    expect(createCalls).toHaveLength(1)
    expect(createCalls[0].side).toBe('bid')
    expect(createCalls[0].priceDollars).toBe(0.42)
    const position = loadFunds().positions.find(p => p.id === id)!
    expect(position.status).toBe('placed')
    expect(position.fillPrice).toBe(0.42)
    expect(position.feePaid).toBeGreaterThan(0)
    expect(position.kalshiOrderId).toBe('ord-1')
  })

  it('NO is placed as an ask at 1 − the live NO price', async () => {
    const id = seedProposal('no', 0.4, 0.55)
    const { client, createCalls } = fakeClient({ quote: { yesAsk: 0.58, noAsk: 0.41 } })
    await runFundsCommandWithExecution(`/funds approve ${id}`, deps(client))
    expect(createCalls[0].side).toBe('ask')
    expect(createCalls[0].priceDollars).toBeCloseTo(0.59, 6)
  })

  it('a partial fill records what filled and says so', async () => {
    const id = seedProposal()
    const proposed = loadFunds().positions.find(p => p.id === id)!
    const { client } = fakeClient({
      onCreate: (_n, input) => ({ orderId: 'ord-p', clientOrderId: input.clientOrderId, fillCount: 4, remainingCount: proposed.contracts - 4, averageFillPrice: 0.42, averageFeePaid: 0.0171 }),
    })
    const reply = await runFundsCommandWithExecution(`/funds approve ${id}`, deps(client))
    expect(reply).toContain('Partial fill: 4 of')
    const position = loadFunds().positions.find(p => p.id === id)!
    expect(position.status).toBe('placed')
    expect(position.contracts).toBe(4)
    expect(position.stake).toBeCloseTo(4 * 0.42, 6)
  })

  it('a zero fill spends nothing and returns the proposal to proposed', async () => {
    const id = seedProposal()
    const { client } = fakeClient({
      onCreate: (_n, input) => ({ orderId: 'ord-z', clientOrderId: input.clientOrderId, fillCount: 0, remainingCount: 10 }),
    })
    const reply = await runFundsCommandWithExecution(`/funds approve ${id}`, deps(client))
    expect(reply).toContain('filled 0 contracts')
    expect(reply).toContain('nothing was spent')
    expect(loadFunds().positions.find(p => p.id === id)!.status).toBe('proposed')
  })
})

describe('re-quote at approval (item 8)', () => {
  it('refuses when the price ran past the tolerance, placing nothing', async () => {
    const id = seedProposal('yes', 0.4)
    const { client, createCalls } = fakeClient({ quote: { yesAsk: 0.45, noAsk: 0.47 } })
    const reply = await runFundsCommandWithExecution(`/funds approve ${id}`, deps(client))
    expect(reply).toContain('past your tolerance of 2¢')
    expect(createCalls).toHaveLength(0)
    expect(loadFunds().positions.find(p => p.id === id)!.status).toBe('proposed')
  })

  it('refuses when the edge is gone at the live price', async () => {
    const id = seedProposal('yes', 0.4, 0.5)
    const { client } = fakeClient({ quote: { yesAsk: 0.52, noAsk: 0.54 } })
    const reply = await runFundsCommandWithExecution(`/funds approve ${id}`, deps(client))
    expect(reply).toContain('the edge is gone')
  })

  it('refuses when nothing is offered on the side', async () => {
    const id = seedProposal()
    const { client } = fakeClient({ quote: { yesAsk: null, noAsk: 0.44 } })
    const reply = await runFundsCommandWithExecution(`/funds approve ${id}`, deps(client))
    expect(reply).toContain('no YES contracts are offered')
  })
})

describe('balance gate (item 4)', () => {
  it('refuses when the real Kalshi balance cannot cover stake + fees, naming the balance', async () => {
    const id = seedProposal()
    const { client, createCalls } = fakeClient({ balanceDollars: 3 })
    const reply = await runFundsCommandWithExecution(`/funds approve ${id}`, deps(client))
    expect(reply).toContain('your Kalshi balance is $3.00')
    expect(createCalls).toHaveLength(0)
  })

  it('status appends the live balance when a key is present', async () => {
    seedProposal()
    const { client } = fakeClient({ balanceDollars: 321.09 })
    const reply = await runFundsCommandWithExecution('/funds', deps(client))
    expect(reply).toContain('Kalshi balance (live, demo): $321.09')
  })
})

describe('never double-order (item 5)', () => {
  it('a dropped response that actually filled is recovered by lookup — one POST only', async () => {
    const id = seedProposal()
    const { client, createCalls } = fakeClient({
      onCreate: () => { throw new KalshiNetworkError('socket closed') },
      existing: { fillCount: 10, averageFillPrice: 0.42, totalFees: 0.17, orderId: 'ord-lost' },
    })
    // The proposal sizes to 119 contracts max; the fake "existing" fill is illustrative:
    const reply = await runFundsCommandWithExecution(`/funds approve ${id}`, deps(client))
    expect(reply).toContain('recovered by lookup')
    expect(createCalls).toHaveLength(1)
    expect(loadFunds().positions.find(p => p.id === id)!.status).toBe('placed')
  })

  it('a dropped response with no existing order resends once, same client_order_id', async () => {
    const id = seedProposal()
    const { client, createCalls } = fakeClient({
      onCreate: (n, input) => {
        if (n === 1) throw new KalshiNetworkError('socket closed')
        return { orderId: 'ord-2', clientOrderId: input.clientOrderId, fillCount: 5, remainingCount: 0, averageFillPrice: 0.42, averageFeePaid: 0.0171 }
      },
      existing: null,
    })
    const reply = await runFundsCommandWithExecution(`/funds approve ${id}`, deps(client))
    expect(reply).toContain(`Placed ${id}`)
    expect(createCalls).toHaveLength(2)
    expect(createCalls[0].clientOrderId).toBe(createCalls[1].clientOrderId)
  })

  it('two dropped responses stop: approval stands, nothing resent a third time', async () => {
    const id = seedProposal()
    const { client, createCalls } = fakeClient({
      onCreate: () => { throw new KalshiNetworkError('socket closed') },
      existing: null,
    })
    const reply = await runFundsCommandWithExecution(`/funds approve ${id}`, deps(client))
    expect(reply).toContain('Unknown:')
    expect(createCalls).toHaveLength(2)
    expect(loadFunds().positions.find(p => p.id === id)!.status).toBe('approved')
  })

  it('a Kalshi refusal reverts the approval and names Kalshi’s reason', async () => {
    const id = seedProposal()
    const { client } = fakeClient({
      onCreate: () => { throw new KalshiApiError(400, 'insufficient_balance', 'Insufficient balance.') },
    })
    const reply = await runFundsCommandWithExecution(`/funds approve ${id}`, deps(client))
    expect(reply).toContain('Kalshi refused the order (insufficient_balance: Insufficient balance.)')
    expect(loadFunds().positions.find(p => p.id === id)!.status).toBe('proposed')
  })
})

describe('credentials never leak (item 1)', () => {
  it('the key id and private key appear in no reply and no saved ledger text', async () => {
    const id = seedProposal()
    const { client } = fakeClient({})
    const reply = await runFundsCommandWithExecution(`/funds approve ${id}`, deps(client))
    const saved = localStorage.getItem(FUNDS_STORAGE_KEY) ?? ''
    for (const text of [reply ?? '', saved]) {
      expect(text).not.toContain('SECRET-KEY-ID')
      expect(text).not.toContain('PRIVATE KEY')
      expect(text).not.toContain(PEM.slice(30, 60))
    }
  })

  it('without credentials the approve is a named refusal, proposal untouched', async () => {
    const id = seedProposal()
    const reply = await runFundsCommandWithExecution(`/funds approve ${id}`, { creds: null, now: () => NOW, relayUrl: '' })
    expect(reply).toContain('no Kalshi API key in this browser')
    expect(loadFunds().positions.find(p => p.id === id)!.status).toBe('proposed')
  })
})

describe('relay transport fallback', () => {
  it('a transport failure goes through the relay; an HTTP answer never does', async () => {
    const realFetch = globalThis.fetch
    const calls: string[] = []
    globalThis.fetch = (async (url: string) => {
      calls.push(String(url))
      if (!calls.some(c => c.includes('/v1/kalshi')) && String(url).includes('kalshi')) throw new TypeError('Failed to fetch')
      return new Response(JSON.stringify({ status: 201, body: '{"ok":true}' }), { status: 200 })
    }) as typeof fetch
    try {
      const fetcher = directThenRelayFetcher('https://relay.example')
      const res = await fetcher('https://external-api.demo.kalshi.co/trade-api/v2/portfolio/events/orders', { method: 'POST', headers: {} })
      expect(res.status).toBe(201)
      expect(await res.text()).toBe('{"ok":true}')
      expect(calls).toHaveLength(2)
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('with no relay configured, a transport failure propagates as-is', async () => {
    const fetcher = directThenRelayFetcher('')
    const original = globalThis.fetch
    globalThis.fetch = (async () => { throw new TypeError('Failed to fetch') }) as typeof fetch
    try {
      await expect(fetcher('https://external-api.demo.kalshi.co/trade-api/v2/portfolio/balance', { method: 'GET', headers: {} })).rejects.toThrow('Failed to fetch')
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('auto-settle (item 9)', () => {
  function seedPlaced(): string {
    const id = seedProposal()
    let state = applyFundsCommand(loadFunds(), { kind: 'approve', id }, NOW).state
    state = applyFundsCommand(state, { kind: 'placed', id, fillPrice: 0.42 }, NOW).state
    saveFunds(state)
    return id
  }

  it('settles a placed position from Kalshi’s settlement, with the real pnl', async () => {
    const id = seedPlaced()
    const placed = loadFunds().positions.find(p => p.id === id)!
    const { client } = fakeClient({
      settlements: [{
        ticker: 'KX-TEST', marketResult: 'yes', yesCount: placed.contracts, noCount: 0,
        yesTotalCostDollars: placed.contracts * 0.42, noTotalCostDollars: 0,
        revenueCents: placed.contracts * 100, feeCostDollars: 0.5, settledTime: '2026-10-24T00:00:00Z',
      }],
    })
    const notices = await autoSettleKalshiPositions({ creds, client, now: () => NOW, relayUrl: '' })
    expect(notices).toEqual([{ id, market: 'KX-TEST', outcome: 'won', pnl: Math.round((placed.contracts - placed.contracts * 0.42 - 0.5) * 100) / 100 }])
    const settled = loadFunds().positions.find(p => p.id === id)!
    expect(settled.status).toBe('settled')
    expect(settled.settledBy).toBe('kalshi')
  })

  it('skips count mismatches (a manual trade on the same ticker is not absorbed)', async () => {
    const id = seedPlaced()
    const { client } = fakeClient({
      settlements: [{
        ticker: 'KX-TEST', marketResult: 'yes', yesCount: 999, noCount: 0,
        yesTotalCostDollars: 400, noTotalCostDollars: 0, revenueCents: 99900, feeCostDollars: 1, settledTime: '2026-10-24T00:00:00Z',
      }],
    })
    const notices = await autoSettleKalshiPositions({ creds, client, now: () => NOW, relayUrl: '' })
    expect(notices).toEqual([])
    expect(loadFunds().positions.find(p => p.id === id)!.status).toBe('placed')
  })

  it('skips scalar results and settlements older than the placement', async () => {
    const id = seedPlaced()
    const placed = loadFunds().positions.find(p => p.id === id)!
    const { client } = fakeClient({
      settlements: [{
        ticker: 'KX-TEST', marketResult: 'scalar', yesCount: placed.contracts, noCount: 0,
        yesTotalCostDollars: 1, noTotalCostDollars: 0, revenueCents: 100, feeCostDollars: 0, settledTime: '2026-10-24T00:00:00Z',
      }],
    })
    expect(await autoSettleKalshiPositions({ creds, client, now: () => NOW, relayUrl: '' })).toEqual([])
  })
})
