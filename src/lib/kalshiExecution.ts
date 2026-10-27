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
 *    Then read the balance of the market's own exchange shard and hold the same
 *    stake + fees against it — Kalshi partitions funds by shard and an order draws
 *    only on its market's shard, so the all-shards total alone cannot prove the
 *    order can be paid for (it read $100 while the market's shard held $0, and
 *    Kalshi refused with insufficient_shard_balance).
 * 3. The approval is recorded in the ledger BEFORE the order is sent, under a unique
 *    client_order_id, so a lost response can be resolved by lookup — never by blind retry.
 * 4. The fill Kalshi reports (real contracts, price, fee) is what the ledger records.
 *
 * Transport: direct from the browser first; if the browser cannot reach Kalshi (the request
 * itself fails — offline or CORS), the same signed request goes through the owner's relay
 * (relay/ route /v1/kalshi). Kalshi's signature does not cover the host, so it stays valid.
 */

import { effectiveKalshiRelayUrl, kalshiCredentialPresence, loadKalshiCredentials, loadKalshiEnv, type KalshiCredentials } from './kalshiAuth'
import {
  applyFundsCommand, categoryOfMarket, categoryRecords, categoryStakeMultiplier, crowdSettleNote, estimateFee, formatLimits,
  haltedMessage, loadFunds, money, outcomeFromKalshiResult, parseFundsCommand,
  recordKalshiFill, revertKalshiApproval, runFundsCommand, saveFunds, setOrderKey, settlePosition, summarize,
  NOT_SAVED_WARNING, type FundsPosition, type FundsState,
} from './fundsLedger'
import { loadOwnerScaffold, scaffoldPhases } from './ownerScaffold'
import { readKalshiBalanceBlock } from './kalshiBalanceDisplay'
import { KalshiApiError, KalshiNetworkError, createKalshiClient, orderForProposal, relayFallbackFetcher, type KalshiClient, type KalshiExistingOrder, type KalshiFetcher, type KalshiOrderLookup } from './kalshiTrade'

export interface KalshiFailureNote {
  stage: 'credentials' | 'quote' | 'balance' | 'approve' | 'place' | 'settle'
  message: string
  positionId?: string
  ticker?: string
  clientOrderId?: string
  httpStatus?: number
  runId?: string
}

export interface KalshiPlacedInfo {
  positionId: string
  ticker: string
  clientOrderId: string
  orderId: string
  fillCount: number
  runId?: string
}

/**
 * The irreversible journal entry every placed Kalshi order writes — one label for the
 * same event whether the order came from the owner's typed /funds approve (App) or from
 * the owner's autoapprove standing instruction (the funds_propose tool path).
 */
export function kalshiOrderPlacedJournalEntry(info: KalshiPlacedInfo): { kind: 'irreversible'; label: string } {
  return {
    kind: 'irreversible',
    label: `kalshi order ${info.orderId} placed (${info.ticker}, ${info.fillCount} contracts, client_order_id ${info.clientOrderId}) — a real order on the venue; it cannot be recalled, only settled or sold there`,
  }
}

export interface KalshiExecutionDeps {
  creds?: KalshiCredentials | null
  client?: KalshiClient
  /** Relay base URL for the transport fallback; '' disables it. Defaults to the Settings relay URL, then the build's relay. */
  relayUrl?: string
  now?: () => number
  /** Wait used before reconciling lookups (real time in the app; zero in tests). */
  delay?: (ms: number) => Promise<void>
  /** The app run driving this command. Provenance: stored on the position, the journal and
   *  failure contexts — never inside the client_order_id (a re-approve from a new run must
   *  reuse the same order key). */
  runId?: string
  /** Failure telemetry: every refusal and failure on the order path reports here. */
  onFailure?: (note: KalshiFailureNote) => void
  /** Fired once per placed order, after the fill is recorded. */
  onPlaced?: (info: KalshiPlacedInfo) => void
  /** Public-visitor mode: placement and auto-settle refuse outright. */
  visitor?: boolean
}

/**
 * The order path's transport: the shared direct-then-relay fallback (kalshiTrade's
 * relayFallbackFetcher) over the browser's global fetch. Kept as a named export here —
 * the market-data path in forgeTools wraps the same helper around its own bounded fetch.
 */
export function directThenRelayFetcher(relayUrl: string): KalshiFetcher {
  return relayFallbackFetcher((url, init) => fetch(url, init), relayUrl)
}

function resolveClient(deps: KalshiExecutionDeps): { creds: KalshiCredentials; client: KalshiClient } | null {
  const creds = deps.creds !== undefined ? deps.creds : loadKalshiCredentials()
  if (!creds) return null
  const client = deps.client ?? createKalshiClient(creds, directThenRelayFetcher(effectiveKalshiRelayUrl(deps.relayUrl)))
  return { creds, client }
}

/**
 * The no-credentials refusal names which half is missing: a typed-but-unsaved half is
 * the failure this wording exists for (Settings showed the key as entered while storage
 * never kept it), so the owner is told exactly what to re-save instead of a blanket
 * "no key" for a pair he can see on screen.
 */
function missingCredentialsRefusal(): string {
  const guidance = 'in Settings (the Kalshi section where the Brave key used to be) — a demo key first. The proposal is unchanged.'
  const presence = kalshiCredentialPresence()
  if (presence.keyId && !presence.privateKey) return `Not placed: no Kalshi private key saved in this browser (key ID is saved). Add your private key ${guidance}`
  if (!presence.keyId && presence.privateKey) return `Not placed: no Kalshi key ID saved in this browser (private key is saved). Add your key ID ${guidance}`
  return `Not placed: no Kalshi API key in this browser. Add your key ID and private key ${guidance}`
}

