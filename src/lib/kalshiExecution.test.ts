// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

// @vitest-environment jsdom
import { generateKeyPairSync, webcrypto } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { KALSHI_KEY_ID_STORAGE, KALSHI_PRIVATE_KEY_STORAGE, type KalshiCredentials } from './kalshiAuth'
import { FUNDS_STORAGE_KEY, applyFundsCommand, emptyFunds, loadFunds, parseFundsCommand, proposePosition, recordKalshiFill, runFundsCommand, saveFunds } from './fundsLedger'
import { saveOwnerScaffold } from './ownerScaffold'
import { autoApproveHoldNote, autoSettleKalshiPositions, directThenRelayFetcher, maybeAutoApprove, runFundsCommandWithExecution, type KalshiFailureNote, type KalshiPlacedInfo } from './kalshiExecution'
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

type FakeExisting = { fillCount: number; averageFillPrice?: number; totalFees?: number; orderId?: string; status?: string }

interface FakeBehavior {
  quote?: { yesAsk: number | null; noAsk: number | null } | null
  quoteStatus?: string
  onQuote?: () => void
  quoteByTicker?: Record<string, { yesAsk: number | null; noAsk: number | null } | null>
  balanceDollars?: number
  /** The market's exchange shard, as the quote reports it (default 0). */
  exchangeIndex?: number
  /** Per-shard balances for the shard read; a missing index falls back to balanceDollars. */
  balanceByShard?: Record<number, number>
  /** Makes the shard read (getBalance with an index) fail instead of answering. */
  shardReadError?: 'network' | 'api'
  onCreate?: (call: number, input: { clientOrderId: string; count: number }) => KalshiOrderResult | Promise<KalshiOrderResult>
  existing?: FakeExisting | null
  onFind?: (call: number) => FakeExisting | null
  lookupUnknown?: boolean
  settlements?: Array<Record<string, unknown>>
}

function fakeClient(behavior: FakeBehavior): { client: KalshiClient; createCalls: Array<{ side: string; priceDollars: number; clientOrderId: string }>; findCalls: string[]; balanceReads: Array<number | undefined> } {
  const createCalls: Array<{ side: string; priceDollars: number; clientOrderId: string }> = []
  const findCalls: string[] = []
  const balanceReads: Array<number | undefined> = []
  const client: KalshiClient = {
    async getBalance(exchangeIndex?: number) {
      balanceReads.push(exchangeIndex)
      if (exchangeIndex !== undefined) {
        if (behavior.shardReadError === 'network') throw new KalshiNetworkError('No answer from Kalshi for the shard balance read')
        if (behavior.shardReadError === 'api') throw new KalshiApiError(503, 'unavailable', 'Shard balance unavailable.')
        const dollars = behavior.balanceByShard?.[exchangeIndex] ?? behavior.balanceDollars ?? 500
        return { balanceCents: Math.round(dollars * 100), balanceDollars: dollars, portfolioValueCents: 0 }
      }
      return { balanceCents: Math.round((behavior.balanceDollars ?? 500) * 100), balanceDollars: behavior.balanceDollars ?? 500, portfolioValueCents: 0 }
    },
    async getMarketQuote(ticker: string) {
      behavior.onQuote?.()
      const base = behavior.quoteByTicker && ticker in behavior.quoteByTicker
        ? behavior.quoteByTicker[ticker]
        : behavior.quote === undefined ? { yesAsk: 0.42, noAsk: 0.44 } : behavior.quote
      if (!base) return null
      return { ...base, exchangeIndex: behavior.exchangeIndex ?? 0, ...(behavior.quoteStatus ? { status: behavior.quoteStatus } : {}) }
    },
    async createOrder(input) {
      createCalls.push({ side: input.side, priceDollars: input.priceDollars, clientOrderId: input.clientOrderId })
      if (behavior.onCreate) return behavior.onCreate(createCalls.length, input)
      return { orderId: 'ord-1', clientOrderId: input.clientOrderId, fillCount: input.count, remainingCount: 0, averageFillPrice: 0.42, averageFeePaid: 0.0171 }
    },
    async findOrderByClientOrderId(clientOrderId) {
      findCalls.push(clientOrderId)
      if (behavior.lookupUnknown) return { kind: 'unknown', reason: 'the fake lookup could not complete' }
      const found = behavior.onFind ? behavior.onFind(findCalls.length) : behavior.existing
      if (!found) return { kind: 'not_found' }
      return {
        kind: 'found',
        order: {
          orderId: found.orderId ?? 'ord-found', clientOrderId, status: found.status ?? 'executed',
          fillCount: found.fillCount, remainingCount: 0,
          ...(found.averageFillPrice !== undefined ? { averageFillPrice: found.averageFillPrice } : {}),
          ...(found.totalFees !== undefined ? { totalFees: found.totalFees } : {}),
        },
      }
    },
    async getSettlements() {
      return (behavior.settlements ?? []) as never
    },
  }
  return { client, createCalls, findCalls, balanceReads }
}

const deps = (client: KalshiClient) => ({ creds, client, now: () => NOW, relayUrl: '', delay: async () => {} })

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
    expect(reply).toContain('Nothing was spent')
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
    expect(reply).toContain('after fees there is no edge')
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

