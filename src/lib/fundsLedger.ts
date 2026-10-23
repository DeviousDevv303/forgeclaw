// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

/**
 * The owner's funds ledger: the money the owner puts in, the positions ForgeClaw proposes with it,
 * and how they turn out. ForgeClaw never holds or moves money. The funds sit at the venue (Kalshi,
 * a sportsbook, a broker); this ledger records them so ForgeClaw can plan against the real bankroll.
 *
 * Authority split, enforced here and in forgeTools.ts:
 * - The OWNER (typed /funds commands only) adds and withdraws funds, approves or rejects proposals,
 *   confirms an order was placed, settles non-Kalshi positions and sets the limits.
 * - A MODEL (tools) can read the ledger, propose positions, and settle a Kalshi position only from
 *   Kalshi's own published result. It cannot approve, place, or move money.
 *
 * Positions are binary: a contract that pays $1 if its side wins, bought at `price` (0-1). Any
 * yes/no bet fits: a sportsbook's decimal odds d is price 1/d.
 */

import { safeGetItem, safeSetItem } from './storage'

export const FUNDS_STORAGE_KEY = 'forgeclaw_funds_v1'

export type PositionMode = 'paper' | 'real'
export type PositionStatus = 'proposed' | 'approved' | 'placed' | 'settled' | 'rejected'
export type PositionOutcome = 'won' | 'lost' | 'void'

export interface FundsMovement {
  id: string
  at: number
  kind: 'deposit' | 'withdraw'
  amount: number
  note?: string
}

export interface FundsPosition {
  id: string
  createdAt: number
  mode: PositionMode
  venue: string
  market: string
  side: 'yes' | 'no'
  /** What one contract costs (0-1); it pays $1 if the side wins. */
  price: number
  /** The model's own probability that the side wins. */
  probability: number
  contracts: number
  stake: number
  feeEstimate: number
  rationale: string
  sources: string[]
  status: PositionStatus
  approvedAt?: number
  placedAt?: number
  fillPrice?: number
  /** Set when ForgeClaw itself placed the order on Kalshi (kalshiExecution.ts). */
  clientOrderId?: string
  kalshiOrderId?: string
  /** The real fee Kalshi charged for the fill, when ForgeClaw placed the order itself. */
  feePaid?: number
  /**
   * Placement attempt counter behind the Kalshi client_order_id (`fc-<id>-<attempt>`). It is
   * persisted with the approval BEFORE the order is sent, and moves up only after a CONFIRMED
   * terminal no-fill (Kalshi's own order record shows 0 fills, or a non-409 refusal) — so a
   * retry after an ambiguous failure reuses the same key, and Kalshi's duplicate rejection
   * (409, ALREADY_EXISTS) protects the position instead of defeating it. Never a timestamp:
   * a fresh key per try is what turns a lost response into a second order.
   */
  orderAttempt?: number
  /** The app run that placed (or last attempted to place) this order. Provenance only — never part of the order key. */
  runId?: string
  settledAt?: number
  outcome?: PositionOutcome
  pnl?: number
  settledBy?: 'owner' | 'kalshi'
}

export interface FundsLimits {
  /** Largest single stake, % of bankroll. */
  maxStakePct: number
  /** All open real stakes together, % of bankroll. */
  maxExposurePct: number
  /** Settled real losses today reaching this % of the day's starting bankroll HALT the ledger until the owner resumes it. */
  dailyLossPct: number
  /** Fraction of the Kelly stake used (1 = full Kelly). */
  kellyFraction: number
  /** Most money that may ever be put in (deposits minus withdrawals), in dollars; 0 = not set. Must be set before any deposit. */
  capAmount: number
  /** Phantom bankroll paper positions are sized against (dollars). */
  paperBankroll: number
  /** How far above the approved price the live price may be at approval before ForgeClaw refuses to place (cents). */
  toleranceCents: number
  /**
   * Proposals whose stake is at or under this many dollars are approved (and, on Kalshi,
   * placed) the moment they are proposed, through the same execution path as a manual
   * approve. 0 = off: every proposal waits for the owner. The owner opted in by setting it;
   * only a /funds limits command can change it, never a tool.
   */
  autoApproveUnder: number
}

export interface FundsState {
  version: 1
  movements: FundsMovement[]
  positions: FundsPosition[]
  limits: FundsLimits
  nextId: number
  /** Set by the loss stop; only the owner's /funds resume clears it. No tool can. */
  halted?: { at: number; reason: string }
  /** The owner's own rules, given to every funds plan. Only the owner adds or removes them. */
  rules?: string[]
}

export const DEFAULT_LIMITS: FundsLimits = { maxStakePct: 5, maxExposurePct: 30, dailyLossPct: 10, kellyFraction: 0.25, capAmount: 0, paperBankroll: 1000, toleranceCents: 2, autoApproveUnder: 0 }

export function emptyFunds(): FundsState {
  return { version: 1, movements: [], positions: [], limits: { ...DEFAULT_LIMITS }, nextId: 1, rules: [] }
}

export class FundsError extends Error {}

const cents = (n: number) => Math.round(n * 100) / 100
export const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(cents(n)).toFixed(2)}`
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`

// ── Fees ───────────────────────────────────────────────────────────────────────

/**
 * Kalshi's published taker fee: 0.07 x contracts x price x (1 - price), rounded up to the cent.
 * An estimate: Kalshi can change its schedule and some markets differ. Other venues: 0 unless given.
 */
