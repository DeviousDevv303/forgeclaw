// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  FUNDS_STORAGE_KEY, FundsError, applyFundsCommand, categoryOfMarket, categoryRecords, categoryStakeMultiplier, emptyFunds, estimateFee, formatFundsStatus, formatProposal, honestyLine, loadFunds, outcomeFromKalshiResult, ownerRulesPrompt,
  dailyLossHit, parseFundsCommand, pnlFor, proposePosition, recordKalshiFill, revertKalshiApproval, runFundsCommand, saveFunds, setClientOrderId, settlePosition, sizePosition, stakeMultiplierFor, summarize, trackRecord,
  type FundsPosition, type FundsState, type ProposalInput,
} from './fundsLedger'

const NOW = Date.parse('2026-10-22T15:00:00Z')
const capped = (cap = 1_000_000): FundsState => applyFundsCommand(emptyFunds(), { kind: 'limits', changes: { capAmount: cap } }, NOW).state
/** Cap set and money in. */
const funded = (amount = 1000): FundsState => applyFundsCommand(capped(), { kind: 'deposit', amount }, NOW).state
const proposal = (over: Partial<ProposalInput> = {}): ProposalInput => ({
  venue: 'kalshi', market: 'KX-RAIN-OCT', side: 'yes', price: 0.4, probability: 0.55,
  rationale: 'NWS forecast gives 60% rain for the window and three models agree; market lags the update.',
  sources: ['https://weather.gov/forecast'], ...over,
})

describe('fees', () => {
  it("uses Kalshi's taker formula rounded up to the cent, and 0 elsewhere", () => {
    expect(estimateFee('kalshi', 100, 0.5)).toBe(1.75) // 0.07*100*0.25
    expect(estimateFee('kalshi', 1, 0.5)).toBe(0.02)   // 0.0175 -> 0.02
    expect(estimateFee('Kalshi', 10, 0.4)).toBe(0.17)  // 0.168 -> 0.17
    expect(estimateFee('draftkings', 100, 0.5)).toBe(0)
  })
})

describe('sizing', () => {
  it('stakes a fraction of Kelly and never more than the stake cap', () => {
    // Kelly f* = (0.55-0.4)/0.6 = 0.25; 0.25x Kelly = 6.25% of 1000 = 62.5; stake cap 5% = 50 binds,
    // then the unproven-category multiplier (item 11: no settled record for KX) halves the budget to 25.
    const s = sizePosition(proposal(), funded(), NOW)
    expect(s.kellyFull).toBeCloseTo(0.25)
    expect(s.binding).toMatch(/max stake 5%/)
    expect(s.binding).toMatch(/× 0\.5 category record \(KX\)/)
    expect(s.categoryMultiplier).toBe(0.5)
    expect(s.stake + s.fee).toBeLessThanOrEqual(25)
    // Fee = ceil(0.07 x C x 0.24): 60 contracts = 24.00 + 1.01 = 25.01 (over); 59 = 23.60 + 1.00 = 24.60.
    expect(s.contracts).toBe(59)
    expect(s.fee).toBe(1)
  })
  it('respects the exposure cap across open positions, then refuses', () => {
    let st = funded()
    let refusal = ''
    for (let i = 0; i < 20 && !refusal; i++) {
      try {
        st = proposePosition(st, proposal({ market: `M${i}` }), NOW).state
        st = applyFundsCommand(st, { kind: 'approve', id: `p${st.nextId - 1}` }, NOW).state
      } catch (error) { refusal = (error as Error).message }
    }
    expect(summarize(st, NOW).openStake).toBeLessThanOrEqual(300) // 30% of 1000, fees included
    expect(summarize(st, NOW).openStake).toBeGreaterThan(290)
    expect(refusal).toMatch(/zero contracts.*exposure|fees/)
  })
})

