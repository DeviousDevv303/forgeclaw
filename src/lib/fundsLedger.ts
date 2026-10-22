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
  /** New real proposals stop for the day once settled losses today reach this % of bankroll. */
  dailyLossPct: number
  /** Fraction of the Kelly stake used (1 = full Kelly). */
  kellyFraction: number
}

export interface FundsState {
  version: 1
  movements: FundsMovement[]
  positions: FundsPosition[]
  limits: FundsLimits
  nextId: number
}

export const DEFAULT_LIMITS: FundsLimits = { maxStakePct: 5, maxExposurePct: 30, dailyLossPct: 10, kellyFraction: 0.25 }

export function emptyFunds(): FundsState {
  return { version: 1, movements: [], positions: [], limits: { ...DEFAULT_LIMITS }, nextId: 1 }
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
}

const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime() }

export function summarize(state: FundsState, nowMs: number): FundsSummary {
  const deposited = state.movements.filter(m => m.kind === 'deposit').reduce((s, m) => s + m.amount, 0)
  const withdrawn = state.movements.filter(m => m.kind === 'withdraw').reduce((s, m) => s + m.amount, 0)
  const real = state.positions.filter(p => p.mode === 'real')
  const realizedPnl = real.filter(p => p.status === 'settled').reduce((s, p) => s + (p.pnl ?? 0), 0)
  const bankroll = deposited - withdrawn + realizedPnl
  const openStake = real.filter(p => p.status === 'approved' || p.status === 'placed').reduce((s, p) => s + p.stake + p.feeEstimate, 0)
  const paperPnl = state.positions.filter(p => p.mode === 'paper' && p.status === 'settled').reduce((s, p) => s + (p.pnl ?? 0), 0)
  const dayStart = startOfDay(nowMs)
  const settledToday = real.filter(p => p.status === 'settled' && (p.settledAt ?? 0) >= dayStart).reduce((s, p) => s + (p.pnl ?? 0), 0)
  return {
    deposited: cents(deposited), withdrawn: cents(withdrawn), realizedPnl: cents(realizedPnl), bankroll: cents(bankroll),
    openStake: cents(openStake), available: cents(bankroll - openStake), paperPnl: cents(paperPnl), settledToday: cents(settledToday),
  }
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
}

/** Kelly for a $1 binary bought at price P with win chance p: f* = (p - P) / (1 - P). */
export function sizePosition(input: ProposalInput, state: FundsState, nowMs: number): Sizing {
  const { price: P, probability: p } = input
  const s = summarize(state, nowMs)
  const L = state.limits
  const edge = p - P
  const kellyFull = edge > 0 ? edge / (1 - P) : 0
  const caps: Array<[string, number]> = [
    [`${L.kellyFraction}x Kelly`, L.kellyFraction * kellyFull * s.bankroll],
    [`max stake ${L.maxStakePct}% of bankroll`, (L.maxStakePct / 100) * s.bankroll],
    [`max exposure ${L.maxExposurePct}% of bankroll`, (L.maxExposurePct / 100) * s.bankroll - s.openStake],
    ['available funds', s.available],
  ]
  if (input.maxStake !== undefined && input.maxStake > 0) caps.push(['requested max stake', input.maxStake])
  const [binding, budget] = caps.reduce((min, c) => (c[1] < min[1] ? c : min))
  // Fees come out of the same budget, so shrink until stake + fee fits.
  let contracts = Math.max(0, Math.floor(budget / P))
  while (contracts > 0 && contracts * P + estimateFee(input.venue, contracts, P) > budget + 1e-9) contracts--
  const fee = estimateFee(input.venue, contracts, P)
  const stake = cents(contracts * P)
  return { edge, kellyFull, contracts, stake, fee, expectedProfit: cents(contracts * edge - fee), binding }
}