export function estimateFee(venue: string, contracts: number, price: number): number {
  if (!/kalshi/i.test(venue) || contracts <= 0) return 0
  return Math.ceil(0.07 * contracts * price * (1 - price) * 100 - 1e-9) / 100
}

// ── Bankroll ───────────────────────────────────────────────────────────────────

export interface FundsSummary {
  deposited: number
  withdrawn: number
  realizedPnl: number
  bankroll: number
  openStake: number
  available: number
  paperPnl: number
  settledToday: number
  /** Phantom bankroll + paper P/L, and what open paper positions commit of it. */
  paperBankroll: number
  paperOpenStake: number
  paperAvailable: number
}

const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime() }

export function summarize(state: FundsState, nowMs: number): FundsSummary {
  const deposited = state.movements.filter(m => m.kind === 'deposit').reduce((s, m) => s + m.amount, 0)
  const withdrawn = state.movements.filter(m => m.kind === 'withdraw').reduce((s, m) => s + m.amount, 0)
  const real = state.positions.filter(p => p.mode === 'real')
  const realizedPnl = real.filter(p => p.status === 'settled').reduce((s, p) => s + (p.pnl ?? 0), 0)
  const bankroll = deposited - withdrawn + realizedPnl
  const openStake = real.filter(p => p.status === 'approved' || p.status === 'placed').reduce((s, p) => s + p.stake + p.feeEstimate, 0)
  const paper = state.positions.filter(p => p.mode === 'paper')
  const paperPnl = paper.filter(p => p.status === 'settled').reduce((s, p) => s + (p.pnl ?? 0), 0)
  const paperBankroll = state.limits.paperBankroll + paperPnl
  const paperOpenStake = paper.filter(p => p.status === 'placed').reduce((s, p) => s + p.stake + p.feeEstimate, 0)
  const dayStart = startOfDay(nowMs)
  const settledToday = real.filter(p => p.status === 'settled' && (p.settledAt ?? 0) >= dayStart).reduce((s, p) => s + (p.pnl ?? 0), 0)
  return {
    deposited: cents(deposited), withdrawn: cents(withdrawn), realizedPnl: cents(realizedPnl), bankroll: cents(bankroll),
    openStake: cents(openStake), available: cents(bankroll - openStake), paperPnl: cents(paperPnl), settledToday: cents(settledToday),
    paperBankroll: cents(paperBankroll), paperOpenStake: cents(paperOpenStake), paperAvailable: cents(paperBankroll - paperOpenStake),
  }
}

// ── Category learning (PR B item 11) ───────────────────────────────────────────

/**
 * A position's category is its market series: the ticker segment before the first '-'
 * (KXHIGHNY-26OCT23-T75 → KXHIGHNY) — the same series kalshi_markets filters by with
 * series_ticker. A market string with no '-' (a free-text market on another venue) is
 * its own category.
 */
export function categoryOfMarket(market: string): string {
  const t = market.trim()
  const dash = t.indexOf('-')
  return dash > 0 ? t.slice(0, dash) : t
}

export interface CategoryRecord {
  category: string
  settled: number
  won: number
  netPnl: number
}

/**
 * The settled record per category, from won/lost positions (void excluded, like
 * trackRecord). Paper positions count: they settle from the same published results,
 * so they are evidence about the model's probabilities in that series too.
 */
export function categoryRecords(state: FundsState): CategoryRecord[] {
  const byCategory = new Map<string, CategoryRecord>()
  for (const p of state.positions) {
    if (p.status !== 'settled' || (p.outcome !== 'won' && p.outcome !== 'lost')) continue
    const category = categoryOfMarket(p.market)
    const r = byCategory.get(category) ?? { category, settled: 0, won: 0, netPnl: 0 }
    r.settled++
    if (p.outcome === 'won') r.won++
    r.netPnl = cents(r.netPnl + (p.pnl ?? 0))
    byCategory.set(category, r)
  }
  return [...byCategory.values()].sort((a, b) => a.category.localeCompare(b.category))
}

/** Fewer settled positions than this in a series is luck, not a record: the series is unproven. */
export const CATEGORY_MIN_SAMPLE = 5
/**
 * Unproven series are staked at half: the model earns full size in a series only with
 * settled evidence, so a new market type cannot be sized like a proven one on day one.
 */
export const CATEGORY_UNPROVEN_MULTIPLIER = 0.5
/**
 * A series that lost money over a real sample drops to a quarter until its net P/L turns
 * non-negative: losses compound, so a proven loser shrinks harder than an unproven series.
 */
export const CATEGORY_LOSING_MULTIPLIER = 0.25

/**
 * The stake multiplier a category's record earns. Learning may only shrink stakes —
 * the best record returns exactly 1, so sizing never exceeds what the cage (Kelly,
 * stake/exposure caps) already allows.
 */
export function stakeMultiplierFor(record: Pick<CategoryRecord, 'settled' | 'netPnl'> | undefined): number {
  if (!record || record.settled < CATEGORY_MIN_SAMPLE) return CATEGORY_UNPROVEN_MULTIPLIER
  return record.netPnl < 0 ? CATEGORY_LOSING_MULTIPLIER : 1
}

export function categoryStakeMultiplier(state: FundsState, category: string): number {
  return stakeMultiplierFor(categoryRecords(state).find(r => r.category === category))
}

// ── Sizing ─────────────────────────────────────────────────────────────────────