describe('proposals', () => {
  it('refuses a bet with no edge, or whose edge the fees eat', () => {
    expect(() => proposePosition(funded(), proposal({ probability: 0.4 }), NOW)).toThrow(/No edge/)
    expect(() => proposePosition(funded(), proposal({ probability: 0.39 }), NOW)).toThrow(/No edge/)
    expect(() => proposePosition(funded(10), proposal({ price: 0.5, probability: 0.505 }), NOW)).toThrow(/fees|zero contracts/)
  })
  it('requires research: a rationale and at least one source', () => {
    expect(() => proposePosition(funded(), proposal({ sources: [] }), NOW)).toThrow(/source/)
    expect(() => proposePosition(funded(), proposal({ rationale: 'gut feel' }), NOW)).toThrow(/rationale/)
  })
  it('requires funds and sane numbers', () => {
    expect(() => proposePosition(emptyFunds(), proposal(), NOW)).toThrow(/No funds/)
    expect(() => proposePosition(funded(), proposal({ price: 1 }), NOW)).toThrow(/price/)
    expect(() => proposePosition(funded(), proposal({ probability: 0 }), NOW)).toThrow(/probability/)
  })
  it('a real proposal waits for the owner; a paper one is tracked at once and commits no funds', () => {
    const real = proposePosition(funded(), proposal(), NOW)
    expect(real.position.status).toBe('proposed')
    expect(summarize(real.state, NOW).openStake).toBe(0)
    const paper = proposePosition(funded(), proposal({ mode: 'paper' }), NOW)
    expect(paper.position.status).toBe('placed')
    expect(summarize(paper.state, NOW).available).toBe(1000)
  })
})

describe('owner flow and P/L', () => {
  it('approve -> placed at a fill -> settle won/lost updates the bankroll', () => {
    let st = proposePosition(funded(), proposal(), NOW).state
    expect(() => applyFundsCommand(st, { kind: 'placed', id: 'p2' }, NOW)).toThrow(/approve it before/)
    st = applyFundsCommand(st, { kind: 'approve', id: 'p2' }, NOW).state
    expect(summarize(st, NOW).available).toBeLessThan(1000)
    st = applyFundsCommand(st, { kind: 'placed', id: 'p2', fillPrice: 0.42 }, NOW).state
    const p = st.positions.find(x => x.id === 'p2')!
    expect(p.fillPrice).toBe(0.42)
    const won = settlePosition(st, 'p2', 'won', 'owner', NOW)
    expect(won.positions.find(x => x.id === 'p2')!.pnl).toBeCloseTo(p.contracts * 0.58 - p.feeEstimate, 2)
    expect(summarize(won, NOW).bankroll).toBeCloseTo(1000 + won.positions.find(x => x.id === 'p2')!.pnl!, 2)
    const lost = settlePosition(st, 'p2', 'lost', 'owner', NOW)
    expect(lost.positions.find(x => x.id === 'p2')!.pnl).toBeCloseTo(-(p.contracts * 0.42) - p.feeEstimate, 2)
    expect(pnlFor(p, 'void')).toBe(0)
  })
  it('stops new real proposals for the day once the daily loss limit is hit', () => {
    let st = funded(1000)
    st = applyFundsCommand(st, { kind: 'limits', changes: { dailyLossPct: 2 } }, NOW).state
    st = proposePosition(st, proposal(), NOW).state
    st = applyFundsCommand(st, { kind: 'approve', id: 'p2' }, NOW).state
    st = applyFundsCommand(st, { kind: 'placed', id: 'p2' }, NOW).state
    st = settlePosition(st, 'p2', 'lost', 'owner', NOW) // about -25 (unproven-category half stake, item 11)
    expect(() => proposePosition(st, proposal({ market: 'next' }), NOW)).toThrow(/Daily loss limit/)
    expect(proposePosition(st, proposal({ market: 'next', mode: 'paper' }), NOW).position.status).toBe('placed')
  })
  it('cannot withdraw money that backs open positions', () => {
    let st = proposePosition(funded(100), proposal(), NOW).state
    st = applyFundsCommand(st, { kind: 'approve', id: 'p2' }, NOW).state
    expect(() => applyFundsCommand(st, { kind: 'withdraw', amount: 100 }, NOW)).toThrow(FundsError)
  })
  it('settles from Kalshi only on a published yes/no result', () => {
    const p = proposePosition(funded(), proposal({ side: 'no', price: 0.3, probability: 0.45 }), NOW).position
    expect(outcomeFromKalshiResult(p, 'no')).toBe('won')
    expect(outcomeFromKalshiResult(p, 'yes')).toBe('lost')
    expect(outcomeFromKalshiResult(p, '')).toBeNull()
    expect(outcomeFromKalshiResult(p, undefined)).toBeNull()
  })
})

