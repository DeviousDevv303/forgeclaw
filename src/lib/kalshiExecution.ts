// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

/**
 * Owner-approved Kalshi execution: the layer that turns the owner's `/funds approve <id>`
 * into a real order on Kalshi, and settles placed positions from Kalshi's own settlements.
 *
 * The authority split is unchanged: a model can propose, but only the owner's typed (or
 * tapped, PR B) approve reaches this code, and this code runs only from that command.
 *
 * Safety shape, in order, for every approval:
 * 1. Re-quote: fetch the live ask. No edge left, or the price ran past the owner's tolerance
 *    (limits.toleranceCents, default 2¢), means NO order and a message saying exactly that.
 * 2. Balance: read Kalshi's real balance; refuse when it cannot cover stake + fees.
 * 3. The approval is recorded in the ledger BEFORE the order is sent, under a unique
 *    client_order_id, so a lost response can be resolved by lookup — never by blind retry.
 * 4. The fill Kalshi reports (real contracts, price, fee) is what the ledger records.
 *
 * Transport: direct from the browser first; if the browser cannot reach Kalshi (the request
 * itself fails — offline or CORS), the same signed request goes through the owner's relay
 * (relay/ route /v1/kalshi). Kalshi's signature does not cover the host, so it stays valid.
 */

import { loadKalshiCredentials, type KalshiCredentials } from './kalshiAuth'
import {
  applyFundsCommand, estimateFee, loadFunds, money, outcomeFromKalshiResult, parseFundsCommand,
  recordKalshiFill, revertKalshiApproval, runFundsCommand, saveFunds, setClientOrderId, settlePosition,
  NOT_SAVED_WARNING, type FundsState,
} from './fundsLedger'
import { KalshiApiError, KalshiNetworkError, createKalshiClient, orderForProposal, type KalshiClient, type KalshiFetcher } from './kalshiTrade'
import { PUBLIC_RELAY_URL } from './publicRelay'

export interface KalshiExecutionDeps {
  creds?: KalshiCredentials | null
  client?: KalshiClient
  /** Relay base URL for the transport fallback; '' disables it. Defaults to the build's relay. */
  relayUrl?: string
  now?: () => number
}

/**
 * Direct fetch, falling back to the relay on a transport failure. An HTTP answer — even an
 * error — is never retried through the relay: Kalshi already decided, and for order POSTs a
 * second send is exactly the double-order risk the client_order_id lookup exists to prevent.
 */