export interface ProposalInput {
  mode?: PositionMode
  venue: string
  market: string
  side: 'yes' | 'no'
  price: number
  probability: number
  rationale: string
  sources: string[]
  /** Optional cap the model asks for; sizing never exceeds the limits whatever it says. */
  maxStake?: number
}

export interface Sizing {
  edge: number
  kellyFull: number
  contracts: number
  stake: number
  fee: number
  expectedProfit: number
  binding: string
  /** The market series this proposal belongs to (see categoryOfMarket). */
  category: string
  /** Stake multiplier from the category's settled record: 1, or less while unproven or losing. */
  categoryMultiplier: number
}

/** Kelly for a $1 binary bought at price P with win chance p: f* = (p - P) / (1 - P). */
export function sizePosition(input: ProposalInput, state: FundsState, nowMs: number): Sizing {
  const { price: P, probability: p } = input
  const s = summarize(state, nowMs)
  const L = state.limits
  // Paper positions are sized exactly like real ones, against the phantom bankroll.
  const paper = input.mode === 'paper'
  const bankroll = paper ? s.paperBankroll : s.bankroll
  const open = paper ? s.paperOpenStake : s.openStake
  const available = paper ? s.paperAvailable : s.available
  const of = paper ? 'paper bankroll' : 'bankroll'
  const edge = p - P
  const kellyFull = edge > 0 ? edge / (1 - P) : 0
  const caps: Array<[string, number]> = [
    [`${L.kellyFraction}x Kelly`, L.kellyFraction * kellyFull * bankroll],
    [`max stake ${L.maxStakePct}% of ${of}`, (L.maxStakePct / 100) * bankroll],
    [`max exposure ${L.maxExposurePct}% of ${of}`, (L.maxExposurePct / 100) * bankroll - open],
    [paper ? 'available paper funds' : 'available funds', available],
  ]
  if (input.maxStake !== undefined && input.maxStake > 0) caps.push(['requested max stake', input.maxStake])
  const [capName, capBudget] = caps.reduce((min, c) => (c[1] < min[1] ? c : min))
  // Learning stakes (item 11): the category's settled record scales the budget down while the
  // series is unproven or losing. It only ever shrinks the cage's answer, never grows it.
  const category = categoryOfMarket(input.market)
  const categoryMultiplier = categoryStakeMultiplier(state, category)
  const budget = capBudget * categoryMultiplier
  const binding = categoryMultiplier < 1 ? `${capName} × ${categoryMultiplier} category record (${category})` : capName
  // Fees come out of the same budget, so shrink until stake + fee fits.
  let contracts = Math.max(0, Math.floor(budget / P))
  while (contracts > 0 && contracts * P + estimateFee(input.venue, contracts, P) > budget + 1e-9) contracts--
  const fee = estimateFee(input.venue, contracts, P)
  const stake = cents(contracts * P)
  return { edge, kellyFull, contracts, stake, fee, expectedProfit: cents(contracts * edge - fee), binding, category, categoryMultiplier }
}

// ── Model actions ──────────────────────────────────────────────────────────────

export const haltedMessage = (h: { reason: string }) => `HALTED: ${h.reason} No real proposals or approvals until the owner types /funds resume.`

/** True once today's settled real losses reach the daily limit (of the bankroll at the start of the day). */
export function dailyLossHit(state: FundsState, nowMs: number): boolean {
  // daily=0 means the owner turned the loss stop off (directive item 7); without this guard
  // the formula below halts on any losing day, the opposite of off.
  if (state.limits.dailyLossPct <= 0) return false
  const s = summarize(state, nowMs)
  return s.settledToday < 0 && -s.settledToday >= (state.limits.dailyLossPct / 100) * (s.bankroll - s.settledToday)
}

const inUnit = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 1

export function proposePosition(state: FundsState, input: ProposalInput, nowMs: number): { state: FundsState; position: FundsPosition; sizing: Sizing } {
  const mode: PositionMode = input.mode === 'paper' ? 'paper' : 'real'
  if (!inUnit(input.price)) throw new FundsError('price must be between 0 and 1 (what one $1 contract costs).')
  if (!inUnit(input.probability)) throw new FundsError('probability must be between 0 and 1 (your own estimate that this side wins).')
  if (input.side !== 'yes' && input.side !== 'no') throw new FundsError('side must be "yes" or "no".')
  if (!input.market.trim() || !input.venue.trim()) throw new FundsError('venue and market are required.')
  if (input.rationale.trim().length < 40) throw new FundsError('rationale must explain the evidence behind your probability (40+ characters).')
  const sources = input.sources.map(s => s.trim()).filter(Boolean)
  if (!sources.length) throw new FundsError('at least one source is required: research before proposing.')
  const s = summarize(state, nowMs)
  if (mode === 'real' && s.bankroll <= 0) throw new FundsError('No funds in the ledger. The owner adds them with /funds add <amount>.')
  if (mode === 'paper' && s.paperBankroll <= 0) throw new FundsError('The paper bankroll is used up. The owner can reset it with /funds limits paper=<amount>.')
  if (mode === 'real' && state.halted) throw new FundsError(haltedMessage(state.halted))
  const sizing = sizePosition({ ...input, mode }, state, nowMs)
  if (sizing.edge <= 0) {
    throw new FundsError(`No edge: your probability ${pct(input.probability)} does not beat the price ${money(input.price)} (${pct(input.price)}). Not proposed.`)
  }
  if (sizing.contracts < 1) throw new FundsError(`Stake rounds to zero contracts (limited by ${sizing.binding}). Not proposed.`)
  if (sizing.expectedProfit <= 0) throw new FundsError(`Edge is eaten by fees (expected ${money(sizing.expectedProfit)} after ${money(sizing.fee)} fees). Not proposed.`)
  const position: FundsPosition = {
    id: `p${state.nextId}`, createdAt: nowMs, mode, venue: input.venue.trim(), market: input.market.trim(), side: input.side,
    price: input.price, probability: input.probability, contracts: sizing.contracts, stake: sizing.stake, feeEstimate: sizing.fee,
    rationale: input.rationale.trim().slice(0, 2000), sources: sources.slice(0, 10).map(x => x.slice(0, 300)),
    // A paper position needs no approval: no money is involved.
    status: mode === 'paper' ? 'placed' : 'proposed', ...(mode === 'paper' ? { placedAt: nowMs } : {}),
  }
  return { state: { ...state, positions: [...state.positions, position], nextId: state.nextId + 1 }, position, sizing }
}