describe('track record', () => {
  it('scores the model against the prices paid (Brier)', () => {
    let st = applyFundsCommand(capped(), { kind: 'deposit', amount: 1000 }, NOW).state
    st = proposePosition(st, proposal({ mode: 'paper' }), NOW).state
    st = settlePosition(st, 'p2', 'won', 'owner', NOW)
    const t = trackRecord(st)
    expect(t).toMatchObject({ settled: 1, won: 1 })
    expect(t.modelBrier).toBeCloseTo(0.2025, 2) // (0.55-1)^2
    expect(t.marketBrier).toBeCloseTo(0.36, 3)  // (0.40-1)^2
    expect(formatFundsStatus(st, NOW)).toMatch(/your estimates 0\.20\d vs prices paid 0\.36/)
  })
})

describe('commands', () => {
  it('parses the owner commands and explains bad input', () => {
    expect(parseFundsCommand('hello')).toBeNull()
    expect(parseFundsCommand('/funds')).toEqual({ kind: 'status' })
    expect(parseFundsCommand('/funds add $1,250.50 kalshi account')).toEqual({ kind: 'deposit', amount: 1250.5, note: 'kalshi account' })
    expect(parseFundsCommand('/funds placed P3 0.42')).toEqual({ kind: 'placed', id: 'p3', fillPrice: 0.42 })
    expect(parseFundsCommand('/funds settle p3 won')).toEqual({ kind: 'settle', id: 'p3', outcome: 'won' })
    expect(parseFundsCommand('/funds limits stake=2 kelly=0.1')).toEqual({ kind: 'limits', changes: { maxStakePct: 2, kellyFraction: 0.1 } })
    expect(parseFundsCommand('/funds add -5')).toMatchObject({ kind: 'usage' })
    expect(parseFundsCommand('/funds limits kelly=2')).toMatchObject({ kind: 'usage' })
    expect(parseFundsCommand('/funds approve')).toMatchObject({ kind: 'usage' })
  })
})

describe('storage', () => {
  beforeEach(() => localStorage.clear())
  it('persists owner commands and reports refusals without changing anything', () => {
    expect(runFundsCommand('/funds add 500 kalshi', NOW)).toMatch(/Recorded deposit of \$500\.00.*Bankroll \$500\.00/)
    expect(loadFunds().movements).toHaveLength(1)
    expect(runFundsCommand('/funds limits cap=1000', NOW)).toMatch(/cap \$1000\.00/)
    expect(runFundsCommand('/funds add 600 kalshi', NOW)).toMatch(/^Not done: That would put \$1100\.00 in, over your cap/)
    expect(loadFunds().movements).toHaveLength(1)
    expect(runFundsCommand('/funds withdraw 900', NOW)).toMatch(/^Not done: Only \$500\.00 is available/)
    expect(loadFunds().movements).toHaveLength(1)
    expect(runFundsCommand('/funds', NOW)).toContain('Bankroll $500.00')
  })
  it('falls back to an empty ledger on corrupt storage', () => {
    localStorage.setItem(FUNDS_STORAGE_KEY, '{nope')
    expect(loadFunds()).toEqual(emptyFunds())
  })
})

