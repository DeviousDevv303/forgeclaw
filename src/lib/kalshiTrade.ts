// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

/**
 * The signed Kalshi trading client: balance, order placement, order lookup, settlements.
 *
 * Built on Kalshi's V2 events-orders API (the legacy /portfolio/orders create path is
 * deprecated). Every failure is one of two named kinds so the caller can say exactly what
 * happened:
 * - KalshiApiError: Kalshi answered and refused (status + Kalshi's own code/message).
 * - KalshiNetworkError: no answer arrived (offline, or the browser blocked the call — CORS).
 *   An order POST that ends this way is ambiguous: the order may exist. Callers must resolve
 *   it with findOrderByClientOrderId before any retry — this module never retries a POST.
 *
 * The fetcher is injected (same pattern as kalshiMarkets.ts) so tests run offline and the
 * caller can substitute the relay transport when the browser cannot reach Kalshi directly.
 */

import { kalshiBaseUrl, signKalshiRequest, type KalshiCredentials } from './kalshiAuth'
import { parseDollars } from './kalshiMarkets'

export class KalshiApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'KalshiApiError'
    this.status = status
    this.code = code
  }
}

export class KalshiNetworkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KalshiNetworkError'
  }
}

export type KalshiFetcher = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<Response>

const defaultFetcher: KalshiFetcher = (url, init) => fetch(url, init)

export interface KalshiBalance {
  /** Available balance in whole cents (Kalshi's `balance`). */
  balanceCents: number
  /** Available balance in dollars (Kalshi's `balance_dollars`, parsed). */
  balanceDollars: number
  portfolioValueCents: number
}

export interface KalshiOrderResult {
  orderId: string
  clientOrderId: string
  fillCount: number
  remainingCount: number
  /** Volume-weighted average fill price in dollars; present only when fillCount > 0. */
  averageFillPrice?: number
  /** Volume-weighted average fee per filled contract in dollars; only when fillCount > 0. */
  averageFeePaid?: number
}

export interface KalshiExistingOrder {
  orderId: string
  clientOrderId: string
  status: string
  fillCount: number
  remainingCount: number
  /** Recovered from the order's fill cost when Kalshi recorded fills for it. */
  averageFillPrice?: number
  /** Total fees recorded for the order's fills, in dollars. */
  totalFees?: number
}

export interface KalshiSettlement {
  ticker: string
  /** 'yes' | 'no' | 'scalar' — scalar markets are not binary and never auto-settle a position. */
  marketResult: string
  yesCount: number
  noCount: number
  yesTotalCostDollars: number
  noTotalCostDollars: number
  /** Total payout in whole cents (winning contracts pay 100 cents each). */
  revenueCents: number
  feeCostDollars: number
  settledTime: string
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : undefined
}

export interface KalshiMarketQuote {
  yesAsk: number | null
  noAsk: number | null
  status?: string
  result?: string
}

export interface KalshiClient {
  getBalance(): Promise<KalshiBalance>
  createOrder(input: { ticker: string; side: 'bid' | 'ask'; count: number; priceDollars: number; clientOrderId: string }): Promise<KalshiOrderResult>
  findOrderByClientOrderId(clientOrderId: string, ticker: string): Promise<KalshiExistingOrder | null>
  getSettlements(): Promise<KalshiSettlement[]>
  /** Public market data (unsigned) over the same transport, for the approval re-quote. */
  getMarketQuote(ticker: string): Promise<KalshiMarketQuote | null>
}