export function pnlFor(position: FundsPosition, outcome: PositionOutcome): number {
  if (outcome === 'void') return 0
  const fill = position.fillPrice ?? position.price
  // The real fee Kalshi charged beats the estimate whenever ForgeClaw placed the order itself.
  const fee = position.feePaid ?? position.feeEstimate
  return cents(outcome === 'won' ? position.contracts * (1 - fill) - fee : -(position.contracts * fill) - fee)
}

function updatePosition(state: FundsState, id: string, change: (p: FundsPosition) => FundsPosition): FundsState {
  const idx = state.positions.findIndex(p => p.id === id)
  if (idx < 0) throw new FundsError(`No position ${id}.`)
  const positions = state.positions.slice()
  positions[idx] = change(positions[idx])
  return { ...state, positions }
}

export function settlePosition(state: FundsState, id: string, outcome: PositionOutcome, by: 'owner' | 'kalshi', nowMs: number, realPnl?: number): FundsState {
  const next = updatePosition(state, id, p => {
    if (p.status !== 'placed') throw new FundsError(`${id} is ${p.status}; only a placed position can be settled.`)
    // Kalshi's own settlement (revenue minus the position's cost basis) is the money truth when
    // the caller has it; otherwise the ledger's fill-based computation stands.
    return { ...p, status: 'settled', outcome, pnl: realPnl !== undefined ? cents(realPnl) : pnlFor(p, outcome), settledAt: nowMs, settledBy: by }
  })
  // The loss stop latches: it stays on past midnight until the owner resumes.
  if (!next.halted && dailyLossHit(next, nowMs)) {
    const s = summarize(next, nowMs)
    return { ...next, halted: { at: nowMs, reason: `Daily loss limit hit (${money(s.settledToday)} today, limit ${next.limits.dailyLossPct}%).` } }
  }
  return next
}

/** Kalshi's market `result` ("yes"/"no") decides the outcome; anything else is not settled yet. */
export function outcomeFromKalshiResult(position: FundsPosition, result: string | undefined): PositionOutcome | null {
  if (result !== 'yes' && result !== 'no') return null
  return result === position.side ? 'won' : 'lost'
}

// ── Kalshi self-placement records (written only by kalshiExecution.ts) ─────────

export interface KalshiFillRecord {
  fillCount: number
  avgFillPrice: number
  /** Total fee Kalshi charged for these fills, in dollars. */
  feePaid: number
  orderId: string
  clientOrderId: string
}

/** Record what Kalshi actually filled for an approved position: real contracts, price and fee. */
export function recordKalshiFill(state: FundsState, id: string, fill: KalshiFillRecord, nowMs: number): FundsState {
  return updatePosition(state, id, p => {
    if (p.status !== 'approved') throw new FundsError(`${id} is ${p.status}; only an approved position can be recorded as placed.`)
    return {
      ...p, status: 'placed', placedAt: nowMs, contracts: fill.fillCount, fillPrice: fill.avgFillPrice,
      stake: cents(fill.fillCount * fill.avgFillPrice), feeEstimate: fill.feePaid, feePaid: fill.feePaid,
      kalshiOrderId: fill.orderId, clientOrderId: fill.clientOrderId,
    }
  })
}

/** Undo an approval nothing came of (zero fill, or Kalshi refused): the proposal stands again. */
export function revertKalshiApproval(state: FundsState, id: string): FundsState {
  return updatePosition(state, id, p => {
    if (p.status !== 'approved') throw new FundsError(`${id} is ${p.status}; only an approved position can be reverted.`)
    return { ...p, status: 'proposed', approvedAt: undefined, clientOrderId: undefined, runId: undefined }
  })
}

/** Attach the client order id an approval will place under, before the order is sent. */
export function setClientOrderId(state: FundsState, id: string, clientOrderId: string): FundsState {
  return updatePosition(state, id, p => ({ ...p, clientOrderId }))
}

/**
 * Record the order key for an approval BEFORE the order is sent: the client_order_id, the
 * attempt it belongs to, and the placing run's id (provenance). Persisted atomically with
 * the approval (the caller saves before sending), so two sends can never share an attempt.
 */
export function setOrderKey(state: FundsState, id: string, clientOrderId: string, attempt: number, runId?: string): FundsState {
  return updatePosition(state, id, p => ({ ...p, clientOrderId, orderAttempt: attempt, ...(runId ? { runId } : {}) }))
}