// Owner's cage rules (2026-10-22): cap at funding time, size limit, latched loss stop, no chase, honesty line, own rules.
describe('cage rules', () => {
  const settleLoss = (st: FundsState, market: string, at = NOW) => {
    st = proposePosition(st, proposal({ market }), at).state
    const id = `p${st.nextId - 1}`
    st = applyFundsCommand(st, { kind: 'approve', id }, at).state
    st = applyFundsCommand(st, { kind: 'placed', id }, at).state
    return settlePosition(st, id, 'lost', 'owner', at)
  }

  it('1. refuses funding above the cap you set', () => {
    let st = applyFundsCommand(emptyFunds(), { kind: 'limits', changes: { capAmount: 300 } }, NOW).state
    st = applyFundsCommand(st, { kind: 'deposit', amount: 200 }, NOW).state
    expect(() => applyFundsCommand(st, { kind: 'deposit', amount: 150 }, NOW)).toThrow(/over your cap of \$300\.00 \(\$100\.00 left\)/)
    expect(summarize(applyFundsCommand(st, { kind: 'deposit', amount: 100 }, NOW).state, NOW).deposited).toBe(300)
    expect(parseFundsCommand('/funds limits cap=300')).toEqual({ kind: 'limits', changes: { capAmount: 300 } })
  })

  it('2. never stakes more than the per-position limit, whatever the model asks', () => {
    const s = sizePosition(proposal({ probability: 0.95, maxStake: 10_000 }), funded(), NOW)
    expect(s.stake + s.fee).toBeLessThanOrEqual(50)
  })

  it('3. the loss stop halts real proposals AND approvals, survives midnight, and only /funds resume lifts it', () => {
    let st = applyFundsCommand(funded(1000), { kind: 'limits', changes: { dailyLossPct: 2 } }, NOW).state
    st = proposePosition(st, proposal({ market: 'pending' }), NOW).state // p2, waiting
    st = settleLoss(st, 'loser') // about -25: over 2%
    expect(st.halted?.reason).toMatch(/Daily loss limit hit/)
    const tomorrow = NOW + 36 * 3600_000
    expect(() => proposePosition(st, proposal({ market: 'next' }), tomorrow)).toThrow(/HALTED.*\/funds resume/)
    expect(() => applyFundsCommand(st, { kind: 'approve', id: 'p2' }, tomorrow)).toThrow(/HALTED/)
    expect(proposePosition(st, proposal({ market: 'paper', mode: 'paper' }), tomorrow).position.status).toBe('placed')
    expect(formatFundsStatus(st, tomorrow)).toMatch(/^HALTED/)
    st = applyFundsCommand(st, { kind: 'resume' }, tomorrow).state
    expect(st.halted).toBeUndefined()
    expect(proposePosition(st, proposal({ market: 'next' }), tomorrow).position.status).toBe('proposed')
  })

  it('4. no chasing: after a loss the same bet is sized the same or smaller, never larger', () => {
    const before = sizePosition(proposal(), funded(), NOW).stake
    const afterLoss = settleLoss(funded(), 'loser')
    expect(sizePosition(proposal({ market: 'again' }), afterLoss, NOW).stake).toBeLessThanOrEqual(before)
    const afterTwo = settleLoss(afterLoss, 'loser2')
    expect(sizePosition(proposal({ market: 'again' }), afterTwo, NOW).stake).toBeLessThanOrEqual(sizePosition(proposal({ market: 'again' }), afterLoss, NOW).stake)
  })

  it('6. every proposal and approval carries the expected value at the market price and at ForgeClaw\'s estimate', () => {
    const { state, position, sizing } = proposePosition(funded(), proposal(), NOW)
    expect(honestyLine(position)).toBe("Expected value after fees: -$1.00 at the market's price (implied 40%); $7.85 only if ForgeClaw's 55% is right.")
    expect(formatProposal(position, sizing)).toContain(honestyLine(position))
    expect(applyFundsCommand(state, { kind: 'approve', id: position.id }, NOW).message).toContain("at the market's price (implied 40%)")
  })

  it('your own rules are stored, listed, removable, and given to the plan', () => {
    let st = applyFundsCommand(emptyFunds(), { kind: 'rule', text: 'never bet on games my own team plays' }, NOW).state
    st = applyFundsCommand(st, { kind: 'rule', text: 'only markets that settle within 7 days' }, NOW).state
    expect(formatFundsStatus(st, NOW)).toContain('2. only markets that settle within 7 days')
    expect(ownerRulesPrompt(st)).toContain('1. never bet on games my own team plays')
    st = applyFundsCommand(st, { kind: 'unrule', index: 1 }, NOW).state
    expect(st.rules).toEqual(['only markets that settle within 7 days'])
    expect(() => applyFundsCommand(st, { kind: 'unrule', index: 5 }, NOW)).toThrow(/no rule 5/)
    expect(ownerRulesPrompt(emptyFunds())).toBe('')
    expect(parseFundsCommand('/funds rule x')).toMatchObject({ kind: 'usage' })
  })
})

