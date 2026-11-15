// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

// @vitest-environment jsdom
import { generateKeyPairSync, webcrypto } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { KalshiCredentials } from './kalshiAuth'
import { KalshiApiError, KalshiNetworkError, createKalshiClient, orderForProposal, relayFallbackFetcher, type KalshiBaseFetcher, type KalshiFetcher } from './kalshiTrade'

// jsdom's WebCrypto has no Ed25519; sign with Node's, as in kalshiAuth.test.ts.
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })

const { privateKey } = generateKeyPairSync('ed25519')
const creds: KalshiCredentials = {
  keyId: 'test-key-id',
  privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  env: 'demo',
}

interface Captured { url: string; method: string; headers: Record<string, string>; body?: string }

function fakeFetcher(handler: (call: Captured) => { status?: number; json?: unknown } | 'throw'): { fetcher: KalshiFetcher; calls: Captured[] } {
  const calls: Captured[] = []
  const fetcher: KalshiFetcher = async (url, init) => {
    const call: Captured = { url, method: init.method, headers: init.headers, body: init.body }
    calls.push(call)
    const result = handler(call)
    if (result === 'throw') throw new TypeError('Failed to fetch')
    return new Response(JSON.stringify(result.json ?? {}), { status: result.status ?? 200 })
  }
  return { fetcher, calls }
}

describe('getBalance', () => {
  it('parses cents and the dollar string, and signs the queryless path', async () => {
    const { fetcher, calls } = fakeFetcher(() => ({ json: { balance: 12345, balance_dollars: '123.4500', portfolio_value: 13000, updated_ts: 1 } }))
    const balance = await createKalshiClient(creds, fetcher).getBalance()
    expect(balance).toEqual({ balanceCents: 12345, balanceDollars: 123.45, portfolioValueCents: 13000, updatedTs: 1, breakdown: null })
    expect(calls[0].url).toBe('https://external-api.demo.kalshi.co/trade-api/v2/portfolio/balance')
    expect(calls[0].headers['KALSHI-ACCESS-KEY']).toBe('test-key-id')
    expect(calls[0].headers['KALSHI-ACCESS-SIGNATURE']).toBeTruthy()
  })

  it('a shard read asks for that shard only: exchange_index rides the URL query, the signed path is unchanged', async () => {
    const { fetcher, calls } = fakeFetcher(() => ({ json: { balance: 0, balance_dollars: '0.0000', portfolio_value: 0, updated_ts: 1 } }))
    const balance = await createKalshiClient({ ...creds, keyId: 'shard-key' }, fetcher).getBalance(3)
    expect(balance.balanceDollars).toBe(0)
    expect(calls[0].url).toBe('https://external-api.demo.kalshi.co/trade-api/v2/portfolio/balance?exchange_index=3')
    expect(calls[0].headers['KALSHI-ACCESS-SIGNATURE']).toBeTruthy()
  })

  it('carries the per-shard breakdown and the update timestamp the response reports', async () => {
    const { fetcher } = fakeFetcher(() => ({
      json: {
        balance: 2500, balance_dollars: '25.0000', portfolio_value: 2500, updated_ts: 1761240000,
        balance_breakdown: [
          { exchange_index: 0, balance: '25.0000' },
          { exchange_index: 3, balance: '0.0000' },
        ],
      },
    }))
    const balance = await createKalshiClient(creds, fetcher).getBalance()
    expect(balance.updatedTs).toBe(1761240000)
    expect(balance.breakdown).toEqual([
      { exchangeIndex: 0, balanceDollars: 25 },
      { exchangeIndex: 3, balanceDollars: 0 },
    ])
  })

  it('drops malformed breakdown entries instead of guessing at them; an empty breakdown stays empty, not null', async () => {
    const { fetcher } = fakeFetcher(() => ({
      json: {
        balance: 100, balance_dollars: '1.0000', portfolio_value: 100, updated_ts: 5,
        balance_breakdown: [
          { exchange_index: 2, balance: '1.0000' },
          { exchange_index: 'soon', balance: '9.0000' },
          { balance: '9.0000' },
          'garbage',
          null,
        ],
      },
    }))
    const balance = await createKalshiClient(creds, fetcher).getBalance()
    expect(balance.breakdown).toEqual([{ exchangeIndex: 2, balanceDollars: 1 }])

    const { fetcher: emptyFetcher } = fakeFetcher(() => ({ json: { balance: 0, balance_dollars: '0.0000', portfolio_value: 0, balance_breakdown: [] } }))
    const empty = await createKalshiClient(creds, emptyFetcher).getBalance()
    expect(empty.breakdown).toEqual([])
    expect(empty.updatedTs).toBeNull()
  })
})