// ── Owner commands (/funds …) ──────────────────────────────────────────────────

export type FundsCommand =
  | { kind: 'status' }
  | { kind: 'deposit' | 'withdraw'; amount: number; note?: string }
  | { kind: 'approve' | 'reject'; id: string }
  | { kind: 'approve-all' }
  | { kind: 'plan' }
  | { kind: 'placed'; id: string; fillPrice?: number }
  | { kind: 'settle'; id: string; outcome: PositionOutcome }
  | { kind: 'limits'; changes: Partial<FundsLimits> }
  | { kind: 'resume' }
  | { kind: 'rule'; text: string }
  | { kind: 'unrule'; index: number }
  | { kind: 'rules' }
  | { kind: 'usage'; message: string }

export const FUNDS_USAGE = [
  'Funds commands (you only; a model cannot run them):',
  '/funds — bankroll, open positions, track record',
  '/funds add <amount> [where it is held] — record money you put in (it stays at your venue)',
  '/funds withdraw <amount> [note]',
  '/funds approve <id> | /funds reject <id> — decide on a proposal (approving a Kalshi proposal places the order on Kalshi at the live price)',
  '/funds approve-all — approve every waiting proposal, one by one, each through the same live-price checks as a single approve',
  '/funds plan — the master plan, organized by the phases of your framework in Settings: snapshot, then every proposal with its evidence, confidence and falsifier',
  '/funds placed <id> [fill price] — confirm you placed the order on the venue yourself',
  '/funds settle <id> won|lost|void — record the result (Kalshi positions can also settle from Kalshi)',
  '/funds limits [cap=1000] [paper=1000] [stake=5] [exposure=30] [daily=10] [kelly=0.25] [tolerance=2] [autoapprove=25] — cap, paper bankroll and autoapprove in dollars; others % of bankroll; kelly a fraction; tolerance in cents; autoapprove 0 = off',
  '/funds resume — lift a loss-stop halt (only you can)',
  '/funds rule <your rule> · /funds rules · /funds unrule <n> — your own rules, given to every plan',
].join('\n')

const ID_RE = /^p\d+$/i

export function parseFundsCommand(text: string): FundsCommand | null {
  const m = /^\/funds(?:\s+([\s\S]*))?$/i.exec(text.trim())
  if (!m) return null
  const [verbRaw = '', ...rest] = (m[1] ?? '').trim().split(/\s+/).filter(Boolean)
  const verb = verbRaw.toLowerCase()
  const usage = (why: string): FundsCommand => ({ kind: 'usage', message: `${why}\n\n${FUNDS_USAGE}` })
  if (!verb || verb === 'status') return { kind: 'status' }
  if (verb === 'help') return usage('Funds ledger.')
  if (verb === 'approve-all') return { kind: 'approve-all' }
  if (verb === 'plan') return { kind: 'plan' }
  if (verb === 'add' || verb === 'deposit' || verb === 'withdraw') {
    const amount = Number((rest[0] ?? '').replace(/[$,]/g, ''))
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) return usage('Give a positive amount, e.g. /funds add 500 kalshi')
    const note = rest.slice(1).join(' ').slice(0, 200) || undefined
    return { kind: verb === 'withdraw' ? 'withdraw' : 'deposit', amount: cents(amount), note }
  }
  if (verb === 'approve' || verb === 'reject' || verb === 'placed' || verb === 'settle') {
    const id = (rest[0] ?? '').toLowerCase()
    if (!ID_RE.test(id)) return usage(`Give a position id, e.g. /funds ${verb} p3`)
    if (verb === 'approve' || verb === 'reject') return { kind: verb, id }
    if (verb === 'placed') {
      if (rest[1] === undefined) return { kind: 'placed', id }
      const fill = Number(rest[1].replace(/^\$/, ''))
      if (!inUnit(fill)) return usage('Fill price must be between 0 and 1, e.g. /funds placed p3 0.42')
      return { kind: 'placed', id, fillPrice: fill }
    }
    const outcome = (rest[1] ?? '').toLowerCase()
    if (outcome !== 'won' && outcome !== 'lost' && outcome !== 'void') return usage(`Say won, lost or void, e.g. /funds settle ${id} won`)
    return { kind: 'settle', id, outcome }
  }
  if (verb === 'resume') return { kind: 'resume' }
  if (verb === 'rules') return { kind: 'rules' }
  if (verb === 'rule') {
    const ruleText = rest.join(' ').trim()
    if (ruleText.length < 3 || ruleText.length > 300) return usage('Write the rule after the command, e.g. /funds rule never bet on games my own team plays')
    return { kind: 'rule', text: ruleText }
  }
  if (verb === 'unrule') {
    const index = Number(rest[0])
    if (!Number.isInteger(index) || index < 1) return usage('Give the rule number from /funds rules, e.g. /funds unrule 2')
    return { kind: 'unrule', index }
  }
  if (verb === 'limits') {
    const keys: Record<string, keyof FundsLimits> = { cap: 'capAmount', paper: 'paperBankroll', stake: 'maxStakePct', exposure: 'maxExposurePct', daily: 'dailyLossPct', kelly: 'kellyFraction', tolerance: 'toleranceCents', autoapprove: 'autoApproveUnder' }
    const changes: Partial<FundsLimits> = {}
    for (const part of rest) {
      const [k, v] = part.split('=')
      const key = keys[(k ?? '').toLowerCase()]
      const n = Number(v)
      // Zero is meaningful for tolerance (place only at exactly the approved price), cap (no cap),
      // daily (loss stop off) and autoapprove (auto-approve off) — the owner's locks are optional (directive item 7).
      const zeroOk = key === 'toleranceCents' || key === 'capAmount' || key === 'dailyLossPct' || key === 'autoApproveUnder'
      if (!key || !Number.isFinite(n) || (zeroOk ? n < 0 : n <= 0)) return usage(`Bad limit "${part}".`)
      if (key === 'capAmount' || key === 'paperBankroll' || key === 'autoApproveUnder' ? n > 1e9 : key === 'kellyFraction' ? n > 1 : key === 'toleranceCents' ? n > 99 : n > 100) return usage(`"${part}" is out of range (percentages up to 100, kelly up to 1, tolerance up to 99 cents).`)
      changes[key] = n
    }
    return { kind: 'limits', changes }
  }
  return usage(`Unknown funds command "${verb}".`)
}

