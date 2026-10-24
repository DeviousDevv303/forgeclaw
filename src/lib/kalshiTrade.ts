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
import { parseDollars, parseExchangeIndexStrict } from './kalshiMarkets'

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

/** A plain fetch-shaped transport: the global fetch, a run's bounded fetch, a test double. */
export type KalshiBaseFetcher = (url: string, init?: RequestInit) => Promise<Response>

/**
 * The one direct-then-relay Kalshi transport, shared by the signed order path
 * (kalshiExecution) and the read-only market data path (forgeTools' kalshi_markets /
 * funds_settle): try the base fetcher directly; on a TRANSPORT failure only (no HTTP
 * answer arrived — offline, or the browser blocked by CORS), send the same request
 * through the owner's relay (relay/ route /v1/kalshi), which forwards it verbatim and
 * returns {status, body}. An HTTP answer — even an error — is never relayed: Kalshi
 * already decided, and for order POSTs a second send is exactly the double-order risk
 * the client_order_id lookup exists to prevent. An empty relayUrl disables the fallback
 * (the direct error propagates untouched). If the relay leg fails or answers garbage,
 * the ORIGINAL direct error is what propagates — it is the honest one.
 */
export function relayFallbackFetcher(baseFetcher: KalshiBaseFetcher, relayUrl: string, relayFetcher: KalshiBaseFetcher = baseFetcher): KalshiBaseFetcher {
  return async (url, init = {}) => {
    try {
      return await baseFetcher(url, init)
    } catch (directError) {
      if (!relayUrl) throw directError
      let response: Response
      try {
        response = await relayFetcher(`${relayUrl}/v1/kalshi`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: init.method ?? 'GET', url, headers: init.headers, body: init.body }),
          ...(init.signal ? { signal: init.signal } : {}),
        })
      } catch {
        throw directError
      }
      const payload = await response.json().catch(() => null) as { status?: number; body?: string } | null
      if (!payload || typeof payload.status !== 'number') throw directError
      return new Response(payload.body ?? '', { status: payload.status })
    }
  }
}

/** One shard's balance, from the balance response's `balance_breakdown` entries. */
export interface KalshiShardBalance {
  exchangeIndex: number
  /** That shard's available balance in dollars (the entry's `balance`, parsed). */
  balanceDollars: number
}

export interface KalshiBalance {
  /** Available balance in whole cents (Kalshi's `balance`). */
  balanceCents: number
  /** Available balance in dollars (Kalshi's `balance_dollars`, parsed). */
  balanceDollars: number
  portfolioValueCents: number
  /**
   * When Kalshi last updated the balance (its `updated_ts`, whole seconds), or null
   * when the response carried no parseable timestamp. Carried for display honesty:
   * a live value is shown with the exchange's own update time, never implied fresh.
   */
  updatedTs: number | null
  /**
   * Per-shard balances from `balance_breakdown`, or null when the response omitted
   * the field entirely. Null and [] are different facts: "not reported" is never
   * rendered as a list of zero shards, and a reported shard that is missing from
   * the list is "not reported", never $0.
   */
  breakdown: KalshiShardBalance[] | null
}

/**
 * Parse `balance_breakdown` defensively: the field is an array of
 * {exchange_index, balance} entries; an entry that does not parse cleanly is
 * dropped, never guessed at. A non-array value means the breakdown was not
 * reported, which is null, not an empty list.
 */
export function parseBalanceBreakdown(value: unknown): KalshiShardBalance[] | null {
  if (!Array.isArray(value)) return null
  const out: KalshiShardBalance[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const exchangeIndex = parseExchangeIndexStrict(record.exchange_index)
    const balance = num(record.balance)
    if (exchangeIndex === null || balance === undefined) continue
    out.push({ exchangeIndex, balanceDollars: balance })
  }
  return out
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
  /**
   * The market's exchange shard (its record's `exchange_index`), or null when the
   * record carries no readable index. An order on this market draws only on this
   * shard's balance, so the approval path checks this shard, not just the all-shards
   * total — and on null it refuses rather than guessing a shard (owner ruling,
   * 2026-10-23: "Lock it"). Display code keeps using parseExchangeIndex's default;
   * the quote is the money path, so it reports exactly what the record said.
   */
  exchangeIndex: number | null
}