const isKalshi = (venue: string) => venue.trim().toLowerCase() === 'kalshi'
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`

/**
 * Why two status sets: auto-approve lets the model be the only decision-maker, so even
 * a merely-proposed sibling holds the auto-order — the owner has not reviewed this
 * market yet and a second order would stack. Approve-all processes a batch the owner
 * already asked to approve, so only a sibling with a committed order blocks it: a
 * sibling that is approved (an order may be live or Unknown at Kalshi under its kept
 * key) or placed (Kalshi filled it) is exposure — a merely-proposed sibling has
 * ordered nothing and may still take its turn later in the same pass.
 */
const AUTO_SIBLING_HOLD_STATUSES: ReadonlySet<FundsPosition['status']> = new Set(['proposed', 'approved', 'placed'])
const APPROVE_ALL_SIBLING_SKIP_STATUSES: ReadonlySet<FundsPosition['status']> = new Set(['approved', 'placed'])

/** Another position on the same venue and market in one of the given statuses. */
function siblingOnMarket(state: FundsState, position: FundsPosition, statuses: ReadonlySet<FundsPosition['status']>): FundsPosition | undefined {
  const venue = position.venue.trim().toLowerCase()
  const market = position.market.trim().toLowerCase()
  return state.positions.find(p =>
    p.id !== position.id &&
    p.venue.trim().toLowerCase() === venue &&
    p.market.trim().toLowerCase() === market &&
    statuses.has(p.status))
}

/** Persist, and say so when the browser would not keep it. Returns false when unsaved. */
function persist(state: FundsState): boolean {
  return saveFunds(state)
}

/**
 * Approvals currently placing, by position id. Two approves for the same position must
 * never run at once: each loads the ledger, waits on Kalshi, and writes the approval from
 * what it read — in parallel, both would send an order. The guard refuses the second one;
 * the ledger re-read before the approval write (step 3) covers the two-TAB case, which a
 * memory guard cannot see, and the attempt key is the last line of defence at Kalshi.
 */
const approvalsInFlight = new Set<string>()

async function executeApprove(id: string, deps: KalshiExecutionDeps): Promise<string> {
  if (approvalsInFlight.has(id)) {
    try {
      deps.onFailure?.({ stage: 'approve', message: `Duplicate approve for ${id} refused: a placement for it is already in flight.`, positionId: id, ...(deps.runId ? { runId: deps.runId } : {}) })
    } catch { /* telemetry never blocks */ }
    return `Not placed: ${id} is already being placed — wait for that attempt to finish before approving again. Nothing was sent.`
  }
  approvalsInFlight.add(id)
  try {
    return await executeApproveInner(id, deps)
  } finally {
    approvalsInFlight.delete(id)
  }
}

async function executeApproveInner(id: string, deps: KalshiExecutionDeps): Promise<string> {
  const now = deps.now ?? Date.now
  const delay = deps.delay ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
  let state = loadFunds()
  const position = state.positions.find(p => p.id === id)
  if (!position) return runFundsCommand(`/funds approve ${id}`) ?? `Not done: no position ${id}.`

  // Every refusal and failure on this path is reported to the failure log with its context
  // (the App wires onFailure to the error bus). Telemetry never blocks the order path.
  const note = (stage: KalshiFailureNote['stage'], message: string, extra?: Partial<KalshiFailureNote>) => {
    try {
      deps.onFailure?.({ stage, message, positionId: id, ticker: position.market, ...(deps.runId ? { runId: deps.runId } : {}), ...extra })
    } catch { /* the order path outranks its own telemetry */ }
  }

  if (deps.visitor) {
    note('credentials', `Kalshi placement refused for ${id}: visitor mode.`)
    return `Not placed: Kalshi trading is off in visitor mode. The proposal is unchanged.`
  }
  const resolved = resolveClient(deps)
  if (!resolved) {
    note('credentials', `Kalshi placement refused for ${id}: no API key in this browser.`)
    return missingCredentialsRefusal()
  }
  const { creds, client } = resolved
  const envNote = creds.env === 'demo' ? ' (demo exchange — fake money)' : ''

  // A resumed approval (an earlier attempt ended Unknown: approved, order key kept) never
  // sends, so the checks that protect a send — live price, edge, tolerance, Kalshi balance,
  // shard balance — do not apply to it, and must not stand in front of its reconciliation:
  // the earlier order may have landed, and a refusal saying "Nothing was spent" about a
  // position whose order is live is false (the fault-matrix harness found exactly that).
  // For a resume the price below is only the fallback for a fill price Kalshi's own record
  // lacks; a fresh approval replaces it with the live ask once the gates pass.
  const resumingEarly = position.status === 'approved' && !!position.clientOrderId
  let livePrice = position.price
  const preSendGates = async (): Promise<string | null> => {
    // 1. Re-quote at the live ask.
    let quote
    try {
      quote = await client.getMarketQuote(position.market)
    } catch (error) {
      if (error instanceof KalshiNetworkError) { note('quote', `No live price for ${position.market}: ${error.message}`, {}); return `Not placed: this browser could not reach Kalshi for a live price${deps.relayUrl === '' ? '' : ', and the relay fallback failed too'} (${error.message}). Nothing was spent; the proposal is unchanged.` }
      if (error instanceof KalshiApiError) { note('quote', `Kalshi refused the price check for ${position.market} (${error.code}: ${error.message}).`, { httpStatus: error.status }); return `Not placed: Kalshi refused the live price check (${error.code}: ${error.message}). Nothing was spent; the proposal is unchanged.` }
      throw error
    }
    if (!quote) { note('quote', `Kalshi has no market ${position.market}.`, {}); return `Not placed: Kalshi has no market ${position.market}. Nothing was spent; the proposal is unchanged.` }
    if (quote.status && quote.status !== 'active') {
      note('quote', `Market ${position.market} is ${quote.status}, not active.`, {})
      return `Not placed: ${position.market} is ${quote.status} on Kalshi, not active — no order goes into a market that is not trading. Nothing was spent; the proposal is unchanged.`
    }
    const quotedPrice = position.side === 'yes' ? quote.yesAsk : quote.noAsk
    if (quotedPrice === null || quotedPrice <= 0 || quotedPrice >= 1) {
      note('quote', `No ${position.side} offers on ${position.market}.`, {})
      return `Not placed: no ${position.side.toUpperCase()} contracts are offered on ${position.market} right now. Nothing was spent; the proposal is unchanged.`
    }
    // The edge must survive the fee at the live price — the same rule funds_propose applies.
    const feeAtLive = estimateFee('kalshi', position.contracts, quotedPrice)
    if (position.contracts * (position.probability - quotedPrice) <= feeAtLive + 1e-9) {
      note('quote', `No edge after fees on ${position.market} at ${quotedPrice}.`, {})
      return `Not placed: after fees there is no edge. Live price ${money(quotedPrice)} (${pct(quotedPrice)}) vs your estimate ${pct(position.probability)} — the expected gain on ${position.contracts} contracts does not cover the ~${money(feeAtLive)} fee. Nothing was spent; the proposal is unchanged.`
    }
    const tolerance = state.limits.toleranceCents / 100
    if (quotedPrice > position.price + tolerance + 1e-9) {
      note('quote', `Price moved past tolerance on ${position.market}: ${position.price} -> ${quotedPrice}.`, {})
      return `Not placed: the price moved from ${money(position.price)} to ${money(quotedPrice)}, past your tolerance of ${state.limits.toleranceCents}¢ (change it with /funds limits tolerance=<cents>). Nothing was spent; the proposal is unchanged.`
    }

    // 1b. The shard lock (owner ruling, 2026-10-23: "Lock it"): the quote reports the
    // market's shard as null when Kalshi's record carries no readable exchange_index.
    // A real order draws on exactly one shard, and a shard that cannot be determined
    // cannot be balance-checked — so a real proposal refuses here, before any balance
    // read, instead of inheriting a default shard it never verified. Paper proposals
    // move no money and are not gated on the shard.
    if (position.mode === 'real' && quote.exchangeIndex === null) {
      note('balance', `Shard could not be determined for ${position.market}: the market record carried no readable exchange_index.`, {})
      return `Not placed: the exchange shard for ${position.market} could not be determined from Kalshi's market record, so the balance this order would draw on cannot be verified. ForgeClaw will not guess a shard — a guessed shard is how an order gets checked against the wrong money. Nothing was spent; the proposal is unchanged.`
    }

    // 2. Balance gate against Kalshi's real balance.
    let balanceDollars: number
    try {
      balanceDollars = (await client.getBalance()).balanceDollars
    } catch (error) {
      if (error instanceof KalshiNetworkError) { note('balance', `Balance check unreachable for ${id}: ${error.message}`, {}); return `Not placed: this browser could not reach Kalshi to check your balance (${error.message}). Nothing was spent; the proposal is unchanged.` }
      if (error instanceof KalshiApiError) { note('balance', `Kalshi refused the balance check for ${id} (${error.code}: ${error.message}).`, { httpStatus: error.status }); return `Not placed: Kalshi refused the balance check (${error.code}: ${error.message}). Nothing was spent; the proposal is unchanged.` }
      throw error
    }
    const needed = position.contracts * quotedPrice + feeAtLive
    if (balanceDollars + 1e-9 < needed) {
      note('balance', `Balance ${balanceDollars} cannot cover ${needed} for ${id}.`, {})
      return `Not placed: your Kalshi balance is ${money(balanceDollars)}${envNote} but this order needs about ${money(needed)} (${position.contracts} contracts at ${money(quotedPrice)} + ~${money(feeAtLive)} fees). Nothing was spent; the proposal is unchanged.`
    }

    // 2b. Shard gate: Kalshi partitions the balance by exchange shard (the market
    // record's exchange_index), and an order draws only on its own market's shard —
    // the aggregate read above cannot prove that shard holds anything. Read the
    // market's shard and hold the same stake + fees against it. A shard whose
    // balance cannot be read is unverified, and an unverified shard is never
    // treated as funded: no order is sent either way. A null shard never reaches
    // here for a real proposal (the lock at 1b refused it); the guard below is
    // what keeps that true by construction.
    const shardIndex = quote.exchangeIndex
    if (shardIndex !== null) {
      let shardBalanceDollars: number
      try {
        shardBalanceDollars = (await client.getBalance(shardIndex)).balanceDollars
      } catch (error) {
        if (error instanceof KalshiNetworkError) { note('balance', `Shard ${shardIndex} balance check unreachable for ${id}: ${error.message}`, {}); return `Not placed: this browser could not reach Kalshi to verify your balance on shard ${shardIndex} (${error.message}). A shard whose balance cannot be verified is never treated as funded. Nothing was spent; the proposal is unchanged.` }
        if (error instanceof KalshiApiError) { note('balance', `Kalshi refused the shard ${shardIndex} balance check for ${id} (${error.code}: ${error.message}).`, { httpStatus: error.status }); return `Not placed: Kalshi refused the balance check for shard ${shardIndex} (${error.code}: ${error.message}), so that shard's balance could not be verified. Nothing was spent; the proposal is unchanged.` }
        throw error
      }
      if (shardBalanceDollars + 1e-9 < needed) {
        note('balance', `Shard ${shardIndex} balance ${shardBalanceDollars} cannot cover ${needed} for ${id} (aggregate ${balanceDollars}).`, {})
        return `Not placed: Kalshi splits your balance across exchange shards, and ${position.market} trades on shard ${shardIndex}, which holds ${money(shardBalanceDollars)}${envNote}. This order needs about ${money(needed)} (${position.contracts} contracts at ${money(quotedPrice)} + ~${money(feeAtLive)} fees). Your balance across all shards is ${money(balanceDollars)}, but an order can only draw on its own market's shard — the funds for this one sit on a different shard. ForgeClaw never moves funds between shards automatically (the Kalshi app moves them for you when you trade there). Nothing was spent; the proposal is unchanged.`
      }
    }
    livePrice = quotedPrice
    return null
  }
  // A halt (the owner's /funds halt or the loss stop) refuses a fresh send before any Kalshi read, so the reply names the
  // halt rather than whatever a price or balance check would have said. The ledger approval below refuses again on the
  // re-read, which also covers a halt typed while those reads were in flight. A resume only reconciles an order that may
  // already have landed and never sends, so a halt does not stand in front of it.
  if (!resumingEarly && state.halted) {
    note('approve', `Kalshi placement refused for ${id}: ${state.halted.reason}`)
    return `Not placed: ${haltedMessage(state.halted)} Nothing was sent; the proposal is unchanged.`
  }
  if (!resumingEarly) {
    const refusal = await preSendGates()
    if (refusal) return refusal
  }

  // 3. RE-READ the ledger, then record the approval and its order key and SAVE them —
  //    all before anything is sent. The re-read closes the two-tab race: this function
  //    loaded the ledger before two network waits, and another tab (or tap) may have
  //    approved or placed the position meanwhile; writing from the stale read would
  //    approve it twice. The attempt counter and the key move atomically with the
  //    approval, so no two sends can ever share an attempt. A resumed approval (an
  //    earlier attempt ended Unknown) reuses the stored key for its lookup only —
  //    it never sends under it again (the resume block below).
  const fresh = loadFunds()
  const current = fresh.positions.find(p => p.id === id)
  if (!current) return `Not done: no position ${id}.`
  if (current.status === 'placed') {
    note('approve', `${id} was already placed while its price was being checked; nothing sent.`, {})
    return `Not placed: ${id} was already placed while its price was being checked. Nothing was sent.`
  }
  let clientOrderId: string
  const resuming = current.status === 'approved' && !!current.clientOrderId
  // The gates were skipped because this started as a resume. If another tab has meanwhile put the
  // position back to proposed, this would now be a fresh send that never passed them: refuse.
  if (resumingEarly && !resuming && current.status === 'proposed') {
    note('approve', `${id} changed in another tab while it was being reconciled; nothing sent.`, {})
    return `Not placed: ${id} changed in another tab while it was being reconciled, so no order was sent. Type /funds approve ${id} again.`
  }
  if (current.status !== 'proposed' && !resuming) {
    note('approve', `${id} is ${current.status}, not waiting for approval; nothing sent.`, {})
    return `Not placed: ${id} is ${current.status}, not waiting for approval. Nothing was sent.`
  }
  if (resuming) {
    clientOrderId = current.clientOrderId!
    const refreshed = setOrderKey(fresh, id, clientOrderId, current.orderAttempt ?? 1, deps.runId)
    if (persist(refreshed)) state = refreshed
    else state = fresh
  } else {
    let approved: FundsState
    try {
      approved = applyFundsCommand(fresh, { kind: 'approve', id }, now()).state
    } catch (error) {
      note('approve', `Approval refused for ${id}: ${error instanceof Error ? error.message : String(error)}`, {})
      return `Not placed: ${error instanceof Error ? error.message : String(error)}`
    }
    const attempt = (current.orderAttempt ?? 0) + 1
    clientOrderId = `fc-${id}-${attempt}`
    approved = setOrderKey(approved, id, clientOrderId, attempt, deps.runId)
    if (!persist(approved)) {
      note('approve', `Ledger would not save before placing ${id}; no order sent.`, { clientOrderId })
      return `Not placed: the ledger could not be saved in this browser, so no order was sent.${NOT_SAVED_WARNING}`
    }
    state = approved
  }

  const order = orderForProposal({ side: position.side, livePrice, contracts: position.contracts })
  const placedMessage = (fillCount: number, avgPrice: number, feePaidTotal: number, orderId: string, recovered: boolean): string => {
    const partial = fillCount < position.contracts ? ` Partial fill: ${fillCount} of ${position.contracts} contracts; the rest was cancelled (immediate-or-cancel).` : ''
    return `Placed ${id}${recovered ? ' (the order went through; its response was lost and the fill was recovered by lookup)' : ''}: bought ${fillCount} ${position.side.toUpperCase()} on ${position.market} at ${money(avgPrice)} on Kalshi${envNote} — ${money(fillCount * avgPrice)} + ${money(feePaidTotal)} fees (order ${orderId}).${partial}\nIt settles from Kalshi automatically when the market resolves.`
  }
  const recordFill = (fillCount: number, avgPrice: number, feePaidTotal: number, orderId: string, recovered: boolean): string => {
    const next = recordKalshiFill(state, id, { fillCount, avgFillPrice: avgPrice, feePaid: feePaidTotal, orderId, clientOrderId }, now())
    const saved = persist(next)
    try {
      deps.onPlaced?.({ positionId: id, ticker: position.market, clientOrderId, orderId, fillCount, ...(deps.runId ? { runId: deps.runId } : {}) })
    } catch { /* journaling never blocks the record */ }
    return placedMessage(fillCount, avgPrice, feePaidTotal, orderId, recovered) + (saved ? '' : NOT_SAVED_WARNING)
  }
  // A CONFIRMED terminal no-fill: Kalshi's own records show the order filled nothing, or
  // Kalshi definitively refused it (non-409). Only then does the position go back to
  // proposed (the attempt stays consumed, so the next approve mints the next attempt's key).
  // "Nothing was spent" is claimed only from that evidence — never inferred from an error.
  const confirmedNoFill = (message: string, extra?: Partial<KalshiFailureNote>): string => {
    persist(revertKalshiApproval(state, id))
    note('place', message, { clientOrderId, ...extra })
    return message
  }
  // The lookup is tri-state and its states are never merged: a lookup that could not
  // complete (UNKNOWN) is not a miss, and a complete NOT_FOUND is not proof after an
  // ambiguous POST — whether orders placed through the V2 endpoint appear in this
  // lookup at all is unproven until the demo run, so NOT_FOUND authorizes nothing in
  // this file: anything short of FOUND ends at Unknown.
  const lookupSinceMs = position.approvedAt ?? now()
  const lookup = async (): Promise<KalshiOrderLookup> => {
    try {
      return await client.findOrderByClientOrderId(clientOrderId, position.market, lookupSinceMs)
    } catch (error) {
      return { kind: 'unknown', reason: error instanceof Error ? error.message : String(error) }
    }
  }
  const resolveFound = (found: KalshiExistingOrder, recovered: boolean): string => {
    if (found.fillCount > 0) {
      return recordFill(found.fillCount, found.averageFillPrice ?? livePrice, found.totalFees ?? estimateFee('kalshi', found.fillCount, found.averageFillPrice ?? livePrice), found.orderId, recovered)
    }
    return confirmedNoFill(`Not placed: the order did reach Kalshi (order ${found.orderId}, status ${found.status}) and filled nothing — confirmed from Kalshi's own order record. Nothing was spent; the proposal is back to proposed.`)
  }
  const unknownOutcome = (detail: string): string => {
    note('place', `Order outcome unknown for ${id}: ${detail}`, { clientOrderId })
    return `Unknown: ${detail} The approval stands — ${id} is approved, not placed, and its order key (${clientOrderId}) is kept. Check Kalshi manually; then type /funds approve ${id} again to reconcile under the same key, /funds placed ${id} <fill price> if you place it there yourself, or /funds reject ${id} to drop it. Nothing was resent blindly.`
  }
  // ALREADY_EXISTS (409) and every other ambiguous end state reconcile here: the first
  // lookup raced Kalshi's own indexing, so look again with backoff before concluding
  // anything. A rejection that means "order already exists" is reconciled, never read
  // as "nothing was spent".
  const reconcile = async (): Promise<string> => {
    let last: KalshiOrderLookup = { kind: 'unknown', reason: 'the lookup never ran' }
    for (const waitMs of [2000, 4000]) {
      await delay(waitMs)
      last = await lookup()
      if (last.kind === 'found') return resolveFound(last.order, true)
    }
    return unknownOutcome(last.kind === 'not_found'
      ? `Kalshi's completed order lookup found no order with id ${clientOrderId} — but a completed miss is not proof the order never landed, so nothing is claimed about what was spent.`
      : `Kalshi's order lookup could not be completed for id ${clientOrderId} (${last.kind === 'unknown' ? last.reason : 'no answer'}), so whether the order landed is unknown.`)
  }

  // A resumed approval NEVER sends. It looks the stored key up once: FOUND resolves
  // it; UNKNOWN and NOT_FOUND both end at Unknown with the approval standing and the
  // key kept. A complete miss cannot prove the first order never landed — whether
  // orders placed through the V2 endpoint appear in this lookup at all is unproven
  // until a demo run — so sending again could double the bet. To bet again, the
  // owner rejects the position and re-proposes it as a fresh approval.
  if (resuming) {
    const result = await lookup()
    if (result.kind === 'found') return resolveFound(result.order, true)
    if (result.kind === 'unknown') return unknownOutcome(`Kalshi's order lookup could not be completed for id ${clientOrderId} (${result.reason}), so the stored key was NOT resent — whether the earlier order landed is unknown.`)
    return unknownOutcome(`Kalshi's completed order lookup found no order under the kept key ${clientOrderId} — but a miss cannot prove the first order never landed: whether orders placed through the V2 endpoint appear in this lookup at all is unproven until a demo run, so nothing new was sent. To bet again, reject ${id} and re-propose it, so the bet goes through a fresh approval.`)
  }

  // 4. Send — once, under the recorded key. Only a fresh approval reaches this point:
  //    a resumed one returned in the block above and never sends. A lost response is
  //    resolved by lookup, never resent automatically; a 409 on this send (the key
  //    already exists at Kalshi) reconciles instead of reading as a refusal.
  type PostOutcome =
    | { kind: 'answered'; fillCount: number; avgPrice: number; feeTotal: number; orderId: string }
    | { kind: 'api'; error: KalshiApiError }
    | { kind: 'network' }
  const tryPost = async (): Promise<PostOutcome> => {
    try {
      const r = await client.createOrder({ ticker: position.market, side: order.side, count: order.count, priceDollars: order.priceDollars, clientOrderId })
      return { kind: 'answered', fillCount: r.fillCount, avgPrice: r.averageFillPrice ?? livePrice, feeTotal: Math.round((r.averageFeePaid ?? 0) * r.fillCount * 100) / 100, orderId: r.orderId }
    } catch (error) {
      if (error instanceof KalshiApiError) return { kind: 'api', error }
      if (error instanceof KalshiNetworkError) return { kind: 'network' }
      throw error
    }
  }

  const post = await tryPost()
  if (post.kind === 'network') {
    // No answer at all: the order may or may not have landed. There is NO automatic
    // resend — its safety rested on a duplicate-rejection guarantee nothing has proven
    // yet — and no manual one either: the owner's re-approve reconciles under the
    // same kept key but never sends again. Reconcile by lookup; anything short of
    // FOUND ends at Unknown.
    return reconcile()
  }
  if (post.kind === 'answered') {
    if (post.fillCount > 0) return recordFill(post.fillCount, post.avgPrice, post.feeTotal, post.orderId, false)
    return confirmedNoFill(`Nothing placed: the order filled 0 contracts at ${money(livePrice)} (immediate-or-cancel) — Kalshi's own response confirms the zero fill. Nothing was spent. The proposal is back to proposed; approve again to retry at the then-live price.`)
  }
  if (post.kind === 'api') {
    if (post.error.status === 409) return reconcile() // ALREADY_EXISTS: the order is real; go find it.
    if (post.error.status >= 500) return reconcile() // A 5xx may hide a taken order; reconcile before claiming anything.
    if (post.error.status === 408) return reconcile() // A timeout answer proves nothing about whether the order was taken — same ambiguity class as a 5xx, never a refusal.
    // A 429 is an answered refusal at Kalshi's gate, before matching (the rate_limits
    // page budgets order creation too): unlike a 409 or 5xx it cannot hide a taken
    // order, so it takes the confirmed-refusal path, not reconcile.
    if (post.error.status === 429) return confirmedNoFill(`Not placed: Kalshi rate-limited the order (HTTP 429) before it reached the exchange — nothing was spent. The proposal is back to proposed; wait a few seconds and approve again.`, { httpStatus: 429 })
    return confirmedNoFill(`Not placed: Kalshi refused the order (${post.error.code}: ${post.error.message}). Nothing was spent; the proposal is back to proposed.`, { httpStatus: post.error.status })
  }
  return reconcile() // Unreachable by the PostOutcome union; reconcile rather than claim anything.
}