export function applyFundsCommand(state: FundsState, cmd: FundsCommand, nowMs: number): { state: FundsState; message: string } {
  switch (cmd.kind) {
    case 'status':
    case 'usage':
      return { state, message: cmd.kind === 'usage' ? cmd.message : formatFundsStatus(state, nowMs) }
    case 'deposit':
    case 'withdraw': {
      if (cmd.kind === 'withdraw' && cmd.amount > summarize(state, nowMs).available + 1e-9) {
        throw new FundsError(`Only ${money(summarize(state, nowMs).available)} is available (the rest backs open positions).`)
      }
      if (cmd.kind === 'deposit' && state.limits.capAmount > 0) {
        const s = summarize(state, nowMs)
        const netIn = s.deposited - s.withdrawn
        if (netIn + cmd.amount > state.limits.capAmount + 1e-9) {
          throw new FundsError(`That would put ${money(netIn + cmd.amount)} in, over your cap of ${money(state.limits.capAmount)} (${money(Math.max(0, state.limits.capAmount - netIn))} left). Only you can change it: /funds limits cap=<amount>.`)
        }
      }
      const movement: FundsMovement = { id: `m${state.nextId}`, at: nowMs, kind: cmd.kind, amount: cmd.amount, ...(cmd.note ? { note: cmd.note } : {}) }
      const next = { ...state, movements: [...state.movements, movement], nextId: state.nextId + 1 }
      return { state: next, message: `Recorded ${cmd.kind === 'deposit' ? 'deposit' : 'withdrawal'} of ${money(cmd.amount)}${cmd.note ? ` (${cmd.note})` : ''}. Bankroll ${money(summarize(next, nowMs).bankroll)}.` }
    }
    case 'approve-all':
      // Approving a Kalshi proposal means placing a live order, which only the app's
      // execution layer (kalshiExecution.ts) can do — it intercepts this command before
      // runFundsCommand ever sees it. Reaching the ledger means a caller skipped that
      // layer; refuse rather than approve on paper what was asked to be placed for real.
      throw new FundsError('Approve-all is run by the app: it approves each proposal one by one at its live price. Nothing was approved.')
    case 'plan':
      // The master plan is organized by the owner's framework text and reads the Kalshi
      // environment setting — both live outside this ledger (ownerScaffold.ts,
      // kalshiAuth.ts), so the app's execution layer builds it (kalshiExecution.ts
      // intercepts this command before runFundsCommand ever sees it, like approve-all).
      // Reaching the ledger means a caller skipped that layer; refuse rather than emit
      // a plan organized by a structure this layer cannot see.
      throw new FundsError('The funds plan is built by the app from your framework in Settings. Nothing was planned.')
    case 'approve': {
      const p = state.positions.find(x => x.id === cmd.id)
      if (!p) throw new FundsError(`No position ${cmd.id}.`)
      if (p.status !== 'proposed') throw new FundsError(`${cmd.id} is ${p.status}; only a proposal can be approved.`)
      if (state.halted) throw new FundsError(haltedMessage(state.halted))
      const s = summarize(state, nowMs)
      if (p.stake + p.feeEstimate > s.available + 1e-9) throw new FundsError(`${cmd.id} needs ${money(p.stake + p.feeEstimate)} but only ${money(s.available)} is available.`)
      const next = updatePosition(state, cmd.id, x => ({ ...x, status: 'approved', approvedAt: nowMs }))
      // Kalshi approvals placed from the app are executed by kalshiExecution.ts, which writes
      // its own reply; this text is what a direct ledger approval says, and it stays truthful.
      const tail = p.venue.trim().toLowerCase() === 'kalshi'
        ? 'ForgeClaw places Kalshi orders itself when you approve in the app (live price, balance checked first).'
        : `ForgeClaw does not place it: place the order on ${p.venue}, then type /funds placed ${cmd.id} <fill price>.`
      return { state: next, message: `Approved ${cmd.id}: buy ${p.contracts} ${p.side.toUpperCase()} on ${p.venue} "${p.market}" at up to ${money(p.price)} (${money(p.stake)} + ~${money(p.feeEstimate)} fees).\n${honestyLine(p)}\n${tail}` }
    }
    case 'reject': {
      const next = updatePosition(state, cmd.id, x => {
        if (x.status !== 'proposed' && x.status !== 'approved') throw new FundsError(`${cmd.id} is ${x.status}; it cannot be rejected.`)
        return { ...x, status: 'rejected' }
      })
      return { state: next, message: `Rejected ${cmd.id}.` }
    }
    case 'placed': {
      const next = updatePosition(state, cmd.id, x => {
        if (x.status !== 'approved') throw new FundsError(`${cmd.id} is ${x.status}; approve it before marking it placed.`)
        const fill = cmd.fillPrice ?? x.price
        const fee = estimateFee(x.venue, x.contracts, fill)
        // A manual placement supersedes any recorded Kalshi fill data for this position.
        return { ...x, status: 'placed', placedAt: nowMs, fillPrice: fill, stake: cents(x.contracts * fill), feeEstimate: fee, feePaid: undefined, kalshiOrderId: undefined, clientOrderId: undefined }
      })
      const p = next.positions.find(x => x.id === cmd.id)!
      return { state: next, message: `${cmd.id} placed: ${p.contracts} ${p.side.toUpperCase()} at ${money(p.fillPrice!)} (${money(p.stake)} + ~${money(p.feeEstimate)} fees).` }
    }
    case 'settle': {
      const next = settlePosition(state, cmd.id, cmd.outcome, 'owner', nowMs)
      const p = next.positions.find(x => x.id === cmd.id)!
      return { state: next, message: `${cmd.id} settled ${cmd.outcome}: ${money(p.pnl ?? 0)}. Bankroll ${money(summarize(next, nowMs).bankroll)}.` }
    }
    case 'limits': {
      const limits = { ...state.limits, ...cmd.changes }
      return { state: { ...state, limits }, message: `Limits: ${formatLimits(limits)}.` }
    }
    case 'resume': {
      if (!state.halted) return { state, message: 'Not halted.' }
      const rest: FundsState = { ...state }
      delete rest.halted
      return { state: rest, message: `Resumed. The halt was: ${state.halted.reason} Today's results stay in the record.` }
    }
    case 'rule': {
      const rules = [...(state.rules ?? []), cmd.text.slice(0, 300)].slice(0, 30)
      return { state: { ...state, rules }, message: `Rule ${rules.length} saved. Every funds plan gets your rules:\n${formatRules(rules)}` }
    }
    case 'unrule': {
      const rules = state.rules ?? []
      if (cmd.index > rules.length) throw new FundsError(`There is no rule ${cmd.index} (${rules.length} saved).`)
      const next = rules.filter((_, i) => i !== cmd.index - 1)
      return { state: { ...state, rules: next }, message: `Removed rule ${cmd.index}.${next.length ? `\n${formatRules(next)}` : ' No rules left.'}` }
    }
    case 'rules':
      return { state, message: (state.rules ?? []).length ? `Your rules:\n${formatRules(state.rules!)}` : 'No rules yet. Add one: /funds rule <your rule>' }
  }
}

