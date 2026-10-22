// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  FUNDS_STORAGE_KEY, FundsError, applyFundsCommand, emptyFunds, estimateFee, formatFundsStatus, formatProposal, honestyLine, loadFunds, outcomeFromKalshiResult, ownerRulesPrompt,
  parseFundsCommand, pnlFor, proposePosition, runFundsCommand, settlePosition, sizePosition, summarize, trackRecord,
  type FundsState, type ProposalInput,
} from './fundsLedger'

const NOW = Date.parse('2026-10-22T15:00:00Z')
const funded = (amount = 1000): FundsState => applyFundsCommand(emptyFunds(), { kind: 'deposit', amount }, NOW).state
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
    // Kelly f* = (0.55-0.4)/0.6 = 0.25; 0.25x Kelly = 6.25% of 1000 = 62.5; stake cap 5% = 50 binds.
    const s = sizePosition(proposal(), funded(), NOW)
    expect(s.kellyFull).toBeCloseTo(0.25)
    expect(s.binding).toMatch(/max stake 5%/)
    expect(s.stake + s.fee).toBeLessThanOrEqual(50)
    // Fee = ceil(0.07 x C x 0.24): 120 contracts = 48.00 + 2.02 = 50.02 (over); 119 = 47.60 + 2.00 = 49.60.
    expect(s.contracts).toBe(119)
    expect(s.fee).toBe(2)
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
    const p = st.positions[0]
    expect(p.fillPrice).toBe(0.42)
    const won = settlePosition(st, 'p2', 'won', 'owner', NOW)
    expect(won.positions[0].pnl).toBeCloseTo(p.contracts * 0.58 - p.feeEstimate, 2)
    expect(summarize(won, NOW).bankroll).toBeCloseTo(1000 + won.positions[0].pnl!, 2)
    const lost = settlePosition(st, 'p2', 'lost', 'owner', NOW)
    expect(lost.positions[0].pnl).toBeCloseTo(-(p.contracts * 0.42) - p.feeEstimate, 2)
    expect(pnlFor(p, 'void')).toBe(0)
  })
  it('stops new real proposals for the day once the daily loss limit is hit', () => {
    let st = funded(1000)
    st = applyFundsCommand(st, { kind: 'limits', changes: { dailyLossPct: 3 } }, NOW).state
    st = proposePosition(st, proposal(), NOW).state
    st = applyFundsCommand(st, { kind: 'approve', id: 'p2' }, NOW).state
    st = applyFundsCommand(st, { kind: 'placed', id: 'p2' }, NOW).state
    st = settlePosition(st, 'p2', 'lost', 'owner', NOW) // about -50
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
    let st = funded()
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
    let st = applyFundsCommand(funded(1000), { kind: 'limits', changes: { dailyLossPct: 3 } }, NOW).state
    st = proposePosition(st, proposal({ market: 'pending' }), NOW).state // p2, waiting
    st = settleLoss(st, 'loser') // about -50: over 3%
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
    expect(honestyLine(position)).toBe("Expected value after fees: -$2.00 at the market's price (implied 40%); $15.85 only if ForgeClaw's 55% is right.")
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