/**
 * `/funds approve-all` (directive item 10): approve every waiting proposal, one at a time,
 * each through the exact single-approve path above — same re-quote, balance gate and
 * ledger rules, never a batch shortcut. Sequential on purpose: each approval re-reads the
 * ledger and Kalshi's balance, so an early fill shrinks what later approvals may spend.
 * One position's refusal or failure is reported in its own line and never stops the rest.
 * One order per market per pass: a proposal whose market already has a committed order
 * (approved or placed — including one placed earlier in this same pass) is skipped with
 * a named line, never a second POST.
 */
async function executeApproveAll(deps: KalshiExecutionDeps): Promise<string> {
  const ids = loadFunds().positions.filter(p => p.status === 'proposed').map(p => p.id)
  if (!ids.length) return 'Approve-all: no proposals are waiting.'
  const lines: string[] = []
  let placed = 0
  let approved = 0
  let refused = 0
  let unknown = 0
  for (const id of ids) {
    // One order per market per pass: a batch is approved blind, so a real Kalshi
    // proposal whose market already has a committed order (approved or placed —
    // including one placed earlier in this same pass) is skipped with a named line,
    // never a second POST. A merely-proposed sibling has ordered nothing and may
    // still take its turn later in the pass.
    const snap = loadFunds()
    const current = snap.positions.find(p => p.id === id)
    const sibling = current && current.mode === 'real' && isKalshi(current.venue)
      ? siblingOnMarket(snap, current, APPROVE_ALL_SIBLING_SKIP_STATUSES)
      : undefined
    if (current && sibling) {
      refused++
      lines.push(`Not placed: ${id} — another position (${sibling.id}) on ${current.market} is already ${sibling.status}, so this one was not ordered (one order per market per pass). The proposal is unchanged.`)
      continue
    }
    let reply: string
    try {
      reply = await runFundsCommandWithExecution(`/funds approve ${id}`, deps) ?? `Not done: no position ${id}.`
    } catch (error) {
      // executeApprove turns every expected failure into a reply; an unexpected throw is
      // still just this position's outcome — the rest of the batch must not lose its turn.
      reply = `Not placed: ${error instanceof Error ? error.message : String(error)}`
    }
    // The single-approve replies carry stable outcome prefixes (the same convention
    // App.tsx uses to mark a funds reply complete or blocked); count by them.
    if (reply.startsWith('Placed ')) placed++
    else if (reply.startsWith('Approved ')) approved++ // non-Kalshi: ledger approval, the owner places it on the venue
    else if (reply.startsWith('Unknown:')) unknown++
    else refused++
    lines.push(reply)
  }
  const counts = [`${placed} placed`, ...(approved ? [`${approved} approved (place on the venue yourself)`] : []), `${refused} refused`, `${unknown} unknown`]
  const countsLine = `${counts.join(', ')} of ${ids.length} proposals.`
  // Why the lead moves: the batch lead is also the app's completion signal —
  // App.tsx marks a funds reply BLOCKED when it starts with 'Unknown:' or
  // 'Not placed:'. A batch containing any Unknown must never read complete,
  // because the owner's Unknown rule (never re-approve an Unknown blind; the
  // owner reconciles under the same kept key) only fires on a blocked reply.
  // A batch that placed or ledger-approved nothing but refused something is
  // blocked for the same reason. The counts line stays after the lead so no
  // information is lost.
  const lead = unknown > 0
    ? `Unknown: ${countsLine}`
    : placed === 0 && approved === 0 && refused > 0
      ? `Not placed: ${countsLine}`
      : `Approve-all: ${countsLine}`
  return [lead, ...lines].join('\n')
}