describe('getMarketQuote', () => {
  it('carries the market’s exchange_index from its record', async () => {
    const { fetcher } = fakeFetcher(() => ({ json: { market: { yes_ask_dollars: '0.5100', no_ask_dollars: '0.5100', status: 'active', exchange_index: 3 } } }))
    const quote = await createKalshiClient(creds, fetcher).getMarketQuote('KX-TENNIS')
    expect(quote).toEqual({ yesAsk: 0.51, noAsk: 0.51, exchangeIndex: 3, status: 'active' })
  })

  it('carries a null shard when the record omits exchange_index — the quote reports what the record said, no default (owner ruling, 2026-10-23)', async () => {
    const { fetcher } = fakeFetcher(() => ({ json: { market: { yes_ask_dollars: '0.5100', no_ask_dollars: '0.5100', status: 'active' } } }))
    const quote = await createKalshiClient(creds, fetcher).getMarketQuote('KX-WEATHER')
    expect(quote?.exchangeIndex).toBeNull()
  })

  it('carries a null shard when the record’s exchange_index is unreadable', async () => {
    const { fetcher } = fakeFetcher(() => ({ json: { market: { yes_ask_dollars: '0.5100', no_ask_dollars: '0.5100', status: 'active', exchange_index: 'soon' } } }))
    const quote = await createKalshiClient(creds, fetcher).getMarketQuote('KX-WEATHER')
    expect(quote?.exchangeIndex).toBeNull()
  })
})

describe('createOrder', () => {
  it('sends the V2 body: fixed-point strings, IOC, taker_at_cross, the client order id', async () => {
    const { fetcher, calls } = fakeFetcher(() => ({
      status: 201,
      json: { order_id: 'o1', client_order_id: 'fc-p1-99', fill_count: '10.00', remaining_count: '0.00', average_fill_price: '0.5600', average_fee_paid: '0.0173', ts_ms: 1 },
    }))
    const result = await createKalshiClient(creds, fetcher).createOrder({ ticker: 'KX-1', side: 'bid', count: 10, priceDollars: 0.56, clientOrderId: 'fc-p1-99' })
    const body = JSON.parse(calls[0].body!)
    expect(body).toEqual({
      ticker: 'KX-1', client_order_id: 'fc-p1-99', side: 'bid', count: '10.00', price: '0.5600',
      time_in_force: 'immediate_or_cancel', self_trade_prevention_type: 'taker_at_cross',
    })
    expect(result).toEqual({ orderId: 'o1', clientOrderId: 'fc-p1-99', fillCount: 10, remainingCount: 0, averageFillPrice: 0.56, averageFeePaid: 0.0173 })
  })

  it('a zero fill parses with no average fields (Kalshi omits them)', async () => {
    const { fetcher } = fakeFetcher(() => ({ status: 201, json: { order_id: 'o2', client_order_id: 'c', fill_count: '0.00', remaining_count: '5.00', ts_ms: 1 } }))
    const result = await createKalshiClient(creds, fetcher).createOrder({ ticker: 'KX-1', side: 'ask', count: 5, priceDollars: 0.6, clientOrderId: 'c' })
    expect(result.fillCount).toBe(0)
    expect(result.averageFillPrice).toBeUndefined()
    expect(result.averageFeePaid).toBeUndefined()
  })

  it('a refusal is a KalshiApiError carrying Kalshi’s own code and message', async () => {
    const { fetcher } = fakeFetcher(() => ({ status: 400, json: { error: { code: 'insufficient_balance', message: 'Insufficient balance.' } } }))
    await expect(createKalshiClient(creds, fetcher).createOrder({ ticker: 'KX-1', side: 'bid', count: 1, priceDollars: 0.5, clientOrderId: 'c' }))
      .rejects.toMatchObject({ name: 'KalshiApiError', status: 400, code: 'insufficient_balance', message: 'Insufficient balance.' })
  })

  it('no answer at all is a KalshiNetworkError (ambiguous — caller must look before retrying)', async () => {
    const { fetcher, calls } = fakeFetcher(() => 'throw')
    await expect(createKalshiClient(creds, fetcher).createOrder({ ticker: 'KX-1', side: 'bid', count: 1, priceDollars: 0.5, clientOrderId: 'c' }))
      .rejects.toBeInstanceOf(KalshiNetworkError)
    expect(calls).toHaveLength(1) // the client itself never retries a POST
  })
})