// 2026-10-22 owner: "Move forward without paper". Paper is optional; real proposals work at once.
describe('paper mode (optional)', () => {
  it('real proposals need no paper history', () => {
    const r = proposePosition(funded(), proposal(), NOW)
    expect(r.position).toMatchObject({ mode: 'real', status: 'proposed' })
    expect(applyFundsCommand(r.state, { kind: 'approve', id: r.position.id }, NOW).state.positions[0].status).toBe('approved')
    expect(formatFundsStatus(r.state, NOW)).not.toMatch(/paper-first|gate/i)
  })

  it('paper, when asked for, is sized like real money against the phantom bankroll and needs no deposit', () => {
    const st = applyFundsCommand(capped(), { kind: 'limits', changes: { paperBankroll: 500 } }, NOW).state
    const r = proposePosition(st, proposal({ mode: 'paper' }), NOW)
    expect(r.position).toMatchObject({ mode: 'paper', status: 'placed' })
    expect(r.position.stake + r.position.feeEstimate).toBeLessThanOrEqual(25) // 5% of 500
    expect(r.sizing.binding).toMatch(/paper bankroll/)
    expect(summarize(r.state, NOW).paperAvailable).toBeCloseTo(500 - r.position.stake - r.position.feeEstimate, 2)
    expect(summarize(r.state, NOW).available).toBe(0)
  })

  it('deposits need no cap; the cap binds only once the owner sets one', () => {
    const s = applyFundsCommand(emptyFunds(), { kind: 'deposit', amount: 100 }, NOW).state
    expect(summarize(s, NOW).bankroll).toBe(100)
    const cappedState = applyFundsCommand(s, { kind: 'limits', changes: { capAmount: 150 } }, NOW).state
    expect(() => applyFundsCommand(cappedState, { kind: 'deposit', amount: 100 }, NOW)).toThrow(/over your cap/)
  })

  it('keeps the record across reloads', () => {
    localStorage.clear()
    const r = proposePosition(funded(), proposal(), NOW)
    expect(saveFunds(r.state)).toBe(true)
    expect(loadFunds().positions.map(p => p.id)).toEqual(['p2'])
  })
})

describe('Kalshi execution records (PR A)', () => {
  // The id comes from the proposal itself: nextId is shared with money movements,
  // so a deposit in funded() means the first position is not necessarily p1.
  const approvedKalshi = (): { state: FundsState; id: string } => {
    const r = proposePosition(funded(), proposal(), NOW)
    return { state: applyFundsCommand(r.state, { kind: 'approve', id: r.position.id }, NOW + 1).state, id: r.position.id }
  }

  it('records a real fill: price, fee and the Kalshi order id; P&L prefers the real fee', () => {
    const { state, id } = approvedKalshi()
    const s = recordKalshiFill(state, id, { fillCount: 40, avgFillPrice: 0.41, feePaid: 0.68, orderId: 'ord-9', clientOrderId: 'fc-x-1' }, NOW + 2)
    const p = s.positions[0]
    expect(p.status).toBe('placed')
    expect(p.contracts).toBe(40)
    expect(p.fillPrice).toBe(0.41)
    expect(p.feePaid).toBe(0.68)
    expect(p.kalshiOrderId).toBe('ord-9')
    expect(pnlFor(p, 'won')).toBeCloseTo(40 * (1 - 0.41) - 0.68, 6)
  })

  it('reverts a Kalshi approval back to proposed and clears the recorded order ids', () => {
    const { state, id } = approvedKalshi()
    let s = setClientOrderId(state, id, 'fc-x-1')
    s = revertKalshiApproval(s, id)
    expect(s.positions[0].status).toBe('proposed')
    expect(s.positions[0].clientOrderId).toBeUndefined()
  })

  it('manual /funds placed clears the Kalshi order ids recorded at approval time', () => {
    const { state, id } = approvedKalshi()
    // kalshiExecution records the client order id on the approved position before it posts;
    // if the owner then places the bet himself instead, the manual mark must not keep it.
    let s = setClientOrderId(state, id, 'fc-x-1')
    s = applyFundsCommand(s, { kind: 'placed', id, fillPrice: 0.43 }, NOW + 3).state
    expect(s.positions[0].status).toBe('placed')
    expect(s.positions[0].fillPrice).toBe(0.43)
    expect(s.positions[0].clientOrderId).toBeUndefined()
    expect(s.positions[0].kalshiOrderId).toBeUndefined()
    expect(s.positions[0].feePaid).toBeUndefined()
  })

  it('settlePosition accepts the real Kalshi P&L when the caller computed it', () => {
    const { state, id } = approvedKalshi()
    let s = recordKalshiFill(state, id, { fillCount: 40, avgFillPrice: 0.41, feePaid: 0.68, orderId: 'ord-9', clientOrderId: 'fc-x-1' }, NOW + 2)
    s = settlePosition(s, id, 'won', 'kalshi', NOW + 3, 12.34)
    expect(s.positions[0].pnl).toBe(12.34)
    expect(summarize(s, NOW + 3).bankroll).toBeCloseTo(1000 + 12.34, 6)
  })

  it('the requote tolerance is settable and shows in the status', () => {
    const s = applyFundsCommand(funded(), { kind: 'limits', changes: { toleranceCents: 5 } }, NOW).state
    expect(s.limits.toleranceCents).toBe(5)
    expect(formatFundsStatus(s, NOW)).toContain('requote tolerance 5¢')
  })
})