/**
 * Auto-approve (directive item 10): when the owner has set `/funds limits autoapprove=<dollars>`
 * above zero, a real Kalshi proposal at or under that stake goes through the very same
 * approve-and-place path as the owner's typed `/funds approve <id>` — including the re-quote
 * and the balance gate — the moment it is proposed. Returns the execution reply, or null
 * when auto-approve does not apply (off, over the threshold, paper, not Kalshi, or a
 * sibling on the same market is already proposed/approved/placed: those keep waiting
 * for the owner). Called only from the funds_propose tool, after the proposal
 * is saved; the model cannot set the limit, so this stays the owner's standing instruction.
 */
/**
 * The auto-approve preconditions in one place (directive item 10): the owner's standing
 * instruction fires only for a real Kalshi proposal, waiting for approval, at or under
 * the set limit. The model cannot set the limit, only the owner can (/funds limits), so
 * this stays the owner's instruction.
 */
function autoApprovePreconditions(position: FundsPosition): boolean {
  if (position.mode !== 'real' || position.status !== 'proposed' || !isKalshi(position.venue)) return false
  const threshold = loadFunds().limits.autoApproveUnder
  if (!(threshold > 0)) return false
  // Compare in whole cents: stakes and limits are both cent amounts, and a float hair
  // under the threshold must not read as over it.
  if (Math.round(position.stake * 100) > Math.round(threshold * 100)) return false
  return true
}