describe('orderForProposal — the single-book mapping', () => {
  it('YES is a bid at the YES price', () => {
    expect(orderForProposal({ side: 'yes', livePrice: 0.56, contracts: 10 })).toEqual({ side: 'bid', priceDollars: 0.56, count: 10 })
  })
  it('NO is an ask at 1 − the NO price (selling YES)', () => {
    expect(orderForProposal({ side: 'no', livePrice: 0.4, contracts: 3 })).toEqual({ side: 'ask', priceDollars: 0.6, count: 3 })
    expect(orderForProposal({ side: 'no', livePrice: 0.333, contracts: 1 }).priceDollars).toBe(0.667)
  })
})

describe('findOrderByClientOrderId — the no-double-order lookup', () => {
  const orders = {
    orders: [
      { order_id: 'other', client_order_id: 'fc-p9-1', ticker: 'KX-1', status: 'executed', fill_count_fp: '2.00', remaining_count_fp: '0.00', taker_fill_cost_dollars: '1.1200', taker_fees_dollars: '0.0300', maker_fees_dollars: '0.0000' },
      { order_id: 'mine', client_order_id: 'fc-p1-99', ticker: 'KX-1', status: 'executed', fill_count_fp: '10.00', remaining_count_fp: '0.00', taker_fill_cost_dollars: '5.6000', taker_fees_dollars: '0.1730', maker_fees_dollars: '0.0000' },
    ],
  }
  it('finds the order and recovers its fill price and fees', async () => {
    const { fetcher, calls } = fakeFetcher(() => ({ json: orders }))
    const found = await createKalshiClient(creds, fetcher).findOrderByClientOrderId('fc-p1-99', 'KX-1')
    expect(found).toEqual({ kind: 'found', order: { orderId: 'mine', clientOrderId: 'fc-p1-99', status: 'executed', fillCount: 10, remainingCount: 0, averageFillPrice: 0.56, totalFees: 0.173 } })
    expect(calls[0].url).toContain('/portfolio/orders?ticker=KX-1&status=resting&limit=1000')
  })
  it('reports NOT_FOUND only when no order carries the id in any status', async () => {
    const { fetcher, calls } = fakeFetcher(() => ({ json: orders }))
    expect(await createKalshiClient(creds, fetcher).findOrderByClientOrderId('fc-nope', 'KX-1')).toEqual({ kind: 'not_found' })
    expect(calls.map(c => c.url)).toEqual([
      expect.stringContaining('status=resting'),
      expect.stringContaining('status=canceled'),
      expect.stringContaining('status=executed'),
    ])
  })
  it('finds an executed order even when the resting and canceled lists are empty', async () => {
    const { fetcher } = fakeFetcher(call => ({ json: call.url.includes('status=executed') ? orders : { orders: [] } }))
    const found = await createKalshiClient(creds, fetcher).findOrderByClientOrderId('fc-p1-99', 'KX-1')
    expect(found).toMatchObject({ kind: 'found', order: { orderId: 'mine' } })
  })
  it('a status it could not read makes the lookup UNKNOWN — never a reported miss', async () => {
    const { fetcher } = fakeFetcher(call => (call.url.includes('status=canceled') ? 'throw' : { json: { orders: [] } }))
    const result = await createKalshiClient(creds, fetcher).findOrderByClientOrderId('fc-p1-99', 'KX-1')
    expect(result.kind).toBe('unknown')
  })
  it('follows the cursor to the end of a status before concluding anything', async () => {
    const { fetcher, calls } = fakeFetcher(call => {
      if (!call.url.includes('status=resting')) return { json: { orders: [] } }
      if (call.url.includes('cursor=c2')) return { json: orders }
      return { json: { orders: [], cursor: 'c2' } }
    })
    const found = await createKalshiClient(creds, fetcher).findOrderByClientOrderId('fc-p1-99', 'KX-1')
    expect(found).toMatchObject({ kind: 'found', order: { orderId: 'mine' } })
    expect(calls.some(c => c.url.includes('cursor=c2'))).toBe(true)
  })
  it('a page that fails mid-scan makes the lookup UNKNOWN even after a clean first page', async () => {
    const { fetcher } = fakeFetcher(call => {
      if (call.url.includes('cursor=c2')) return 'throw'
      if (call.url.includes('status=resting')) return { json: { orders: [], cursor: 'c2' } }
      return { json: { orders: [] } }
    })
    const result = await createKalshiClient(creds, fetcher).findOrderByClientOrderId('fc-p1-99', 'KX-1')
    expect(result.kind).toBe('unknown')
  })
  it('a cursor that never ends hits the page cap and the lookup is UNKNOWN, never a miss — and the scan is bounded', async () => {
    const { fetcher, calls } = fakeFetcher(call => {
      if (call.url.includes('status=resting')) return { json: { orders: [], cursor: 'more' } }
      return { json: { orders: [] } }
    })
    const result = await createKalshiClient(creds, fetcher).findOrderByClientOrderId('fc-p1-98', 'KX-1')
    expect(result.kind).toBe('unknown')
    expect(calls.filter(c => c.url.includes('status=resting')).length).toBe(10)
  })
  it('opens the scan window at the approval: min_ts is the approval second minus the skew allowance', async () => {
    const { fetcher, calls } = fakeFetcher(() => ({ json: { orders: [] } }))
    await createKalshiClient(creds, fetcher).findOrderByClientOrderId('fc-nope', 'KX-1', 1_700_000_120_000)
    expect(calls[0].url).toContain('min_ts=1700000060')
  })
})