describe('shard gate (Kalshi partitions the balance by exchange shard)', () => {
  it('refuses with 0 POSTs when the market’s shard is empty even though the aggregate covers the order', async () => {
    const id = seedProposal()
    const failures: KalshiFailureNote[] = []
    const { client, createCalls, balanceReads } = fakeClient({ exchangeIndex: 3, balanceDollars: 100, balanceByShard: { 3: 0 } })
    const reply = await runFundsCommandWithExecution(`/funds approve ${id}`, {
      creds, client, now: () => NOW, relayUrl: '', delay: async () => {}, runId: 'run-shard', onFailure: n => failures.push(n),
    })
    expect(reply).toContain('trades on shard 3, which holds $0.00')
    expect(reply).toContain('across all shards is $100.00')
    expect(reply).toContain('ForgeClaw never moves funds between shards automatically')
    expect(reply).toContain('Nothing was spent')
    expect(createCalls).toHaveLength(0)
    expect(balanceReads).toEqual([undefined, 3])
    expect(loadFunds().positions.find(p => p.id === id)!.status).toBe('proposed')
    const note = failures.find(f => f.stage === 'balance')
    expect(note).toBeTruthy()
    expect(note!.runId).toBe('run-shard')
    expect(note!.positionId).toBe(id)
  })

  it('places when the market’s shard covers stake + fees', async () => {
    const id = seedProposal()
    const { client, createCalls, balanceReads } = fakeClient({ exchangeIndex: 3, balanceDollars: 100, balanceByShard: { 3: 90 } })
    const reply = await runFundsCommandWithExecution(`/funds approve ${id}`, deps(client))
    expect(reply).toContain(`Placed ${id}`)
    expect(createCalls).toHaveLength(1)
    expect(balanceReads).toEqual([undefined, 3])
  })

  it('a shard read that gets no answer blocks the order: unverified is never funded', async () => {
    const id = seedProposal()
    const { client, createCalls } = fakeClient({ exchangeIndex: 3, balanceDollars: 100, shardReadError: 'network' })
    const reply = await runFundsCommandWithExecution(`/funds approve ${id}`, deps(client))
    expect(reply).toContain('could not reach Kalshi to verify your balance on shard 3')
    expect(reply).toContain('never treated as funded')
    expect(createCalls).toHaveLength(0)
    expect(loadFunds().positions.find(p => p.id === id)!.status).toBe('proposed')
  })

  it('a shard read Kalshi refuses blocks the order and names the unverified shard', async () => {
    const id = seedProposal()
    const { client, createCalls } = fakeClient({ exchangeIndex: 3, balanceDollars: 100, shardReadError: 'api' })
    const reply = await runFundsCommandWithExecution(`/funds approve ${id}`, deps(client))
    expect(reply).toContain('refused the balance check for shard 3')
    expect(reply).toContain('could not be verified')
    expect(createCalls).toHaveLength(0)
    expect(loadFunds().positions.find(p => p.id === id)!.status).toBe('proposed')
  })

  it('a market whose record has no exchange_index is checked against shard 0 — the aggregate does not substitute', async () => {
    const id = seedProposal()
    const { client, createCalls, balanceReads } = fakeClient({ balanceDollars: 500, balanceByShard: { 0: 0 } })
    const reply = await runFundsCommandWithExecution(`/funds approve ${id}`, deps(client))
    expect(reply).toContain('trades on shard 0, which holds $0.00')
    expect(reply).toContain('across all shards is $500.00')
    expect(balanceReads).toEqual([undefined, 0])
    expect(createCalls).toHaveLength(0)
    expect(loadFunds().positions.find(p => p.id === id)!.status).toBe('proposed')
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

  it('a dropped response with a completed miss is NOT resent: Unknown, exactly one POST, approval stands', async () => {
    const id = seedProposal()
    const { client, createCalls } = fakeClient({
      onCreate: () => { throw new KalshiNetworkError('socket closed') },
      existing: null,
    })
    const reply = await runFundsCommandWithExecution(`/funds approve ${id}`, deps(client))
    expect(reply).toContain('Unknown:')
    expect(reply).not.toContain('nothing was spent')
    expect(createCalls).toHaveLength(1)
    const p = loadFunds().positions.find(x => x.id === id)!
    expect(p.status).toBe('approved')
    expect(p.clientOrderId).toBe(`fc-${id}-1`)
  })

  it('a dropped response with a FAILED lookup is Unknown too — a failed lookup never feeds a send', async () => {
    const id = seedProposal()
    const { client, createCalls, findCalls } = fakeClient({
      onCreate: () => { throw new KalshiNetworkError('socket closed') },
      lookupUnknown: true,
    })
    const reply = await runFundsCommandWithExecution(`/funds approve ${id}`, deps(client))
    expect(reply).toContain('Unknown:')
    expect(reply).not.toContain('nothing was spent')
    expect(createCalls).toHaveLength(1)
    expect(findCalls.length).toBeGreaterThan(0)
    expect(loadFunds().positions.find(p => p.id === id)!.status).toBe('approved')
  })

  it('a dropped response whose lookup FINDS the order with 0 fills: "nothing was spent" from Kalshi’s own record', async () => {
    const id = seedProposal()
    const { client, createCalls } = fakeClient({
      onCreate: () => { throw new KalshiNetworkError('socket closed') },
      existing: { fillCount: 0, orderId: 'ord-empty', status: 'canceled' },
    })
    const reply = await runFundsCommandWithExecution(`/funds approve ${id}`, deps(client))
    expect(reply).toContain('did reach Kalshi (order ord-empty, status canceled) and filled nothing')
    expect(reply).toContain('Nothing was spent')
    expect(createCalls).toHaveLength(1)
    expect(loadFunds().positions.find(p => p.id === id)!.status).toBe('proposed')
  })

  it('a timed-out POST (no answer at all) ends at Unknown after reconcile — never resent, never a refusal', async () => {
    const id = seedProposal()
    const { client, createCalls } = fakeClient({
      onCreate: () => { throw new KalshiNetworkError('No answer from Kalshi for POST /trade-api/v2/portfolio/events/orders: request timed out after 30000ms') },
      existing: null,
    })
    const reply = await runFundsCommandWithExecution(`/funds approve ${id}`, deps(client))
    expect(reply).toContain('Unknown:')
    expect(reply).not.toContain('nothing was spent')
    expect(createCalls).toHaveLength(1)
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

describe('the no-credentials refusal names the missing half', () => {
  it('only the key ID saved: the refusal names the private key as the missing half', async () => {
    localStorage.setItem(KALSHI_KEY_ID_STORAGE, 'the-id')
    const id = seedProposal()
    const reply = await runFundsCommandWithExecution(`/funds approve ${id}`, { creds: null, now: () => NOW, relayUrl: '' })
    expect(reply).toContain('no Kalshi private key saved in this browser (key ID is saved)')
    expect(reply).toContain('Add your private key in Settings (the Kalshi section where the Brave key used to be)')
    expect(reply).toContain('The proposal is unchanged.')
    expect(loadFunds().positions.find(p => p.id === id)!.status).toBe('proposed')
  })

  it('only the private key saved: the refusal names the key ID as the missing half', async () => {
    localStorage.setItem(KALSHI_PRIVATE_KEY_STORAGE, PEM)
    const id = seedProposal()
    const reply = await runFundsCommandWithExecution(`/funds approve ${id}`, { creds: null, now: () => NOW, relayUrl: '' })
    expect(reply).toContain('no Kalshi key ID saved in this browser (private key is saved)')
    expect(reply).toContain('Add your key ID in Settings (the Kalshi section where the Brave key used to be)')
    expect(reply).toContain('The proposal is unchanged.')
    expect(loadFunds().positions.find(p => p.id === id)!.status).toBe('proposed')
  })

  it('neither half saved: the refusal keeps the pair wording', async () => {
    const id = seedProposal()
    const reply = await runFundsCommandWithExecution(`/funds approve ${id}`, { creds: null, now: () => NOW, relayUrl: '' })
    expect(reply).toContain('Not placed: no Kalshi API key in this browser. Add your key ID and private key in Settings (the Kalshi section where the Brave key used to be) — a demo key first. The proposal is unchanged.')
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

describe('review round: idempotency, reconcile, concurrency (PR #240 gate)', () => {
  it('a lost response reconciles by delayed lookup: first look misses, second finds the fill — placed, exactly 1 POST, never "nothing was spent"', async () => {
    const id = seedProposal()
    const { client, createCalls } = fakeClient({
      onCreate: () => { throw new KalshiNetworkError('response lost') },
      onFind: call => (call >= 2 ? { fillCount: 10, averageFillPrice: 0.42, totalFees: 0.17, orderId: 'ord-real' } : null),
    })
    const reply = await runFundsCommandWithExecution(`/funds approve ${id}`, deps(client))
    expect(createCalls).toHaveLength(1)
    expect(createCalls[0].clientOrderId).toBe(`fc-${id}-1`)
    expect(reply).toContain('Placed')
    expect(reply).not.toContain('Nothing was spent')
    expect(reply).not.toContain('nothing was spent')
    const p = loadFunds().positions.find(x => x.id === id)!
    expect(p.status).toBe('placed')
    expect(p.kalshiOrderId).toBe('ord-real')
    expect(p.contracts).toBe(10)
  })

  it('ALREADY_EXISTS with only completed misses ends at Unknown — a 409 is reconciled, never read as a refusal', async () => {
    const id = seedProposal()
    const { client, createCalls } = fakeClient({
      onCreate: () => { throw new KalshiApiError(409, 'already_exists', 'Order with this client_order_id already exists.') },
      existing: null,
    })
    const reply = await runFundsCommandWithExecution(`/funds approve ${id}`, deps(client))
    expect(createCalls).toHaveLength(1)
    expect(reply).toContain('Unknown:')
    expect(reply).not.toContain('nothing was spent')
    expect(loadFunds().positions.find(x => x.id === id)!.status).toBe('approved')
  })

  it('a 408 on the POST is a timeout, not a refusal: it reconciles to Unknown, never a revert', async () => {
    const id = seedProposal()
    const { client, createCalls } = fakeClient({
      onCreate: () => { throw new KalshiApiError(408, 'request_timeout', 'Request timed out.') },
      existing: null,
    })
    const reply = await runFundsCommandWithExecution(`/funds approve ${id}`, deps(client))
    expect(createCalls).toHaveLength(1)
    expect(reply).toContain('Unknown:')
    expect(reply).not.toContain('nothing was spent')
    expect(loadFunds().positions.find(x => x.id === id)!.status).toBe('approved')
  })

  it('a 429 on the POST is an answered gate refusal: not placed, no lookups, proposal back to proposed', async () => {
    const id = seedProposal()
    const { client, createCalls, findCalls } = fakeClient({
      onCreate: () => { throw new KalshiApiError(429, 'rate_limited', 'Too many requests.') },
    })
    const reply = await runFundsCommandWithExecution(`/funds approve ${id}`, deps(client))
    expect(reply).toContain('rate-limited')
    expect(reply).toContain('nothing was spent')
    expect(createCalls).toHaveLength(1)
    expect(findCalls).toHaveLength(0)
    expect(loadFunds().positions.find(x => x.id === id)!.status).toBe('proposed')
  })

  it('a resumed approval whose lookup cannot complete sends NOTHING — the stored key is not resent blind', async () => {
    const id = seedProposal()
    const first = fakeClient({ onCreate: () => { throw new KalshiNetworkError('socket closed') }, existing: null })
    await runFundsCommandWithExecution(`/funds approve ${id}`, deps(first.client))
    expect(loadFunds().positions.find(x => x.id === id)!.status).toBe('approved')
    const second = fakeClient({ lookupUnknown: true })
    const reply = await runFundsCommandWithExecution(`/funds approve ${id}`, deps(second.client))
    expect(reply).toContain('Unknown:')
    expect(reply).toContain('NOT resent')
    expect(second.createCalls).toHaveLength(0)
    expect(loadFunds().positions.find(x => x.id === id)!.status).toBe('approved')
  })

  it('resumed approve with a complete lookup miss ends at Unknown and sends nothing', async () => {
    const id = seedProposal()
    const first = fakeClient({ onCreate: () => { throw new KalshiNetworkError('socket closed') }, existing: null })
    const reply1 = await runFundsCommandWithExecution(`/funds approve ${id}`, deps(first.client))
    expect(first.createCalls).toHaveLength(1)
    expect(reply1).toContain('Unknown:')
    const standing = loadFunds().positions.find(x => x.id === id)!
    expect(standing.status).toBe('approved')
    expect(standing.clientOrderId).toBe(`fc-${id}-1`)
    // The re-approve is a resume: its lookup completes with a miss (NOT_FOUND). A resumed
    // approve never sends — a miss cannot prove the first order never landed while
    // V2-order visibility in the lookup is unproven — so it ends at Unknown, 0 POSTs.
    const second = fakeClient({})
    const reply2 = await runFundsCommandWithExecution(`/funds approve ${id}`, deps(second.client))
    expect(reply2).toContain('Unknown:')
    expect(reply2).toContain('found no order under the kept key')
    expect(reply2).toContain('cannot prove the first order never landed')
    expect(second.findCalls.length).toBeGreaterThan(0)
    expect(second.createCalls).toHaveLength(0)
    const after = loadFunds().positions.find(x => x.id === id)!
    expect(after.status).toBe('approved')
    expect(after.clientOrderId).toBe(`fc-${id}-1`)
  })

  it('a confirmed zero fill consumes the attempt: the next approve mints attempt 2', async () => {
    const id = seedProposal()
    const zero = fakeClient({
      onCreate: (_call, input) => ({ orderId: 'ord-zero', clientOrderId: input.clientOrderId, fillCount: 0, remainingCount: 99 }),
    })
    const reply1 = await runFundsCommandWithExecution(`/funds approve ${id}`, deps(zero.client))
    expect(reply1).toContain('filled 0 contracts')
    expect(zero.createCalls[0].clientOrderId).toBe(`fc-${id}-1`)
    expect(loadFunds().positions.find(x => x.id === id)!.status).toBe('proposed')
    const ok = fakeClient({})
    await runFundsCommandWithExecution(`/funds approve ${id}`, deps(ok.client))
    expect(ok.createCalls[0].clientOrderId).toBe(`fc-${id}-2`)
    expect(loadFunds().positions.find(x => x.id === id)!.status).toBe('placed')
  })

  it('a 409 on the FIRST post (a resumed key whose order landed) reconciles instead of reverting', async () => {
    const id = seedProposal()
    const { client, createCalls } = fakeClient({
      onCreate: () => { throw new KalshiApiError(409, 'already_exists', 'Order with this client_order_id already exists.') },
      existing: { fillCount: 5, averageFillPrice: 0.42, totalFees: 0.09, orderId: 'ord-dup' },
    })
    const reply = await runFundsCommandWithExecution(`/funds approve ${id}`, deps(client))
    expect(createCalls).toHaveLength(1)
    expect(reply).toContain('Placed')
    expect(loadFunds().positions.find(x => x.id === id)!.status).toBe('placed')
  })

  it('a 5xx on the POST is ambiguous: it reconciles to Unknown, never a revert', async () => {
    const id = seedProposal()
    const { client } = fakeClient({
      onCreate: () => { throw new KalshiApiError(500, 'internal', 'Internal error.') },
      existing: null,
    })
    const reply = await runFundsCommandWithExecution(`/funds approve ${id}`, deps(client))
    expect(reply).toContain('Unknown:')
    expect(loadFunds().positions.find(x => x.id === id)!.status).toBe('approved')
  })

  it('two approves at once: exactly one order is sent, the second is told it is already being placed', async () => {
    const id = seedProposal()
    const { client, createCalls } = fakeClient({
      onCreate: async (_call, input) => {
        await new Promise(r => setTimeout(r, 25))
        return { orderId: 'ord-1', clientOrderId: input.clientOrderId, fillCount: input.count, remainingCount: 0, averageFillPrice: 0.42, averageFeePaid: 0.0171 }
      },
    })
    const [r1, r2] = await Promise.all([
      runFundsCommandWithExecution(`/funds approve ${id}`, deps(client)),
      runFundsCommandWithExecution(`/funds approve ${id}`, deps(client)),
    ])
    expect(createCalls).toHaveLength(1)
    expect([r1, r2].filter(r => r?.includes('already being placed'))).toHaveLength(1)
    expect([r1, r2].filter(r => r?.startsWith('Placed'))).toHaveLength(1)
  })

  it('two tabs: if the position was placed while the price was checked, the approval write refuses', async () => {
    const id = seedProposal()
    const { client, createCalls } = fakeClient({
      onQuote: () => {
        // Another tab approves and places the same position mid-flight.
        let s = loadFunds()
        s = applyFundsCommand(s, { kind: 'approve', id }, NOW).state
        s = recordKalshiFill(s, id, { fillCount: 3, avgFillPrice: 0.42, feePaid: 0.05, orderId: 'ord-other-tab', clientOrderId: 'fc-other' }, NOW)
        saveFunds(s)
      },
    })
    const reply = await runFundsCommandWithExecution(`/funds approve ${id}`, deps(client))
    expect(reply).toContain('was already placed')
    expect(createCalls).toHaveLength(0)
  })

  it('refuses a market that is not active, naming its status', async () => {
    const id = seedProposal()
    const { client, createCalls } = fakeClient({ quoteStatus: 'closed' })
    const reply = await runFundsCommandWithExecution(`/funds approve ${id}`, deps(client))
    expect(reply).toContain('closed')
    expect(reply).toContain('not active')
    expect(createCalls).toHaveLength(0)
  })

  it('the edge must survive the fee at the live price', async () => {
    const id = seedProposal('yes', 0.53, 0.55)
    const { client, createCalls } = fakeClient({ quote: { yesAsk: 0.54, noAsk: 0.56 } })
    const reply = await runFundsCommandWithExecution(`/funds approve ${id}`, deps(client))
    expect(reply).toContain('after fees there is no edge')
    expect(createCalls).toHaveLength(0)
  })

  it('visitor mode refuses placement and auto-settle', async () => {
    const id = seedProposal()
    const { client, createCalls } = fakeClient({ settlements: [{ ticker: 'KX-TEST', market_result: 'yes' }] })
    const reply = await runFundsCommandWithExecution(`/funds approve ${id}`, { ...deps(client), visitor: true })
    expect(reply).toContain('visitor mode')
    expect(createCalls).toHaveLength(0)
    await expect(autoSettleKalshiPositions({ creds, client, visitor: true })).resolves.toEqual([])
  })

  it('failures report with context; placements report once, with the run id on the position', async () => {
    const notes: KalshiFailureNote[] = []
    const placed: KalshiPlacedInfo[] = []
    const wire = (client: KalshiClient) => ({
      ...deps(client), runId: 'run-123',
      onFailure: (n: KalshiFailureNote) => { notes.push(n) },
      onPlaced: (i: KalshiPlacedInfo) => { placed.push(i) },
    })
    const idA = seedProposal()
    const refusing = fakeClient({ onCreate: () => { throw new KalshiApiError(400, 'bad_request', 'Nope.') } })
    await runFundsCommandWithExecution(`/funds approve ${idA}`, wire(refusing.client))
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ stage: 'place', httpStatus: 400, positionId: idA, ticker: 'KX-TEST', clientOrderId: `fc-${idA}-1`, runId: 'run-123' })
    const idB = seedProposal()
    const ok = fakeClient({})
    await runFundsCommandWithExecution(`/funds approve ${idB}`, wire(ok.client))
    expect(placed).toHaveLength(1)
    expect(placed[0]).toMatchObject({ positionId: idB, clientOrderId: `fc-${idB}-1`, runId: 'run-123' })
    expect(loadFunds().positions.find(x => x.id === idB)!.runId).toBe('run-123')
  })
})

function seedMore(market: string, venue = 'kalshi'): string {
  const proposed = proposePosition(loadFunds(), {
    venue, market, side: 'yes', price: 0.4, probability: 0.55,
    rationale: 'NWS forecast gives 60% rain for the window and three models agree; market lags the update.',
    sources: ['https://weather.gov/forecast'],
  }, NOW)
  saveFunds(proposed.state)
  return proposed.position.id
}

const setAutoApprove = (dollars: number) =>
  saveFunds(applyFundsCommand(loadFunds(), { kind: 'limits', changes: { autoApproveUnder: dollars } }, NOW).state)

describe('approve-all (item 10)', () => {
  // Mirrors App.tsx's fundsOk predicate (App.tsx:1571): a funds reply is BLOCKED
  // when it starts with 'Not done:', 'Not placed:' or 'Unknown:'. The approve-all
  // lead is chosen so that predicate does the right thing — keep in sync.
  const fundsBlocked = (reply: string | null): boolean => reply !== null &&
    (reply.startsWith('Not done:') || reply.startsWith('Not placed:') || reply.startsWith('Unknown:'))
  const fundsOk = (reply: string | null) => !fundsBlocked(reply)

  it('places every waiting proposal, one order each, in order', async () => {
    const a = seedProposal()
    const b = seedMore('KX-TEST-2')
    const { client, createCalls } = fakeClient({})
    const reply = await runFundsCommandWithExecution('/funds approve-all', deps(client))
    expect(reply).toContain('Approve-all: 2 placed, 0 refused, 0 unknown of 2 proposals.')
    expect(reply).toContain(`Placed ${a}`)
    expect(reply).toContain(`Placed ${b}`)
    expect(createCalls).toHaveLength(2)
    expect(createCalls[0].clientOrderId).toContain(a)
    expect(createCalls[1].clientOrderId).toContain(b)
    const positions = loadFunds().positions
    expect(positions.find(p => p.id === a)!.status).toBe('placed')
    expect(positions.find(p => p.id === b)!.status).toBe('placed')
  })

  it('a refused proposal (edge gone) does not stop the rest', async () => {
    const gone = seedProposal()
    const ok = seedMore('KX-TEST-2')
    const { client, createCalls } = fakeClient({ quoteByTicker: { 'KX-TEST': { yesAsk: 0.56, noAsk: 0.58 } } })
    const reply = await runFundsCommandWithExecution('/funds approve-all', deps(client))
    expect(reply).toContain('Approve-all: 1 placed, 1 refused, 0 unknown of 2 proposals.')
    expect(reply).toContain('after fees there is no edge')
    expect(createCalls).toHaveLength(1)
    const positions = loadFunds().positions
    expect(positions.find(p => p.id === gone)!.status).toBe('proposed')
    expect(positions.find(p => p.id === ok)!.status).toBe('placed')
  })

  it('a Kalshi refusal on one order does not stop the rest', async () => {
    const refused = seedProposal()
    const ok = seedMore('KX-TEST-2')
    const { client } = fakeClient({
      onCreate: (n, input) => {
        if (n === 1) throw new KalshiApiError(400, 'insufficient_balance', 'Insufficient balance.')
        return { orderId: 'ord-2', clientOrderId: input.clientOrderId, fillCount: 10, remainingCount: 0, averageFillPrice: 0.42, averageFeePaid: 0.0171 }
      },
    })
    const reply = await runFundsCommandWithExecution('/funds approve-all', deps(client))
    expect(reply).toContain('Approve-all: 1 placed, 1 refused, 0 unknown of 2 proposals.')
    const positions = loadFunds().positions
    expect(positions.find(p => p.id === refused)!.status).toBe('proposed')
    expect(positions.find(p => p.id === ok)!.status).toBe('placed')
  })

  it('an unknown outcome is reported as unknown and the batch continues', async () => {
    const lost = seedProposal()
    const ok = seedMore('KX-TEST-2')
    const { client, createCalls } = fakeClient({
      onCreate: (n, input) => {
        if (n === 1) throw new KalshiNetworkError('socket closed')
        return { orderId: 'ord-3', clientOrderId: input.clientOrderId, fillCount: 10, remainingCount: 0, averageFillPrice: 0.42, averageFeePaid: 0.0171 }
      },
      existing: null,
    })
    const reply = await runFundsCommandWithExecution('/funds approve-all', deps(client))
    // The batch lead is the app's completion signal: an Unknown in the batch leads
    // with 'Unknown:' so the app marks the whole reply BLOCKED and the owner's
    // Unknown rule fires (the batch must never read complete).
    expect(reply?.startsWith('Unknown: 1 placed, 0 refused, 1 unknown of 2 proposals.')).toBe(true)
    expect(reply).toContain('Unknown:')
    expect(createCalls).toHaveLength(2) // the lost position's one attempt (a lost response reconciles by lookup, never a resend), then the next position's one
    const positions = loadFunds().positions
    expect(positions.find(p => p.id === lost)!.status).toBe('approved')
    expect(positions.find(p => p.id === ok)!.status).toBe('placed')
  })

  it('the batch lead is the app completion signal: Unknown: marks it blocked', async () => {
    // Unknown in the batch -> 'Unknown:' lead -> app marks it blocked, so the
    // owner's Unknown rule fires and the batch never reads complete.
    seedProposal()
    seedMore('KX-TEST-2')
    const { client } = fakeClient({
      onCreate: (n, input) => {
        if (n === 1) throw new KalshiNetworkError('socket closed')
        return { orderId: 'ord-u', clientOrderId: input.clientOrderId, fillCount: 10, remainingCount: 0, averageFillPrice: 0.42, averageFeePaid: 0.0171 }
      },
      existing: null,
    })
    const reply = await runFundsCommandWithExecution('/funds approve-all', deps(client))
    expect(reply?.startsWith('Unknown:')).toBe(true)
    expect(fundsOk(reply)).toBe(false)
  })

  it('a clean all-placed batch still leads with Approve-all: and reads complete', async () => {
    const a = seedProposal()
    const b = seedMore('KX-TEST-2')
    const { client } = fakeClient({})
    const reply = await runFundsCommandWithExecution('/funds approve-all', deps(client))
    expect(reply?.startsWith('Approve-all: 2 placed, 0 refused, 0 unknown of 2 proposals.')).toBe(true)
    expect(fundsOk(reply)).toBe(true)
    expect(reply).toContain(`Placed ${a}`)
    expect(reply).toContain(`Placed ${b}`)
  })

  it('with nothing waiting it says so and sends nothing', async () => {
    const { client, createCalls } = fakeClient({})
    const reply = await runFundsCommandWithExecution('/funds approve-all', deps(client))
    expect(reply).toBe('Approve-all: no proposals are waiting.')
    expect(createCalls).toHaveLength(0)
  })

  it('without credentials (a visitor browser holds none) every position is refused by name', async () => {
    const a = seedProposal()
    const b = seedMore('KX-TEST-2')
    const reply = await runFundsCommandWithExecution('/funds approve-all', { creds: null, now: () => NOW, relayUrl: '' })
    // Nothing placed and everything refused: the batch leads with 'Not placed:'
    // so the app marks it BLOCKED instead of complete.
    expect(reply?.startsWith('Not placed: 0 placed, 2 refused, 0 unknown of 2 proposals.')).toBe(true)
    expect(fundsOk(reply)).toBe(false)
    expect(reply).toContain('no Kalshi API key in this browser')
    const positions = loadFunds().positions
    expect(positions.find(p => p.id === a)!.status).toBe('proposed')
    expect(positions.find(p => p.id === b)!.status).toBe('proposed')
  })

  it('two same-market proposals in one pass produce exactly one order', async () => {
    const a = seedProposal()
    const b = seedMore('KX-TEST') // the same market as a: a second order would stack
    const { client, createCalls } = fakeClient({})
    const reply = await runFundsCommandWithExecution('/funds approve-all', deps(client))
    expect(reply).toContain('Approve-all: 1 placed, 1 refused, 0 unknown of 2 proposals.')
    expect(createCalls).toHaveLength(1)
    expect(createCalls[0].clientOrderId).toContain(a)
    expect(loadFunds().positions.find(p => p.id === a)!.status).toBe('placed')
    expect(loadFunds().positions.find(p => p.id === b)!.status).toBe('proposed')
    // The skip is named: which position, which market, and the one-order rule.
    expect(reply).toContain(`Not placed: ${b}`)
    expect(reply).toContain(`another position (${a})`)
    expect(reply).toContain('already placed')
    expect(reply).toContain('one order per market per pass')
  })

  it('a merely-proposed sibling does not block the first same-market proposal of a pass', async () => {
    // The first processed proposal must take its turn; only a committed order blocks.
    // Here the first order is refused by Kalshi (a POST, but no order lands), so the
    // second proposal may still place — the guard is about exposure, not attempts.
    const a = seedProposal()
    const b = seedMore('KX-TEST')
    const { client, createCalls } = fakeClient({ onCreate: (n, input) => {
      if (n === 1) throw new KalshiApiError(400, 'insufficient_balance', 'Insufficient balance.')
      return { orderId: 'ord-2', clientOrderId: input.clientOrderId, fillCount: 10, remainingCount: 0, averageFillPrice: 0.42, averageFeePaid: 0.0171 }
    } })
    const reply = await runFundsCommandWithExecution('/funds approve-all', deps(client))
    expect(reply).toContain('Approve-all: 1 placed, 1 refused, 0 unknown of 2 proposals.')
    expect(createCalls).toHaveLength(2) // the refused POST, then the one live order
    expect(reply).not.toContain('one order per market per pass')
    expect(loadFunds().positions.find(p => p.id === a)!.status).toBe('proposed') // refused: nothing committed
    expect(loadFunds().positions.find(p => p.id === b)!.status).toBe('placed') // proposed sibling blocked nothing
  })
})

describe('auto-approve under a limit (item 10)', () => {
  it('default off: a proposal waits for the owner, untouched', async () => {
    const id = seedProposal()
    const position = loadFunds().positions.find(p => p.id === id)!
    const { client, createCalls } = fakeClient({})
    expect(await maybeAutoApprove(position, deps(client))).toBeNull()
    expect(createCalls).toHaveLength(0)
    expect(loadFunds().positions.find(p => p.id === id)!.status).toBe('proposed')
  })

  it('on: a proposal at the threshold is placed through the same approve path', async () => {
    const id = seedProposal()
    const position = loadFunds().positions.find(p => p.id === id)!
    setAutoApprove(position.stake) // exactly at the stake: at-or-under must fire
    const { client, createCalls } = fakeClient({})
    const reply = await maybeAutoApprove(position, deps(client))
    expect(reply).toContain(`Placed ${id}`)
    expect(createCalls).toHaveLength(1)
    const placed = loadFunds().positions.find(p => p.id === id)!
    expect(placed.status).toBe('placed')
    expect(placed.kalshiOrderId).toBe('ord-1')
  })

  it('on: a proposal over the threshold stays proposed', async () => {
    const id = seedProposal()
    const position = loadFunds().positions.find(p => p.id === id)!
    setAutoApprove(position.stake - 0.01)
    const { client, createCalls } = fakeClient({})
    expect(await maybeAutoApprove(position, deps(client))).toBeNull()
    expect(createCalls).toHaveLength(0)
    expect(loadFunds().positions.find(p => p.id === id)!.status).toBe('proposed')
  })

  it('never fires for a non-Kalshi venue, however high the limit', async () => {
    seedProposal()
    const id = seedMore('Chiefs ML Sunday', 'sportsbook')
    setAutoApprove(100000)
    const position = loadFunds().positions.find(p => p.id === id)!
    const { client, createCalls } = fakeClient({})
    expect(await maybeAutoApprove(position, deps(client))).toBeNull()
    expect(createCalls).toHaveLength(0)
    expect(loadFunds().positions.find(p => p.id === id)!.status).toBe('proposed')
  })

  it('carries the run ID through to the position, the journal entry and failure telemetry', async () => {
    const id = seedProposal()
    const position = loadFunds().positions.find(p => p.id === id)!
    setAutoApprove(position.stake) // exactly at the stake: at-or-under must fire
    const { client, createCalls } = fakeClient({})
    const placed: KalshiPlacedInfo[] = []
    const failures: KalshiFailureNote[] = []
    const reply = await maybeAutoApprove(position, { ...deps(client), runId: 'run-auto-1', onPlaced: i => placed.push(i), onFailure: n => failures.push(n) })
    expect(reply).toContain(`Placed ${id}`)
    expect(createCalls).toHaveLength(1)
    expect(loadFunds().positions.find(p => p.id === id)!.runId).toBe('run-auto-1')
    expect(placed).toHaveLength(1)
    expect(placed[0]).toMatchObject({ positionId: id, orderId: 'ord-1', runId: 'run-auto-1' })
    expect(failures).toHaveLength(0)
  })

  it('a refusal on the auto path reaches onFailure carrying the run ID', async () => {
    const id = seedProposal()
    const position = loadFunds().positions.find(p => p.id === id)!
    setAutoApprove(position.stake)
    const { client, createCalls } = fakeClient({ balanceDollars: 0, balanceByShard: { 0: 0 } })
    const failures: KalshiFailureNote[] = []
    const reply = await maybeAutoApprove(position, { ...deps(client), runId: 'run-auto-2', onFailure: n => failures.push(n) })
    expect(reply).toContain('Not placed:')
    expect(createCalls).toHaveLength(0)
    const note = failures.find(f => f.stage === 'balance')
    expect(note).toBeTruthy()
    expect(note!.runId).toBe('run-auto-2')
    expect(note!.positionId).toBe(id)
    expect(loadFunds().positions.find(p => p.id === id)!.status).toBe('proposed')
  })

  it('a second same-market proposal under autoapprove is held for the owner, never a second order', async () => {
    const a = seedProposal()
    const posA = loadFunds().positions.find(p => p.id === a)!
    setAutoApprove(posA.stake)
    const { client, createCalls } = fakeClient({})
    expect(await maybeAutoApprove(posA, deps(client))).toContain(`Placed ${a}`)
    const b = seedMore('KX-TEST')
    const posB = loadFunds().positions.find(p => p.id === b)!
    expect(await maybeAutoApprove(posB, deps(client))).toBeNull()
    expect(createCalls).toHaveLength(1)
    expect(loadFunds().positions.find(p => p.id === b)!.status).toBe('proposed')
    // The hold is explained, not silent: the model is told not to re-propose.
    const hold = autoApproveHoldNote(posB)
    expect(hold).toContain(a)
    expect(hold).toContain('Do not re-propose')
    // A placed position was never auto-eligible: the hold note says nothing.
    const freshA = loadFunds().positions.find(p => p.id === a)!
    expect(freshA.status).toBe('placed')
    expect(autoApproveHoldNote(freshA)).toBeNull()
  })

  it('a merely-proposed sibling also holds the auto-approve (the market is unreviewed)', async () => {
    seedProposal()
    const b = seedMore('KX-TEST')
    const posB = loadFunds().positions.find(p => p.id === b)!
    setAutoApprove(posB.stake)
    const { client, createCalls } = fakeClient({})
    expect(await maybeAutoApprove(posB, deps(client))).toBeNull()
    expect(createCalls).toHaveLength(0)
    expect(autoApproveHoldNote(posB)).toContain('already proposed')
  })
})

describe('funds plan (PR B item 13)', () => {
  // A clearly synthetic stand-in framework, stored through the same Settings key the
  // real code reads. It is invented for this test and resembles no one's framework.
  const SYNTHETIC_SCAFFOLD = [
    '# Phase One: Survey',
    'Look at everything before touching anything.',
    '# Phase Two: Commit',
    'Act only on what the survey supports.',
  ].join('\n')

  it('parses as its own command, and the ledger alone refuses it — the app layer builds the plan', () => {
    expect(parseFundsCommand('/funds plan')).toEqual({ kind: 'plan' })
    const reply = runFundsCommand('/funds plan', NOW)
    expect(reply).toMatch(/^Not done:/)
    expect(reply).toContain('built by the app')
  })

  it('renders the header snapshot, one section per framework phase, and the per-bet blocks', async () => {
    seedProposal()
    saveOwnerScaffold(SYNTHETIC_SCAFFOLD)
    const plan = (await runFundsCommandWithExecution('/funds plan', { now: () => NOW, relayUrl: '' }))!
    expect(plan).toContain('Funds master plan — Kalshi demo exchange (fake money)')
    expect(plan).toContain('Bankroll $1000.00')
    expect(plan).toContain('Limits:')
    expect(plan).toContain('1 proposed')
    expect(plan.indexOf('Phase One: Survey')).toBeGreaterThanOrEqual(0)
    expect(plan.indexOf('Phase One: Survey')).toBeLessThan(plan.indexOf('Phase Two: Commit'))
    // The bets walk every phase: the seeded proposal's block appears once per phase.
    expect(plan.match(/KX-TEST/g)).toHaveLength(2)
    expect(plan).toContain('evidence: NWS forecast gives 60% rain')
    expect(plan).toContain('sources: https://weather.gov/forecast')
    expect(plan).toContain('confidence: 55%')
    expect(plan).toContain('falsifier: missing — not recorded on this position')
  })

  it('refuses plainly when no framework text is saved — no fallback template', async () => {
    seedProposal()
    const reply = (await runFundsCommandWithExecution('/funds plan', { now: () => NOW, relayUrl: '' }))!
    expect(reply).toContain('no framework text is saved in Settings')
    expect(reply).not.toContain('Phase One')
    expect(reply).not.toContain('confidence:')
  })

  it('a position with no recorded evidence says none recorded; the header carries the category record', async () => {
    const state = emptyFunds()
    state.limits = { ...state.limits, capAmount: 100000 }
    state.movements = [{ id: 'm1', at: NOW, kind: 'deposit', amount: 1000 }]
    state.positions = [
      { id: 'p1', createdAt: NOW, mode: 'real', venue: 'kalshi', market: 'KXHIGHNY-26OCT23-T75', side: 'yes', price: 0.5, probability: 0.6, contracts: 10, stake: 5, feeEstimate: 0.18, rationale: '', sources: [], status: 'proposed' },
      { id: 'p2', createdAt: NOW, mode: 'real', venue: 'kalshi', market: 'KXHIGHNY-26OCT22-T75', side: 'yes', price: 0.5, probability: 0.6, contracts: 10, stake: 5, feeEstimate: 0.18, rationale: 'settled already', sources: ['https://example.com/result'], status: 'settled', outcome: 'won', pnl: 4.82, settledAt: NOW },
    ]
    state.nextId = 3
    saveFunds(state)
    saveOwnerScaffold(SYNTHETIC_SCAFFOLD)
    const plan = (await runFundsCommandWithExecution('/funds plan', { now: () => NOW, relayUrl: '' }))!
    expect(plan).toContain('Category records: KXHIGHNY 1/1 won, $4.82 net')
    expect(plan).toContain('evidence: none recorded')
    expect(plan).toContain('falsifier: missing — not recorded on this position')
    expect(plan).not.toContain('settled already') // settled positions get no per-bet block
  })

  it('a framework with no phase structure: the plan says so and lists the bets unsectioned', async () => {
    seedProposal()
    saveOwnerScaffold('Work the problem from the facts.\nWrite down what would change your mind.')
    const plan = (await runFundsCommandWithExecution('/funds plan', { now: () => NOW, relayUrl: '' }))!
    expect(plan).toContain('No phase structure found in the saved framework')
    expect(plan).toContain('KX-TEST')
    expect(plan.match(/KX-TEST/g)).toHaveLength(1)
  })
})