export async function maybeAutoApprove(position: FundsPosition, deps: KalshiExecutionDeps = {}): Promise<string | null> {
  if (!autoApprovePreconditions(position)) return null
  // The model is the only decision-maker here, so a sibling on the same market in any
  // live state holds the auto-order: the proposal waits for the owner's tap, and the
  // tool path explains why through autoApproveHoldNote (re-proposing would stack a
  // second order on the market).
  if (siblingOnMarket(loadFunds(), position, AUTO_SIBLING_HOLD_STATUSES)) return null
  return runFundsCommandWithExecution(`/funds approve ${position.id}`, deps)
}

/**
 * Why the auto-approve did not fire, for the funds_propose output: mirrors
 * maybeAutoApprove's preconditions, so a proposal that was never auto-eligible says
 * nothing. When the owner set a limit and the proposal would otherwise have fired,
 * the model is told — once, plainly — to wait and not to re-propose the market.
 */
export function autoApproveHoldNote(position: FundsPosition): string | null {
  if (!autoApprovePreconditions(position)) return null
  const sibling = siblingOnMarket(loadFunds(), position, AUTO_SIBLING_HOLD_STATUSES)
  if (!sibling) return null
  return `Auto-approve held this proposal: ${sibling.id} on ${position.venue} "${position.market}" is already ${sibling.status}, so this one waits for the owner's /funds approve (one order per market). Do not re-propose this market — that would stack a second order on it.`
}