export function createKalshiClient(creds: KalshiCredentials, fetcher: KalshiFetcher = defaultFetcher): KalshiClient {
  const base = kalshiBaseUrl(creds.env)

  async function request<T>(method: string, path: string, query?: string, body?: unknown): Promise<T> {
    const headers = await signKalshiRequest(creds, method, path)
    let response: Response
    try {
      response = await fetcher(`${base}${path.slice('/trade-api/v2'.length)}${query ? `?${query}` : ''}`, {
        method,
        headers: { ...headers, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
    } catch (error) {
      throw new KalshiNetworkError(`No answer from Kalshi for ${method} ${path}: ${error instanceof Error ? error.message : String(error)}`)
    }
    const text = await response.text().catch(() => '')
    let parsed: unknown = null
    try { parsed = text ? JSON.parse(text) : null } catch { parsed = null }
    if (!response.ok) {
      const err = (parsed as { error?: { code?: string; message?: string } } | null)?.error
      throw new KalshiApiError(response.status, err?.code ?? `http-${response.status}`, err?.message ?? `Kalshi refused ${method} ${path} (HTTP ${response.status}).`)
    }
    return parsed as T
  }

  return {
    async getBalance() {
      const raw = await request<{ balance: number; balance_dollars: string; portfolio_value: number }>('GET', '/trade-api/v2/portfolio/balance')
      return {
        balanceCents: raw.balance,
        balanceDollars: num(raw.balance_dollars) ?? raw.balance / 100,
        portfolioValueCents: raw.portfolio_value,
      }
    },

    async createOrder(input) {
      const raw = await request<{
        order_id: string; client_order_id: string; fill_count: string; remaining_count: string
        average_fill_price?: string; average_fee_paid?: string
      }>('POST', '/trade-api/v2/portfolio/events/orders', undefined, {
        ticker: input.ticker,
        client_order_id: input.clientOrderId,
        side: input.side,
        // Fixed-point strings, Kalshi's V2 format: contracts to 2dp, dollars to 4dp.
        count: input.count.toFixed(2),
        price: input.priceDollars.toFixed(4),
        // IOC: fill what's available at the limit now, cancel the rest — nothing rests on the
        // book after the owner approved a specific live price.
        time_in_force: 'immediate_or_cancel',
        self_trade_prevention_type: 'taker_at_cross',
      })
      return {
        orderId: raw.order_id,
        clientOrderId: raw.client_order_id,
        fillCount: num(raw.fill_count) ?? 0,
        remainingCount: num(raw.remaining_count) ?? 0,
        ...(num(raw.average_fill_price) !== undefined ? { averageFillPrice: num(raw.average_fill_price) } : {}),
        ...(num(raw.average_fee_paid) !== undefined ? { averageFeePaid: num(raw.average_fee_paid) } : {}),
      }
    },

    async findOrderByClientOrderId(clientOrderId, ticker) {
      const raw = await request<{ orders?: Array<Record<string, unknown>> }>(
        'GET', '/trade-api/v2/portfolio/orders', `ticker=${encodeURIComponent(ticker)}&limit=100`,
      )
      const found = (raw.orders ?? []).find(o => o.client_order_id === clientOrderId)
      if (!found) return null
      const fillCount = num(found.fill_count_fp) ?? 0
      const fillCost = num(found.taker_fill_cost_dollars) ?? 0
      const fees = (num(found.taker_fees_dollars) ?? 0) + (num(found.maker_fees_dollars) ?? 0)
      return {
        orderId: String(found.order_id ?? ''),
        clientOrderId,
        status: String(found.status ?? ''),
        fillCount,
        remainingCount: num(found.remaining_count_fp) ?? 0,
        ...(fillCount > 0 && fillCost > 0 ? { averageFillPrice: Math.round((fillCost / fillCount) * 10000) / 10000 } : {}),
        ...(fillCount > 0 ? { totalFees: fees } : {}),
      }
    },

    async getMarketQuote(ticker) {
      let response: Response
      try {
        response = await fetcher(`${base}/markets/${encodeURIComponent(ticker)}`, { method: 'GET', headers: {} })
      } catch (error) {
        throw new KalshiNetworkError(`No answer from Kalshi for the market quote: ${error instanceof Error ? error.message : String(error)}`)
      }
      if (response.status === 404) return null
      if (!response.ok) throw new KalshiApiError(response.status, `http-${response.status}`, `Kalshi refused the market quote (HTTP ${response.status}).`)
      const raw = await response.json().catch(() => null) as { market?: Record<string, unknown> } | null
      if (!raw?.market) return null
      return {
        yesAsk: parseDollars(raw.market.yes_ask_dollars),
        noAsk: parseDollars(raw.market.no_ask_dollars),
        ...(typeof raw.market.status === 'string' ? { status: raw.market.status } : {}),
        ...(typeof raw.market.result === 'string' && raw.market.result ? { result: raw.market.result } : {}),
      }
    },

    async getSettlements() {
      const raw = await request<{ settlements?: Array<Record<string, unknown>> }>('GET', '/trade-api/v2/portfolio/settlements')
      return (raw.settlements ?? []).map(s => ({
        ticker: String(s.ticker ?? ''),
        marketResult: String(s.market_result ?? ''),
        yesCount: num(s.yes_count_fp) ?? 0,
        noCount: num(s.no_count_fp) ?? 0,
        yesTotalCostDollars: num(s.yes_total_cost_dollars) ?? 0,
        noTotalCostDollars: num(s.no_total_cost_dollars) ?? 0,
        revenueCents: num(s.revenue) ?? 0,
        feeCostDollars: num(s.fee_cost) ?? 0,
        settledTime: String(s.settled_time ?? ''),
      }))
    },
  }
}

/**
 * The order an approved proposal becomes. Kalshi's book is YES-priced: buying YES is a `bid`
 * at the YES price p; buying NO is an `ask` (selling YES) at 1 − p. (Directive: confirm on the
 * demo exchange before real money — the demo check is in the PR's verification notes.)
 */
export function orderForProposal(input: { side: 'yes' | 'no'; livePrice: number; contracts: number }): { side: 'bid' | 'ask'; priceDollars: number; count: number } {
  return input.side === 'yes'
    ? { side: 'bid', priceDollars: input.livePrice, count: input.contracts }
    : { side: 'ask', priceDollars: Math.round((1 - input.livePrice) * 10000) / 10000, count: input.contracts }
}