// ── Reporting ──────────────────────────────────────────────────────────────────

export const formatLimits = (L: FundsLimits) => `cap ${L.capAmount > 0 ? money(L.capAmount) : 'not set'} · paper bankroll ${money(L.paperBankroll)} · max stake ${L.maxStakePct}% · max exposure ${L.maxExposurePct}% · daily loss stop ${L.dailyLossPct > 0 ? `${L.dailyLossPct}% (halts until you resume)` : 'off'} · ${L.kellyFraction}x Kelly · requote tolerance ${L.toleranceCents}¢ · auto-approve ${L.autoApproveUnder > 0 ? `up to ${money(L.autoApproveUnder)}` : 'off'}`
const formatRules = (rules: string[]) => rules.map((r, i) => `${i + 1}. ${r}`).join('\n')

/**
 * The truth attached to every proposal and approval. At the market's own price the expected value is
 * minus the fees; it is positive only if ForgeClaw's estimate is right and the market's is wrong.
 */
export function honestyLine(p: FundsPosition): string {
  const price = p.fillPrice ?? p.price
  const ifModel = p.contracts * (p.probability - price) - p.feeEstimate
  return `Expected value after fees: ${money(-p.feeEstimate)} at the market's price (implied ${pct(price)}); ${money(ifModel)} only if ForgeClaw's ${pct(p.probability)} is right.`
}

/** Brier score (lower is better) of the model's probabilities and of the prices paid, on settled won/lost positions. */
export function trackRecord(state: FundsState): { settled: number; won: number; modelBrier: number | null; marketBrier: number | null } {
  const done = state.positions.filter(p => p.status === 'settled' && (p.outcome === 'won' || p.outcome === 'lost'))
  if (!done.length) return { settled: 0, won: 0, modelBrier: null, marketBrier: null }
  const brier = (pick: (p: FundsPosition) => number) => done.reduce((s, p) => s + (pick(p) - (p.outcome === 'won' ? 1 : 0)) ** 2, 0) / done.length
  return {
    settled: done.length,
    won: done.filter(p => p.outcome === 'won').length,
    modelBrier: Math.round(brier(p => p.probability) * 1000) / 1000,
    marketBrier: Math.round(brier(p => p.fillPrice ?? p.price) * 1000) / 1000,
  }
}

export function formatPosition(p: FundsPosition): string {
  const head = `${p.id} [${p.mode}${p.mode === 'real' ? `, ${p.status}` : p.status === 'settled' ? ', settled' : ', open'}] ${p.venue} "${p.market}" ${p.side.toUpperCase()} x${p.contracts} @ ${money(p.fillPrice ?? p.price)}`
  const est = `your estimate ${pct(p.probability)} vs price ${pct(p.fillPrice ?? p.price)}; stake ${money(p.stake)} + ~${money(p.feeEstimate)} fees`
  const result = p.status === 'settled' ? `; ${p.outcome} ${money(p.pnl ?? 0)}` : ''
  return `${head}\n   ${est}${result}`
}