/**
 * The order lookup's answer is tri-state, and the distinction is load-bearing on the
 * money path: NOT_FOUND may only be reported when every status scan completed (all
 * pages read), because only then is "no order carries this key" evidence. Any read
 * failure — one status, one page — makes the answer UNKNOWN, and UNKNOWN must never
 * be read as "the order isn't there": absence of evidence is not evidence of absence.
 */
export type KalshiOrderLookup =
  | { kind: 'found'; order: KalshiExistingOrder }
  | { kind: 'not_found' }
  | { kind: 'unknown'; reason: string }

export interface KalshiClient {
  /**
   * The account balance. Without an exchange index this is the all-shards total —
   * which can read healthy while the one shard an order needs is empty. With one,
   * it is that shard's balance alone (GET /portfolio/balance?exchange_index=N).
   */
  getBalance(exchangeIndex?: number): Promise<KalshiBalance>
  createOrder(input: { ticker: string; side: 'bid' | 'ask'; count: number; priceDollars: number; clientOrderId: string }): Promise<KalshiOrderResult>
  findOrderByClientOrderId(clientOrderId: string, ticker: string, sinceMs?: number): Promise<KalshiOrderLookup>
  getSettlements(): Promise<KalshiSettlement[]>
  /** Public market data (unsigned) over the same transport, for the approval re-quote. */
  getMarketQuote(ticker: string): Promise<KalshiMarketQuote | null>
}

export interface KalshiClientOptions {
  now?: () => number
  delay?: (ms: number) => Promise<void>
}

// Kalshi's rate_limits page budgets GET /portfolio/balance at one read per second on the
// Basic tier, and a 429 carries no Retry-After header — so the spacing lives here, in the
// client, where every caller (single approve, approve-all, auto-approve) inherits it.
const BALANCE_READ_INTERVAL_MS = 1000
// Module-level on purpose: the app constructs a client per operation, and the budget is
// per API key, not per client instance.
const lastBalanceReadAt = new Map<string, number>()
// One balance window can page at most this far before the scan is called inconclusive:
// 10 pages x the 1000-row page cap, inside a window that starts at the approval, is past
// any plausible burst — the cap exists so a misbehaving cursor cannot loop the money path.
const MAX_LOOKUP_PAGES = 10
// min_ts is whole seconds; the window opens this far before the approval so a just-placed
// order can never fall outside it over clock skew between this browser and Kalshi.
const LOOKUP_SKEW_SECONDS = 60