// ── Model actions ──────────────────────────────────────────────────────────────

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
  if (s.bankroll <= 0) throw new FundsError('No funds in the ledger. The owner adds them with /funds add <amount>.')
  if (mode === 'real' && s.settledToday < 0 && -s.settledToday >= (state.limits.dailyLossPct / 100) * (s.bankroll - s.settledToday)) {
    throw new FundsError(`Daily loss limit reached (${money(s.settledToday)} today, limit ${state.limits.dailyLossPct}%). No new real positions until tomorrow.`)
  }
  const sizing = sizePosition(input, state, nowMs)
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
  return cents(outcome === 'won' ? position.contracts * (1 - fill) - position.feeEstimate : -(position.contracts * fill) - position.feeEstimate)
}

function updatePosition(state: FundsState, id: string, change: (p: FundsPosition) => FundsPosition): FundsState {
  const idx = state.positions.findIndex(p => p.id === id)
  if (idx < 0) throw new FundsError(`No position ${id}.`)
  const positions = state.positions.slice()
  positions[idx] = change(positions[idx])
  return { ...state, positions }
}

export function settlePosition(state: FundsState, id: string, outcome: PositionOutcome, by: 'owner' | 'kalshi', nowMs: number): FundsState {
  return updatePosition(state, id, p => {
    if (p.status !== 'placed') throw new FundsError(`${id} is ${p.status}; only a placed position can be settled.`)
    return { ...p, status: 'settled', outcome, pnl: pnlFor(p, outcome), settledAt: nowMs, settledBy: by }
  })
}

/** Kalshi's market `result` ("yes"/"no") decides the outcome; anything else is not settled yet. */
export function outcomeFromKalshiResult(position: FundsPosition, result: string | undefined): PositionOutcome | null {
  if (result !== 'yes' && result !== 'no') return null
  return result === position.side ? 'won' : 'lost'
}

// ── Owner commands (/funds …) ──────────────────────────────────────────────────

export type FundsCommand =
  | { kind: 'status' }
  | { kind: 'deposit' | 'withdraw'; amount: number; note?: string }
  | { kind: 'approve' | 'reject'; id: string }
  | { kind: 'placed'; id: string; fillPrice?: number }
  | { kind: 'settle'; id: string; outcome: PositionOutcome }
  | { kind: 'limits'; changes: Partial<FundsLimits> }
  | { kind: 'usage'; message: string }