/**
 * One proposal as the master plan shows it: the bet, its sized stake, and the record it
 * stands on. The ledger carries no confidence or falsifier fields — the confidence shown
 * is the model's recorded probability, named as such, and the falsifier is reported
 * missing rather than invented. A proposal whose evidence was never recorded says so;
 * the plan exposing the gap is the point.
 */
function formatPlanBet(p: FundsPosition): string {
  const lines = [
    `${p.id} — ${p.venue} "${p.market}" ${p.side.toUpperCase()} x${p.contracts} @ ${money(p.price)} (proposed price)`,
    `  stake ${money(p.stake)} + ~${money(p.feeEstimate)} fees · category ${categoryOfMarket(p.market)}`,
  ]
  if (p.rationale.trim()) lines.push(`  evidence: ${p.rationale.trim()}`)
  if (p.sources.length) lines.push(`  sources: ${p.sources.join('; ')}`)
  if (!p.rationale.trim() && !p.sources.length) lines.push('  evidence: none recorded')
  lines.push(`  confidence: ${pct(p.probability)} (the model's recorded probability that this side wins)`)
  lines.push('  falsifier: missing — not recorded on this position')
  return lines.join('\n')
}

/**
 * `/funds plan` (directive item 13): the master plan, organized by the phases of the
 * owner's own framework, read from Settings at runtime (ownerScaffold.ts) — the phase
 * labels are the owner's; this code supplies only the funds facts under them. Read-only:
 * no orders, no money movement, not even a network call — the live re-quote belongs to
 * approve. Without framework text there is no plan: the command refuses plainly instead
 * of falling back to a template the owner never wrote.
 */