export function formatFundsStatus(state: FundsState, nowMs: number): string {
  const s = summarize(state, nowMs)
  const open = state.positions.filter(p => p.status === 'proposed' || p.status === 'approved' || p.status === 'placed')
  const t = trackRecord(state)
  const record = t.settled
    ? `${t.won}/${t.settled} won; Brier score: your estimates ${t.modelBrier} vs prices paid ${t.marketBrier} (lower is better; estimates must beat prices for an edge to be real)`
    : 'no settled positions yet'
  const rules = state.rules ?? []
  const cats = categoryRecords(state)
  return [
    ...(state.halted ? [haltedMessage(state.halted)] : []),
    `Funds ledger (ForgeClaw records funds; it never holds or moves money):`,
    `Bankroll ${money(s.bankroll)} = ${money(s.deposited)} in − ${money(s.withdrawn)} out + ${money(s.realizedPnl)} realized`,
    `Available ${money(s.available)} · committed to open positions ${money(s.openStake)} · today ${money(s.settledToday)}`,
    `Paper (optional, phantom money): bankroll ${money(s.paperBankroll)} (P/L ${money(s.paperPnl)}) · available ${money(s.paperAvailable)}`,
    `Limits: ${formatLimits(state.limits)}`,
    `Track record: ${record}`,
    ...(cats.length ? [`Stakes by category (learning stakes: an unproven series is sized ×${CATEGORY_UNPROVEN_MULTIPLIER}, a losing one ×${CATEGORY_LOSING_MULTIPLIER}, never above ×1): ${cats.map(c => `${c.category} ${c.won}/${c.settled} won, ${money(c.netPnl)} net → stake ×${stakeMultiplierFor(c)}`).join('; ')}`] : []),
    open.length ? `Open positions:\n${open.map(formatPosition).join('\n')}` : 'Open positions: none',
    rules.length ? `Owner's rules (follow every one; a proposal that breaks one must not be made):\n${formatRules(rules)}` : "Owner's rules: none set",
  ].join('\n')
}

export function formatProposal(position: FundsPosition, sizing: Sizing): string {
  const next = position.mode === 'paper'
    ? 'Paper position: tracked now against the phantom bankroll, no money involved.'
    : `Waiting for the owner: /funds approve ${position.id} or /funds reject ${position.id}. Nothing is placed until the owner places it on ${position.venue}.`
  return `Proposed ${formatPosition(position)}\n   edge ${pct(sizing.edge)} per contract; size limited by ${sizing.binding}\n   ${honestyLine(position)}\n   ${next}`
}

// ── Storage ────────────────────────────────────────────────────────────────────

export function loadFunds(): FundsState {
  const raw = safeGetItem(FUNDS_STORAGE_KEY)
  if (!raw) return emptyFunds()
  try {
    const parsed = JSON.parse(raw) as FundsState
    if (parsed?.version !== 1 || !Array.isArray(parsed.movements) || !Array.isArray(parsed.positions)) return emptyFunds()
    return { ...emptyFunds(), ...parsed, limits: { ...DEFAULT_LIMITS, ...parsed.limits }, rules: Array.isArray(parsed.rules) ? parsed.rules.filter(r => typeof r === 'string') : [] }
  } catch {
    return emptyFunds()
  }
}

/** Save and read back: a failed write (private mode, full storage) is reported, never silent. */
/**
 * Broadcast when the funds ledger is saved, so UI that reads the ledger outside React
 * (FundsPanel) learns about saves that happen outside a /funds command — a model tool
 * can save a proposal mid-run, and App only bumps its refresh tick on typed commands.
 * A refused save dispatches nothing: the ledger did not change. The event name is the
 * constant so the panel and the ledger can never drift apart.
 */
export const FUNDS_CHANGED_EVENT = 'forgeclaw:funds-changed'

function notifyFundsChanged(): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent(FUNDS_CHANGED_EVENT))
  }
}

export function saveFunds(state: FundsState): boolean {
  const raw = JSON.stringify(state)
  safeSetItem(FUNDS_STORAGE_KEY, raw)
  const saved = safeGetItem(FUNDS_STORAGE_KEY) === raw
  if (saved) notifyFundsChanged()
  return saved
}

/** The owner's rules for the plan prompt; empty when none are set. */
export function ownerRulesPrompt(state: FundsState = loadFunds()): string {
  const rules = state.rules ?? []
  return rules.length ? `\nOwner's own rules for these funds (follow every one; never propose a position that breaks one, and say which rules each proposal satisfies):\n${formatRules(rules)}` : ''
}

export const NOT_SAVED_WARNING = '\n\n⚠ This change could NOT be saved in this browser (private mode or storage full). It will be lost on reload.'

/** Owner command entry point: parse, apply, save. */
export function runFundsCommand(text: string, nowMs = Date.now()): string | null {
  const cmd = parseFundsCommand(text)
  if (!cmd) return null
  const state = loadFunds()
  try {
    const result = applyFundsCommand(state, cmd, nowMs)
    if (result.state === state) return result.message
    return saveFunds(result.state) ? result.message : result.message + NOT_SAVED_WARNING
  } catch (error) {
    if (error instanceof FundsError) return `Not done: ${error.message}`
    throw error
  }
}