describe('optional locks (PR B item 7)', () => {
  it('the parser accepts cap=0 (no cap) and daily=0 (loss stop off)', () => {
    expect(parseFundsCommand('/funds limits cap=0')).toMatchObject({ kind: 'limits', changes: { capAmount: 0 } })
    expect(parseFundsCommand('/funds limits daily=0')).toMatchObject({ kind: 'limits', changes: { dailyLossPct: 0 } })
  })

  it('daily=0: a losing day never halts, and the status says the stop is off', () => {
    let s = applyFundsCommand(funded(), { kind: 'limits', changes: { dailyLossPct: 0 } }, NOW).state
    const r = proposePosition(s, proposal(), NOW)
    s = applyFundsCommand(r.state, { kind: 'approve', id: r.position.id }, NOW + 1).state
    s = recordKalshiFill(s, r.position.id, { fillCount: 10, avgFillPrice: 0.4, feePaid: 0.1, orderId: 'o1', clientOrderId: 'c1' }, NOW + 2)
    s = settlePosition(s, r.position.id, 'lost', 'kalshi', NOW + 3, -50)
    expect(s.halted).toBeUndefined()
    expect(dailyLossHit(s, NOW + 3)).toBe(false)
    expect(formatFundsStatus(s, NOW + 3)).toContain('daily loss stop off')
  })
})

describe('approve-all + auto-approve limit (PR B item 10)', () => {
  it('parses /funds approve-all as its own command', () => {
    expect(parseFundsCommand('/funds approve-all')).toEqual({ kind: 'approve-all' })
    expect(parseFundsCommand('/funds APPROVE-ALL')).toEqual({ kind: 'approve-all' })
  })

  it('the ledger itself refuses approve-all: placing belongs to the execution layer', () => {
    expect(runFundsCommand('/funds approve-all')).toMatch(/^Not done: Approve-all is run by the app/)
  })

  it('autoapprove parses in dollars, 0 turns it back off, and the status shows the setting', () => {
    expect(parseFundsCommand('/funds limits autoapprove=25')).toMatchObject({ kind: 'limits', changes: { autoApproveUnder: 25 } })
    expect(parseFundsCommand('/funds limits autoapprove=0')).toMatchObject({ kind: 'limits', changes: { autoApproveUnder: 0 } })
    expect(parseFundsCommand('/funds limits autoapprove=-5')).toMatchObject({ kind: 'usage' })
    expect(emptyFunds().limits.autoApproveUnder).toBe(0)
    expect(formatFundsStatus(funded(), NOW)).toContain('auto-approve off')
    const s = applyFundsCommand(funded(), { kind: 'limits', changes: { autoApproveUnder: 25 } }, NOW).state
    expect(formatFundsStatus(s, NOW)).toContain('auto-approve up to $25.00')
  })
})