export function buildFundsPlan(deps: KalshiExecutionDeps = {}): string {
  const now = deps.now ?? Date.now
  const scaffold = loadOwnerScaffold()
  if (!scaffold.trim()) {
    return 'Funds plan: not built — the master plan is organized by the phases of your own framework, and no framework text is saved in Settings. Paste your framework into Settings first, then run /funds plan again.'
  }
  const state = loadFunds()
  const s = summarize(state, now())
  const env = deps.creds?.env ?? loadKalshiEnv()
  const count = (status: FundsPosition['status']) => state.positions.filter(p => p.status === status).length
  const cats = categoryRecords(state)
  const header = [
    env === 'demo' ? 'Funds master plan — Kalshi demo exchange (fake money)' : 'Funds master plan — Kalshi PRODUCTION (real money)',
    ...(state.halted ? [haltedMessage(state.halted)] : []),
    `Bankroll ${money(s.bankroll)} · available ${money(s.available)} · committed to open positions ${money(s.openStake)} · today ${money(s.settledToday)}`,
    `Limits: ${formatLimits(state.limits)}`,
    cats.length
      ? `Category records: ${cats.map(c => `${c.category} ${c.won}/${c.settled} won, ${money(c.netPnl)} net → stake ×${categoryStakeMultiplier(state, c.category)}`).join('; ')}`
      : 'Category records: none yet',
    `Open positions: ${count('proposed')} proposed · ${count('approved')} approved · ${count('placed')} placed · ${count('settled')} settled`,
  ]
  const proposed = state.positions.filter(p => p.status === 'proposed')
  const blocks = proposed.length ? proposed.map(formatPlanBet).join('\n') : 'No proposed positions.'
  const phases = scaffoldPhases(scaffold)
  if (!phases.length) {
    return [...header, 'No phase structure found in the saved framework, so the proposals are listed without phase sections:', blocks].join('\n')
  }
  // The framework is a reasoning pass over the whole plan, so every phase section walks
  // every proposal: this code cannot know which phase a bet belongs to without
  // reconstructing the framework's meaning, and the framework's meaning is the owner's.
  const sections = phases.map(phase => `${phase}\n${blocks}`)
  return [...header, ...sections].join('\n')
}