export const FUNDS_USAGE = [
  'Funds commands (you only; a model cannot run them):',
  '/funds — bankroll, open positions, track record',
  '/funds add <amount> [where it is held] — record money you put in (it stays at your venue)',
  '/funds withdraw <amount> [note]',
  '/funds approve <id> | /funds reject <id> — decide on a proposal',
  '/funds placed <id> [fill price] — confirm you placed the order on the venue',
  '/funds settle <id> won|lost|void — record the result (Kalshi positions can also settle from Kalshi)',
  '/funds limits [stake=5] [exposure=30] [daily=10] [kelly=0.25] — percentages of bankroll; kelly is a fraction',
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
  if (verb === 'limits') {
    const keys: Record<string, keyof FundsLimits> = { stake: 'maxStakePct', exposure: 'maxExposurePct', daily: 'dailyLossPct', kelly: 'kellyFraction' }
    const changes: Partial<FundsLimits> = {}
    for (const part of rest) {
      const [k, v] = part.split('=')
      const key = keys[(k ?? '').toLowerCase()]
      const n = Number(v)
      if (!key || !Number.isFinite(n) || n <= 0) return usage(`Bad limit "${part}".`)
      if (key === 'kellyFraction' ? n > 1 : n > 100) return usage(`"${part}" is out of range (percentages up to 100, kelly up to 1).`)
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
      const movement: FundsMovement = { id: `m${state.nextId}`, at: nowMs, kind: cmd.kind, amount: cmd.amount, ...(cmd.note ? { note: cmd.note } : {}) }
      const next = { ...state, movements: [...state.movements, movement], nextId: state.nextId + 1 }
      return { state: next, message: `Recorded ${cmd.kind === 'deposit' ? 'deposit' : 'withdrawal'} of ${money(cmd.amount)}${cmd.note ? ` (${cmd.note})` : ''}. Bankroll ${money(summarize(next, nowMs).bankroll)}.` }
    }
    case 'approve': {
      const p = state.positions.find(x => x.id === cmd.id)
      if (!p) throw new FundsError(`No position ${cmd.id}.`)
      if (p.status !== 'proposed') throw new FundsError(`${cmd.id} is ${p.status}; only a proposal can be approved.`)
      const s = summarize(state, nowMs)
      if (p.stake + p.feeEstimate > s.available + 1e-9) throw new FundsError(`${cmd.id} needs ${money(p.stake + p.feeEstimate)} but only ${money(s.available)} is available.`)
      const next = updatePosition(state, cmd.id, x => ({ ...x, status: 'approved', approvedAt: nowMs }))
      return { state: next, message: `Approved ${cmd.id}: buy ${p.contracts} ${p.side.toUpperCase()} on ${p.venue} "${p.market}" at up to ${money(p.price)} (${money(p.stake)} + ~${money(p.feeEstimate)} fees). ForgeClaw does not place it: place the order on ${p.venue}, then type /funds placed ${cmd.id} <fill price>.` }
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
        return { ...x, status: 'placed', placedAt: nowMs, fillPrice: fill, stake: cents(x.contracts * fill), feeEstimate: fee }
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
  }
}

// ── Reporting ──────────────────────────────────────────────────────────────────

const formatLimits = (L: FundsLimits) => `max stake ${L.maxStakePct}% · max exposure ${L.maxExposurePct}% · daily loss stop ${L.dailyLossPct}% · ${L.kellyFraction}x Kelly`

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
  return [
    `Funds ledger (ForgeClaw records funds; it never holds or moves money):`,
    `Bankroll ${money(s.bankroll)} = ${money(s.deposited)} in − ${money(s.withdrawn)} out + ${money(s.realizedPnl)} realized`,
    `Available ${money(s.available)} · committed to open positions ${money(s.openStake)} · today ${money(s.settledToday)} · paper P/L ${money(s.paperPnl)}`,
    `Limits: ${formatLimits(state.limits)}`,
    `Track record: ${record}`,
    open.length ? `Open positions:\n${open.map(formatPosition).join('\n')}` : 'Open positions: none',
  ].join('\n')
}

export function formatProposal(position: FundsPosition, sizing: Sizing): string {
  const next = position.mode === 'paper'
    ? 'Paper position: tracked now, no money involved.'
    : `Waiting for the owner: /funds approve ${position.id} or /funds reject ${position.id}. Nothing is placed until the owner places it on ${position.venue}.`
  return `Proposed ${formatPosition(position)}\n   edge ${pct(sizing.edge)} per contract; expected profit ${money(sizing.expectedProfit)} after fees if your estimate is right; size limited by ${sizing.binding}\n   ${next}`
}

// ── Storage ────────────────────────────────────────────────────────────────────

export function loadFunds(): FundsState {
  const raw = safeGetItem(FUNDS_STORAGE_KEY)
  if (!raw) return emptyFunds()
  try {
    const parsed = JSON.parse(raw) as FundsState
    if (parsed?.version !== 1 || !Array.isArray(parsed.movements) || !Array.isArray(parsed.positions)) return emptyFunds()
    return { ...emptyFunds(), ...parsed, limits: { ...DEFAULT_LIMITS, ...parsed.limits } }
  } catch {
    return emptyFunds()
  }
}

/** Save and read back: a failed write (private mode, full storage) is reported, never silent. */
export function saveFunds(state: FundsState): boolean {
  const raw = JSON.stringify(state)
  safeSetItem(FUNDS_STORAGE_KEY, raw)
  return safeGetItem(FUNDS_STORAGE_KEY) === raw
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