export function directThenRelayFetcher(relayUrl: string): KalshiFetcher {
  return async (url, init) => {
    try {
      return await fetch(url, init)
    } catch (directError) {
      if (!relayUrl) throw directError
      let response: Response
      try {
        response = await fetch(`${relayUrl}/v1/kalshi`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: init.method, url, headers: init.headers, body: init.body }),
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

function resolveClient(deps: KalshiExecutionDeps): { creds: KalshiCredentials; client: KalshiClient } | null {
  const creds = deps.creds !== undefined ? deps.creds : loadKalshiCredentials()
  if (!creds) return null
  const client = deps.client ?? createKalshiClient(creds, directThenRelayFetcher(deps.relayUrl ?? PUBLIC_RELAY_URL))
  return { creds, client }
}

const isKalshi = (venue: string) => venue.trim().toLowerCase() === 'kalshi'
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`

/** Persist, and say so when the browser would not keep it. Returns false when unsaved. */
function persist(state: FundsState): boolean {
  return saveFunds(state)
}

async function executeApprove(id: string, deps: KalshiExecutionDeps): Promise<string> {
  const now = deps.now ?? Date.now
  const resolved = resolveClient(deps)
  if (!resolved) {
    return `Not placed: no Kalshi API key in this browser. Add your key ID and private key in Settings (the Kalshi section where the Brave key used to be) — a demo key first. The proposal is unchanged.`
  }
  const { creds, client } = resolved
  const envNote = creds.env === 'demo' ? ' (demo exchange — fake money)' : ''
  let state = loadFunds()
  const position = state.positions.find(p => p.id === id)
  if (!position) return runFundsCommand(`/funds approve ${id}`) ?? `Not done: no position ${id}.`

  // 1. Re-quote at the live ask.
  let quote
  try {
    quote = await client.getMarketQuote(position.market)
  } catch (error) {
    if (error instanceof KalshiNetworkError) return `Not placed: this browser could not reach Kalshi for a live price${deps.relayUrl === '' ? '' : ', and the relay fallback failed too'} (${error.message}). Nothing was spent; the proposal is unchanged.`
    if (error instanceof KalshiApiError) return `Not placed: Kalshi refused the live price check (${error.code}: ${error.message}). Nothing was spent; the proposal is unchanged.`
    throw error
  }
  if (!quote) return `Not placed: Kalshi has no market ${position.market}. Nothing was spent; the proposal is unchanged.`
  const livePrice = position.side === 'yes' ? quote.yesAsk : quote.noAsk
  if (livePrice === null || livePrice <= 0 || livePrice >= 1) {
    return `Not placed: no ${position.side.toUpperCase()} contracts are offered on ${position.market} right now. Nothing was spent; the proposal is unchanged.`
  }
  if (position.probability - livePrice <= 0) {
    return `Not placed: the edge is gone. Live price ${money(livePrice)} (${pct(livePrice)}) vs your estimate ${pct(position.probability)} — at the live price the expected value is fees only. Nothing was spent; the proposal is unchanged.`
  }
  const tolerance = state.limits.toleranceCents / 100
  if (livePrice > position.price + tolerance + 1e-9) {
    return `Not placed: the price moved from ${money(position.price)} to ${money(livePrice)}, past your tolerance of ${state.limits.toleranceCents}¢ (change it with /funds limits tolerance=<cents>). Nothing was spent; the proposal is unchanged.`
  }

  // 2. Balance gate against Kalshi's real balance.
  let balanceDollars: number
  try {
    balanceDollars = (await client.getBalance()).balanceDollars
  } catch (error) {
    if (error instanceof KalshiNetworkError) return `Not placed: this browser could not reach Kalshi to check your balance (${error.message}). Nothing was spent; the proposal is unchanged.`
    if (error instanceof KalshiApiError) return `Not placed: Kalshi refused the balance check (${error.code}: ${error.message}). Nothing was spent; the proposal is unchanged.`
    throw error
  }
  const feeEstimate = estimateFee('kalshi', position.contracts, livePrice)
  const needed = position.contracts * livePrice + feeEstimate
  if (balanceDollars + 1e-9 < needed) {
    return `Not placed: your Kalshi balance is ${money(balanceDollars)}${envNote} but this order needs about ${money(needed)} (${position.contracts} contracts at ${money(livePrice)} + ~${money(feeEstimate)} fees). Nothing was spent; the proposal is unchanged.`
  }

  // 3. Record the approval (with its client_order_id) BEFORE sending anything.
  let approved: FundsState
  try {
    approved = applyFundsCommand(state, { kind: 'approve', id }, now()).state
  } catch (error) {
    return `Not placed: ${error instanceof Error ? error.message : String(error)}`
  }
  const clientOrderId = `fc-${id}-${now()}`
  approved = setClientOrderId(approved, id, clientOrderId)
  if (!persist(approved)) {
    return `Not placed: the ledger could not be saved in this browser, so no order was sent.${NOT_SAVED_WARNING}`
  }
  state = approved

  const order = orderForProposal({ side: position.side, livePrice, contracts: position.contracts })
  const placedMessage = (fillCount: number, avgPrice: number, feePaidTotal: number, orderId: string, recovered: boolean): string => {
    const partial = fillCount < position.contracts ? ` Partial fill: ${fillCount} of ${position.contracts} contracts; the rest was cancelled (immediate-or-cancel).` : ''
    return `Placed ${id}${recovered ? ' (the order went through; its response was lost and the fill was recovered by lookup)' : ''}: bought ${fillCount} ${position.side.toUpperCase()} on ${position.market} at ${money(avgPrice)} on Kalshi${envNote} — ${money(fillCount * avgPrice)} + ${money(feePaidTotal)} fees (order ${orderId}).${partial}\nIt settles from Kalshi automatically when the market resolves.`
  }
  const recordFill = (fillCount: number, avgPrice: number, feePaidTotal: number, orderId: string, recovered: boolean): string => {
    const next = recordKalshiFill(state, id, { fillCount, avgFillPrice: avgPrice, feePaid: feePaidTotal, orderId, clientOrderId }, now())
    const saved = persist(next)
    return placedMessage(fillCount, avgPrice, feePaidTotal, orderId, recovered) + (saved ? '' : NOT_SAVED_WARNING)
  }
  const revertWith = (message: string): string => {
    persist(revertKalshiApproval(state, id))
    return message
  }

  // 4. Send the order — once. An ambiguous failure is resolved by lookup, never by resending.
  let result
  try {
    result = await client.createOrder({ ticker: position.market, side: order.side, count: order.count, priceDollars: order.priceDollars, clientOrderId })
  } catch (error) {
    if (error instanceof KalshiApiError) {
      return revertWith(`Not placed: Kalshi refused the order (${error.code}: ${error.message}). Nothing was spent; the proposal is back to proposed.`)
    }
    if (error instanceof KalshiNetworkError) {
      // No answer: the order may exist. Look before doing anything else.
      let existing = null
      try { existing = await client.findOrderByClientOrderId(clientOrderId, position.market) } catch { existing = null }
      if (existing && existing.fillCount > 0) {
        return recordFill(existing.fillCount, existing.averageFillPrice ?? livePrice, existing.totalFees ?? estimateFee('kalshi', existing.fillCount, existing.averageFillPrice ?? livePrice), existing.orderId, true)
      }
      if (existing) {
        return revertWith(`Not placed: the order reached Kalshi (order ${existing.orderId}, status ${existing.status}) but filled nothing. Nothing was spent; the proposal is back to proposed.`)
      }
      // No order under that id: one resend with the SAME client_order_id, so even a late
      // duplicate is detectable and Kalshi can dedupe on it.
      try {
        result = await client.createOrder({ ticker: position.market, side: order.side, count: order.count, priceDollars: order.priceDollars, clientOrderId })
      } catch (retryError) {
        if (retryError instanceof KalshiApiError) {
          return revertWith(`Not placed: Kalshi refused the order (${retryError.code}: ${retryError.message}). Nothing was spent; the proposal is back to proposed.`)
        }
        return `Unknown: two attempts to place ${id} got no answer from Kalshi, and no order with id ${clientOrderId} exists yet. The approval stands — ${id} is approved, not placed. Check Kalshi, then either type /funds placed ${id} <fill price> if you place it there, or /funds reject ${id} to drop it. Nothing was resent a third time.`
      }
    } else {
      throw error
    }
  }
  if (result.fillCount <= 0) {
    return revertWith(`Nothing placed: the order filled 0 contracts at ${money(livePrice)} (immediate-or-cancel) — nothing was spent. The proposal is back to proposed; approve again to retry at the then-live price.`)
  }
  const feePaidTotal = Math.round((result.averageFeePaid ?? 0) * result.fillCount * 100) / 100
  return recordFill(result.fillCount, result.averageFillPrice ?? livePrice, feePaidTotal, result.orderId, false)
}

/**
 * The /funds entry point the app uses: identical to runFundsCommand, except approving a
 * Kalshi proposal executes the order (executeApprove) and bare status appends Kalshi's live
 * balance when a key is present.
 */
export async function runFundsCommandWithExecution(text: string, deps: KalshiExecutionDeps = {}): Promise<string | null> {
  const cmd = parseFundsCommand(text)
  if (!cmd) return null
  if (cmd.kind === 'approve') {
    const state = loadFunds()
    const position = state.positions.find(p => p.id === cmd.id)
    if (position && position.mode === 'real' && position.status === 'proposed' && isKalshi(position.venue)) {
      return executeApprove(cmd.id, deps)
    }
    return runFundsCommand(text)
  }
  if (cmd.kind === 'status') {
    const base = runFundsCommand(text)
    const resolved = resolveClient(deps)
    if (!resolved || base === null) return base
    try {
      const balance = await resolved.client.getBalance()
      return `${base}\nKalshi balance (live, ${resolved.creds.env}): ${money(balance.balanceDollars)}.`
    } catch (error) {
      const why = error instanceof KalshiApiError ? `Kalshi refused (${error.code}: ${error.message})` : error instanceof KalshiNetworkError ? 'this browser could not reach Kalshi' : 'unknown error'
      return `${base}\nKalshi balance: could not be read — ${why}.`
    }
  }
  return runFundsCommand(text)
}

export interface SettledNotice { id: string; market: string; outcome: 'won' | 'lost'; pnl: number }

/**
 * On app open: settle placed Kalshi positions from Kalshi's own settlements. A settlement is
 * applied only when its side count matches the position's contracts exactly and it settled
 * after the position was placed — a same-ticker manual trade in the Kalshi app must never be
 * absorbed into the ledger by coincidence. Anything unmatched is left for the owner.
 */
export async function autoSettleKalshiPositions(deps: KalshiExecutionDeps = {}): Promise<SettledNotice[]> {
  const resolved = resolveClient(deps)
  if (!resolved) return []
  const now = deps.now ?? Date.now
  let settlements
  try {
    settlements = await resolved.client.getSettlements()
  } catch {
    return [] // Best effort on open; the next open retries. /funds errors stay named there.
  }
  let state = loadFunds()
  const notices: SettledNotice[] = []
  for (const position of state.positions) {
    if (position.mode !== 'real' || position.status !== 'placed' || !isKalshi(position.venue)) continue
    const settlement = settlements.find(s => s.ticker === position.market)
    if (!settlement || (settlement.marketResult !== 'yes' && settlement.marketResult !== 'no')) continue
    const heldCount = position.side === 'yes' ? settlement.yesCount : settlement.noCount
    if (heldCount !== position.contracts) continue
    if (position.placedAt && Date.parse(settlement.settledTime) < position.placedAt) continue
    const outcome = outcomeFromKalshiResult(position, settlement.marketResult)
    if (!outcome || outcome === 'void') continue
    const costBasis = position.side === 'yes' ? settlement.yesTotalCostDollars : settlement.noTotalCostDollars
    const realPnl = settlement.revenueCents / 100 - costBasis - settlement.feeCostDollars
    state = settlePosition(state, position.id, outcome, 'kalshi', now(), realPnl)
    notices.push({ id: position.id, market: position.market, outcome, pnl: Math.round(realPnl * 100) / 100 })
  }
  if (notices.length) persist(state)
  return notices
}