describe('rate limits (the balance budget and the 429 rules)', () => {
  it('spaces balance reads one second apart per key, through the injected clock', async () => {
    let t = 5_000_000
    const delays: number[] = []
    const { fetcher } = fakeFetcher(() => ({ json: { balance: 100, balance_dollars: '1.0000', portfolio_value: 100, updated_ts: 1 } }))
    const client = createKalshiClient({ ...creds, keyId: 'spacing-key' }, fetcher, { now: () => t, delay: async ms => { delays.push(ms) } })
    await client.getBalance()
    await client.getBalance()
    expect(delays).toEqual([1000])
    t += 1000
    await client.getBalance()
    expect(delays).toEqual([1000])
  })
  it('a GET that meets a 429 gets one spaced retry — reads are idempotent', async () => {
    let n = 0
    const delays: number[] = []
    const { fetcher, calls } = fakeFetcher(() => (++n === 1 ? { status: 429, json: { error: { code: 'rate_limited', message: 'Slow down.' } } } : { json: { balance: 200, balance_dollars: '2.0000', portfolio_value: 200, updated_ts: 1 } }))
    const client = createKalshiClient({ ...creds, keyId: 'retry-key' }, fetcher, { now: () => 9_000_000, delay: async ms => { delays.push(ms) } })
    const balance = await client.getBalance()
    expect(balance.balanceCents).toBe(200)
    expect(calls).toHaveLength(2)
    expect(delays).toContain(1000)
  })
  it('a POST that meets a 429 is never retried here — it surfaces as a refusal', async () => {
    const { fetcher, calls } = fakeFetcher(() => ({ status: 429, json: { error: { code: 'rate_limited', message: 'Slow down.' } } }))
    const client = createKalshiClient({ ...creds, keyId: 'post-429-key' }, fetcher, { now: () => 9_500_000, delay: async () => {} })
    await expect(client.createOrder({ ticker: 'KX-1', side: 'bid', count: 1, priceDollars: 0.5, clientOrderId: 'fc-p1-1' })).rejects.toBeInstanceOf(KalshiApiError)
    expect(calls).toHaveLength(1)
  })
})