describe('category learning (PR B item 11)', () => {
  const settledPos = (over: Partial<FundsPosition> = {}): FundsPosition => ({
    id: 's1', createdAt: NOW, mode: 'real', venue: 'kalshi', market: 'KXHIGHNY-26OCT23-T75', side: 'yes',
    price: 0.4, probability: 0.55, contracts: 10, stake: 4, feeEstimate: 0.1,
    rationale: 'settled history', sources: ['https://weather.gov/forecast'], status: 'settled', outcome: 'won', pnl: 5, ...over,
  })
  const history = (positions: FundsPosition[]): FundsState => ({ ...funded(), positions })
  const run = (n: number, over: Partial<FundsPosition>): FundsPosition[] =>
    Array.from({ length: n }, (_, i) => settledPos({ id: `s${i}`, ...over }))

  it('derives the category from the ticker series; a dashless market is its own category', () => {
    expect(categoryOfMarket('KXHIGHNY-26OCT23-T75')).toBe('KXHIGHNY')
    expect(categoryOfMarket('KX-RAIN-OCT')).toBe('KX')
    expect(categoryOfMarket('Lakers moneyline')).toBe('Lakers moneyline')
  })

  it('aggregates settled count, wins and net P/L per category, ignoring void and unsettled', () => {
    const st = history([
      settledPos({ id: 'a', pnl: 5 }),
      settledPos({ id: 'b', outcome: 'lost', pnl: -4.1 }),
      settledPos({ id: 'c', market: 'KXCPI-26NOV', outcome: 'lost', pnl: -2 }),
      settledPos({ id: 'd', outcome: 'void', pnl: 0 }),
      settledPos({ id: 'e', status: 'placed', outcome: undefined, pnl: undefined }),
    ])
    expect(categoryRecords(st)).toEqual([
      { category: 'KXCPI', settled: 1, won: 0, netPnl: -2 },
      { category: 'KXHIGHNY', settled: 2, won: 1, netPnl: 0.9 },
    ])
  })

  it('no settled history in the category → half stake', () => {
    expect(categoryStakeMultiplier(funded(), 'KXHIGHNY')).toBe(0.5)
    expect(stakeMultiplierFor(undefined)).toBe(0.5)
  })

  it('a small sample stays unproven even when it is winning', () => {
    const st = history(run(3, { pnl: 5 }))
    expect(categoryStakeMultiplier(st, 'KXHIGHNY')).toBe(0.5)
  })

  it('a category that lost money over a real sample → quarter stake', () => {
    const st = history(run(5, { outcome: 'lost', pnl: -3 }))
    expect(categoryStakeMultiplier(st, 'KXHIGHNY')).toBe(0.25)
  })

  it('a profitable category over a real sample → full stake, and the multiplier never exceeds 1', () => {
    const st = history(run(6, { pnl: 2 }))
    expect(categoryStakeMultiplier(st, 'KXHIGHNY')).toBe(1)
    expect(stakeMultiplierFor({ settled: 500, netPnl: 1e6 })).toBe(1)
  })

  it('categories are isolated: a proven loser does not shrink a proven winner', () => {
    const st = history([
      ...run(5, { outcome: 'lost', pnl: -3 }),
      ...run(5, { id: 'w', market: 'KXCPI-26NOV', pnl: 4 }),
    ])
    expect(categoryStakeMultiplier(st, 'KXHIGHNY')).toBe(0.25)
    expect(categoryStakeMultiplier(st, 'KXCPI')).toBe(1)
    expect(categoryStakeMultiplier(st, 'KXBTC')).toBe(0.5)
  })

  it('sizing enforces the multiplier and names it in the proposal output', () => {
    const loser = history(run(5, { outcome: 'lost', pnl: -3 }))
    const s = sizePosition(proposal({ market: 'KXHIGHNY-26OCT24-T72' }), loser, NOW)
    expect(s.category).toBe('KXHIGHNY')
    expect(s.categoryMultiplier).toBe(0.25)
    expect(s.binding).toMatch(/× 0\.25 category record \(KXHIGHNY\)/)
    // The same input on a clean ledger gets the unproven half, strictly more contracts.
    const fresh = sizePosition(proposal({ market: 'KXHIGHNY-26OCT24-T72' }), funded(), NOW)
    expect(fresh.categoryMultiplier).toBe(0.5)
    expect(s.contracts).toBeLessThan(fresh.contracts)
    const { position, sizing } = proposePosition(loser, proposal({ market: 'KXHIGHNY-26OCT24-T72' }), NOW)
    expect(formatProposal(position, sizing)).toMatch(/size limited by .*category record \(KXHIGHNY\)/)
  })

  it('/funds status shows each category record and its multiplier', () => {
    const st = history(run(5, { outcome: 'lost', pnl: -3 }))
    const out = formatFundsStatus(st, NOW)
    expect(out).toContain('Stakes by category')
    expect(out).toContain('KXHIGHNY 0/5 won, -$15.00 net → stake ×0.25')
  })
})