export function createKalshiClient(creds: KalshiCredentials, fetcher: KalshiFetcher = defaultFetcher, opts: KalshiClientOptions = {}): KalshiClient {
  const base = kalshiBaseUrl(creds.env)

  const nowFn = opts.now ?? Date.now
  const delayFn = opts.delay ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))

  async function request<T>(method: string, path: string, query?: string, body?: unknown): Promise<T> {
    // Balance reads are spaced to the documented budget before the request goes out.
    if (method === 'GET' && path === '/trade-api/v2/portfolio/balance') {
      const waitMs = BALANCE_READ_INTERVAL_MS - (nowFn() - (lastBalanceReadAt.get(creds.keyId) ?? 0))
      if (waitMs > 0) await delayFn(waitMs)
      lastBalanceReadAt.set(creds.keyId, nowFn())
    }
    // A GET that meets a 429 gets exactly one spaced retry — reads are idempotent, so the
    // retry cannot duplicate anything. POSTs are never retried in this module: a resent
    // order POST is how duplicates happen (the execution layer reconciles instead).
    for (let attempt = 1; ; attempt++) {
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
        if (response.status === 429 && method === 'GET' && attempt === 1) {
          await delayFn(BALANCE_READ_INTERVAL_MS)
          continue
        }
        const err = (parsed as { error?: { code?: string; message?: string } } | null)?.error
        throw new KalshiApiError(response.status, err?.code ?? `http-${response.status}`, err?.message ?? `Kalshi refused ${method} ${path} (HTTP ${response.status}).`)
      }
      return parsed as T
    }
  }

  return {
    async getBalance(exchangeIndex?: number) {
      // The shard filter rides as a query parameter, signed exactly like the orders
      // lookup below: the signature covers the path only, the query goes on the URL.
      // The response's updated_ts and balance_breakdown ride along for the display
      // layer; the gate reads balanceDollars exactly as before.
      const raw = await request<{ balance: number; balance_dollars: string; portfolio_value: number; updated_ts?: unknown; balance_breakdown?: unknown }>(
        'GET', '/trade-api/v2/portfolio/balance',
        exchangeIndex !== undefined ? `exchange_index=${exchangeIndex}` : undefined,
      )
      return {
        balanceCents: raw.balance,
        balanceDollars: num(raw.balance_dollars) ?? raw.balance / 100,
        portfolioValueCents: raw.portfolio_value,
        updatedTs: num(raw.updated_ts) ?? null,
        breakdown: parseBalanceBreakdown(raw.balance_breakdown),
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

    async findOrderByClientOrderId(clientOrderId, ticker, sinceMs) {
      // The orders endpoint filters by status and the spec states no default, so an
      // unfiltered query cannot be trusted to include executed or canceled orders — the
      // two states a placed IOC order ends in. Scan all three explicitly. A scan that
      // could not read every status is INCOMPLETE, not negative: it resolves to the
      // tri-state's UNKNOWN, never to NOT_FOUND, so no caller can turn it into "nothing
      // was spent" (a miss is absence of evidence, and only evidence clears an order). Orders older
      // than Kalshi's historical cutoff live under /historical/orders; reconciliation
      // here runs seconds after placement, far inside the recent window.
      // The spec also gives no sort order, so each status is read at the maximum page
      // size and the cursor is followed to the end — a match sitting past the first
      // page must never read as a miss. min_ts opens the window at the approval (an
      // order carrying this key cannot predate it), which keeps the page count small.
      const sinceSec = sinceMs !== undefined ? Math.max(0, Math.floor(sinceMs / 1000) - LOOKUP_SKEW_SECONDS) : undefined
      let found: Record<string, unknown> | undefined
      let incomplete = false
      for (const status of ['resting', 'canceled', 'executed']) {
        let cursor: string | undefined
        for (let page = 1; ; page++) {
          let raw: { orders?: Array<Record<string, unknown>>; cursor?: string }
          try {
            raw = await request<{ orders?: Array<Record<string, unknown>>; cursor?: string }>(
              'GET', '/trade-api/v2/portfolio/orders',
              `ticker=${encodeURIComponent(ticker)}&status=${status}&limit=1000${sinceSec !== undefined ? `&min_ts=${sinceSec}` : ''}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
            )
          } catch {
            incomplete = true
            break
          }
          found = (raw.orders ?? []).find(o => o.client_order_id === clientOrderId)
          if (found) break
          cursor = raw.cursor || undefined
          if (!cursor) break
          if (page >= MAX_LOOKUP_PAGES) { incomplete = true; break }
        }
        if (found) break
      }
      if (!found) {
        if (incomplete) return { kind: 'unknown', reason: `The order lookup for ${clientOrderId} could not read every order status and page; whether the order exists is unknown.` }
        return { kind: 'not_found' }
      }
      const fillCount = num(found.fill_count_fp) ?? 0
      const fillCost = num(found.taker_fill_cost_dollars) ?? 0
      const fees = (num(found.taker_fees_dollars) ?? 0) + (num(found.maker_fees_dollars) ?? 0)
      return {
        kind: 'found',
        order: {
          orderId: String(found.order_id ?? ''),
          clientOrderId,
          status: String(found.status ?? ''),
          fillCount,
          remainingCount: num(found.remaining_count_fp) ?? 0,
          ...(fillCount > 0 && fillCost > 0 ? { averageFillPrice: Math.round((fillCost / fillCount) * 10000) / 10000 } : {}),
          ...(fillCount > 0 ? { totalFees: fees } : {}),
        },
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
        exchangeIndex: parseExchangeIndexStrict(raw.market.exchange_index),
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