describe('relayFallbackFetcher — the shared direct-then-relay transport', () => {
  const throwing: KalshiBaseFetcher = async () => { throw new TypeError('Failed to fetch') }

  it('a transport failure goes through the relay and rebuilds the response; the forwarded method defaults to GET', async () => {
    const relayBodies: Array<Record<string, unknown>> = []
    const relay: KalshiBaseFetcher = async (url, init) => {
      expect(url).toBe('https://relay.example/v1/kalshi')
      relayBodies.push(JSON.parse(String(init?.body)))
      return Response.json({ status: 200, body: '{"markets":[]}' })
    }
    const fetcher = relayFallbackFetcher(throwing, 'https://relay.example', relay)
    const res = await fetcher('https://external-api.kalshi.com/trade-api/v2/markets?limit=1000', { headers: { Accept: 'application/json' } })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('{"markets":[]}')
    expect(relayBodies).toHaveLength(1)
    expect(relayBodies[0].method).toBe('GET') // the market read passes no method; the relay contract requires one
    expect(relayBodies[0].url).toContain('/trade-api/v2/markets')
  })

  it('an HTTP answer — even an error — is never relayed', async () => {
    let relayCalls = 0
    const base: KalshiBaseFetcher = async () => new Response('Kalshi said no', { status: 403 })
    const relay: KalshiBaseFetcher = async () => { relayCalls++; return Response.json({ status: 200, body: '{}' }) }
    const res = await relayFallbackFetcher(base, 'https://relay.example', relay)('https://external-api.kalshi.com/trade-api/v2/markets')
    expect(res.status).toBe(403)
    expect(relayCalls).toBe(0)
  })

  it('with no relay configured the direct error propagates untouched; a broken relay never masks it either', async () => {
    await expect(relayFallbackFetcher(throwing, '')('https://external-api.kalshi.com/trade-api/v2/markets')).rejects.toThrow('Failed to fetch')
    const garbageRelay: KalshiBaseFetcher = async () => Response.json({ error: 'origin not allowed' })
    await expect(relayFallbackFetcher(throwing, 'https://relay.example', garbageRelay)('https://external-api.kalshi.com/trade-api/v2/markets')).rejects.toThrow('Failed to fetch')
    await expect(relayFallbackFetcher(throwing, 'https://relay.example', throwing)('https://external-api.kalshi.com/trade-api/v2/markets')).rejects.toThrow('Failed to fetch')
  })
})

describe('getSettlements', () => {
  it('parses the settlement rows auto-settle reconciles against', async () => {
    const { fetcher } = fakeFetcher(() => ({
      json: {
        settlements: [{
          ticker: 'KX-1', event_ticker: 'KX', exchange_index: 0, market_result: 'yes',
          yes_count_fp: '10.00', yes_total_cost_dollars: '5.6000', no_count_fp: '0.00', no_total_cost_dollars: '0.0000',
          revenue: 1000, fee_cost: '0.1730', settled_time: '2026-10-23T00:00:00Z',
        }],
        cursor: '',
      },
    }))
    const settlements = await createKalshiClient(creds, fetcher).getSettlements()
    expect(settlements).toEqual([{
      ticker: 'KX-1', marketResult: 'yes', yesCount: 10, noCount: 0, yesTotalCostDollars: 5.6,
      noTotalCostDollars: 0, revenueCents: 1000, feeCostDollars: 0.173, settledTime: '2026-10-23T00:00:00Z',
    }])
  })
})