describe('settlePosition: when it happened versus when the app learned of it', () => {
  it('stamps settledAtMs when given, and still runs the loss stop at the time the app learned of it', () => {
    let st = applyFundsCommand(funded(1000), { kind: 'limits', changes: { dailyLossPct: 2 } }, NOW).state
    const proposed = proposePosition(st, proposal(), NOW)
    st = applyFundsCommand(proposed.state, { kind: 'approve', id: proposed.position.id }, NOW).state
    st = applyFundsCommand(st, { kind: 'placed', id: proposed.position.id, fillPrice: 0.4 }, NOW).state
    const yesterday = NOW - 26 * 3_600_000
    const settled = settlePosition(st, proposed.position.id, 'lost', 'kalshi', NOW, -30, yesterday)
    expect(settled.positions[0].settledAt).toBe(yesterday)
    expect(summarize(settled, NOW).settledToday).toBe(0)
    expect(settled.halted).toBeUndefined()
    // Without the stamp the same call counts the loss against the day it was read.
    expect(settlePosition(st, proposed.position.id, 'lost', 'kalshi', NOW, -30).halted?.reason).toMatch(/Daily loss limit hit/)
  })
})

describe('guards pinned by mutation testing', () => {
  it('Kelly is the binding cap when the edge is small: the stake follows quarter Kelly, not the 5% stake cap', () => {
    // price 0.5, probability 0.53: Kelly f* = 0.06, quarter Kelly = 1.5% of 1000 = 15, below the 5% stake cap (50).
    // The unproven-category multiplier then halves the budget to 7.5.
    const s = sizePosition(proposal({ price: 0.5, probability: 0.53 }), funded(), NOW)
    expect(s.kellyFull).toBeCloseTo(0.06)
    expect(s.binding).toMatch(/0\.25x Kelly/)
    expect(s.stake + s.fee).toBeLessThanOrEqual(7.5 + 1e-9)
  })

  it('a bet whose fee eats its edge is refused for the fee, with contracts to spare', () => {
    // price 0.5, probability 0.505: 2 contracts fit the budget, edge 0.01 total, fee 0.04 — expected profit is negative.
    expect(() => proposePosition(funded(), proposal({ price: 0.5, probability: 0.505 }), NOW)).toThrow(/Edge is eaten by fees/)
  })

  it('a budget below one contract is refused as zero contracts, not as an edge problem', () => {
    expect(() => proposePosition(funded(10), proposal({ price: 0.5, probability: 0.505 }), NOW)).toThrow(/rounds to zero contracts/)
  })

  it('approve re-checks available funds: money withdrawn after the proposal cannot back it', () => {
    const proposed = proposePosition(funded(), proposal(), NOW)
    const withdrawn = applyFundsCommand(proposed.state, { kind: 'withdraw', amount: 990 }, NOW).state
    expect(() => applyFundsCommand(withdrawn, { kind: 'approve', id: proposed.position.id }, NOW)).toThrow(/needs .* but only .* is available/)
  })
})