/**
 * The /funds entry point the app uses: identical to runFundsCommand, except approving a
 * Kalshi proposal executes the order (executeApprove) and bare status appends Kalshi's live
 * balance when a key is present.
 */
export async function runFundsCommandWithExecution(text: string, deps: KalshiExecutionDeps = {}): Promise<string | null> {
  const cmd = parseFundsCommand(text)
  if (!cmd) return null
  if (cmd.kind === 'approve-all') {
    return executeApproveAll(deps)
  }
  if (cmd.kind === 'plan') {
    return buildFundsPlan(deps)
  }
  if (cmd.kind === 'approve') {
    const state = loadFunds()
    const position = state.positions.find(p => p.id === cmd.id)
    if (position && position.mode === 'real' && isKalshi(position.venue) && (position.status === 'proposed' || (position.status === 'approved' && !!position.clientOrderId))) {
      return executeApprove(cmd.id, deps)
    }
    return runFundsCommand(text)
  }
  if (cmd.kind === 'status') {
    const base = runFundsCommand(text)
    const resolved = resolveClient(deps)
    if (!resolved || base === null) return base
    // The shared Kalshi (live) block (kalshiBalanceDisplay): per-shard balances,
    // timestamps, and the last-good/STALE fallback — the same block the funds_status
    // tool and the Funds panel show. The ledger above it stays the ledger.
    const block = await readKalshiBalanceBlock(resolved.client, { env: resolved.creds.env, now: deps.now })
    return `${base}\n${block}`
  }
  return runFundsCommand(text)
}

export interface SettledNotice { id: string; market: string; outcome: 'won' | 'lost'; pnl: number; /** How the crowd's lean compared with the result (fight positions with a scan only). */ crowd?: string }

/**
 * On app open: settle placed Kalshi positions from Kalshi's own settlements. A settlement is
 * applied only when its side count matches the position's contracts exactly and it settled
 * after the position was placed — a same-ticker manual trade in the Kalshi app must never be
 * absorbed into the ledger by coincidence. Anything unmatched is left for the owner.
 */
export async function autoSettleKalshiPositions(deps: KalshiExecutionDeps = {}): Promise<SettledNotice[]> {
  if (deps.visitor) return [] // Visitor mode never touches the owner's settlements.
  const resolved = resolveClient(deps)
  if (!resolved) return []
  const now = deps.now ?? Date.now
  let settlements
  try {
    settlements = await resolved.client.getSettlements()
  } catch (error) {
    try {
      deps.onFailure?.({ stage: 'settle', message: `Kalshi settlements could not be read on open: ${error instanceof Error ? error.message : String(error)}`, ...(error instanceof KalshiApiError ? { httpStatus: error.status } : {}) })
    } catch { /* best effort on open; the next open retries */ }
    return []
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
    // Stamp the position with when Kalshi settled it, not when this open read it (never in the future).
    const settledMs = Date.parse(settlement.settledTime)
    state = settlePosition(state, position.id, outcome, 'kalshi', now(), realPnl, Number.isFinite(settledMs) ? Math.min(settledMs, now()) : undefined)
    const crowd = crowdSettleNote(state.positions.find(p => p.id === position.id)!)
    notices.push({ id: position.id, market: position.market, outcome, pnl: Math.round(realPnl * 100) / 100, ...(crowd ? { crowd } : {}) })
  }
  if (notices.length) persist(state)
  return notices
}
