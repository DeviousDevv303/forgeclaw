// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { autoApproveExecutionDeps, executeTool, FORGE_TOOLS } from './forgeTools'
import { clearErrorLog, getErrorLog } from './errorLog'
import { loadFunds, runFundsCommand } from './fundsLedger'
import { requiresCoSign } from './guardianGate'
import { NOT_EVIDENCE_TOOLS } from './nexusConvergence'

const ctx = { ghToken: 't', ghOwner: 'o', ghRepo: 'r', actor: 'operator', requestGuardianApproval: async () => true } as never
const call = (name: string, input: Record<string, unknown>) => executeTool({ id: '1', name, input }, ctx)
const propose = (over: Record<string, unknown> = {}) => call('funds_propose', {
  venue: 'kalshi', market: 'KX-RAIN-OCT', side: 'yes', price: 0.4, probability: 0.55,
  rationale: 'NWS forecast gives 60% rain for the window and three models agree; the market lags the update.',
  sources: ['https://weather.gov/forecast'], ...over,
})

beforeEach(() => localStorage.clear())
/** Cap set and money in. */
function fundAndOpenGate(amount = 1000) {
  runFundsCommand('/funds limits cap=100000')
  runFundsCommand(`/funds add ${amount}`)
}
afterEach(() => vi.unstubAllGlobals())

describe('funds tools', () => {
  it('give a model no way to add funds, approve, place or withdraw', () => {
    const names = FORGE_TOOLS.map(t => t.name).filter(n => n.startsWith('funds_'))
    expect(names.sort()).toEqual(['funds_propose', 'funds_settle', 'funds_status'])
    // Ledger reads and proposals are bookkeeping: they cannot make an answer "verified".
    expect(NOT_EVIDENCE_TOOLS.has('funds_status')).toBe(true)
    expect(NOT_EVIDENCE_TOOLS.has('funds_propose')).toBe(true)
    // A proposal moves no money, so it needs no co-sign; the owner's /funds approve is the decision.
    expect(requiresCoSign({ id: '1', name: 'funds_propose', input: {} }, 'operator-shell')).toBe(false)
  })

  it('refuses to propose without funds, then proposes a sized position that waits for the owner', async () => {
    expect(await propose()).toMatch(/TOOL ERROR.*No funds/)
    fundAndOpenGate()
    const out = await propose()
    expect(out).toMatch(/Proposed p2 \[real, proposed\] kalshi "KX-RAIN-OCT" YES x59 @ \$0\.40/)
    expect(out).toMatch(/\/funds approve p2/)
    expect(loadFunds().positions.find(p => p.id === 'p2')!.status).toBe('proposed')
    expect(await call('funds_status', {})).toContain('p2 [real, proposed]')
  })

  it('refuses a negative-edge bet and records nothing', async () => {
    fundAndOpenGate()
    expect(await propose({ probability: 0.35 })).toMatch(/TOOL ERROR.*No edge/)
    expect(loadFunds().positions.filter(p => !p.id.startsWith('w'))).toHaveLength(0)
  })

  it('settles a placed Kalshi position only from Kalshi\'s published result', async () => {
    fundAndOpenGate()
    await propose()
    expect(await call('funds_settle', { id: 'p2' })).toMatch(/TOOL ERROR.*proposed/)
    runFundsCommand('/funds approve p2')
    runFundsCommand('/funds placed p2 0.41')
    let result = ''
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(String(url)).toContain('tickers=KX-RAIN-OCT')
      return Response.json({ markets: [{ ticker: 'KX-RAIN-OCT', status: result ? 'finalized' : 'active', result }] })
    }))
    expect(await call('funds_settle', { id: 'p2' })).toMatch(/not settled.*no result yet/)
    expect(loadFunds().positions.find(p => p.id === 'p2')!.status).toBe('placed')
    result = 'yes'
    expect(await call('funds_settle', { id: 'p2' })).toMatch(/settled from Kalshi \(result yes\): won, P\/L \$/)
    expect(loadFunds().positions.find(p => p.id === 'p2')).toMatchObject({ status: 'settled', outcome: 'won', settledBy: 'kalshi' })
  })

  it('a Kalshi settlement can trip the loss stop, and no tool can lift it', async () => {
    fundAndOpenGate()
    runFundsCommand('/funds limits daily=2')
    await propose()
    runFundsCommand('/funds approve p2')
    runFundsCommand('/funds placed p2')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ markets: [{ ticker: 'KX-RAIN-OCT', status: 'finalized', result: 'no' }] })))
    expect(await call('funds_settle', { id: 'p2' })).toMatch(/lost/)
    expect(loadFunds().halted?.reason).toMatch(/Daily loss limit hit/)
    expect(await propose({ market: 'KX-NEXT' })).toMatch(/TOOL ERROR.*HALTED/)
    expect(FORGE_TOOLS.some(t => /resume|limit|deposit|approve/.test(t.name) && t.name.startsWith('funds_'))).toBe(false)
    expect(runFundsCommand('/funds resume')).toMatch(/^Resumed/)
  })

  it('leaves non-Kalshi settlement to the owner', async () => {
    fundAndOpenGate()
    await propose({ venue: 'sportsbook', market: 'Chiefs ML Sunday' })
    runFundsCommand('/funds approve p2')
    runFundsCommand('/funds placed p2')
    expect(await call('funds_settle', { id: 'p2' })).toMatch(/owner settles it with \/funds settle p2/)
  })

  it('auto-approve off by default: a proposal simply waits, with no auto-approve note', async () => {
    fundAndOpenGate()
    const out = await propose()
    expect(out).not.toMatch(/Auto-approve/)
    expect(loadFunds().positions.find(p => p.id === 'p2')!.status).toBe('proposed')
  })

  it('auto-approve on: proposing runs the execution layer at once (it refuses here: no Kalshi key in this browser)', async () => {
    fundAndOpenGate()
    runFundsCommand('/funds limits autoapprove=100')
    const out = await propose()
    // The hook fired and routed through kalshiExecution's approve path: its named refusal
    // is reported, and the refusal leaves the proposal standing, exactly like a typed approve.
    expect(out).toMatch(/Auto-approve \(the owner's \/funds limits autoapprove setting\)/)
    expect(out).toMatch(/no Kalshi API key in this browser/)
    expect(loadFunds().positions.find(p => p.id === 'p2')!.status).toBe('proposed')
  })

  it('settle "all" settles every placed Kalshi position that has a result, paper included', async () => {
    runFundsCommand('/funds limits cap=1000')
    expect(await propose({ market: 'KX-A', mode: 'paper' })).toMatch(/Proposed p1 \[paper, open\]/)
    expect(await propose({ market: 'KX-B', mode: 'paper' })).toMatch(/Proposed p2 \[paper, open\]/)
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const ticker = new URL(String(url)).searchParams.get('tickers')
      return Response.json({ markets: [{ ticker, status: ticker === 'KX-A' ? 'finalized' : 'active', result: ticker === 'KX-A' ? 'yes' : '' }] })
    }))
    const out = await call('funds_settle', { id: 'all' })
    expect(out).toMatch(/p1 \[paper\] settled from Kalshi \(result yes\): won/)
    expect(out).toMatch(/p2 not settled: Kalshi shows KX-B as active with no result yet/)
  })
})

describe('auto-approve execution deps (the tool path\'s order hooks)', () => {
  beforeEach(() => clearErrorLog())
  // A plain object literal (not the file's `as never` ctx): spreading a `never` is a type error.
  const runCtx = (over: Record<string, unknown> = {}) => ({
    ghToken: 't', ghOwner: 'o', ghRepo: 'r', actor: 'operator',
    requestGuardianApproval: async () => true, ...over,
  })

  it('passes the run ID and the visitor flag from the run context', () => {
    const withToken = autoApproveExecutionDeps(runCtx({ runId: 'run-ctx-1', ghToken: 'tok', publicRelayUrl: 'https://relay.example' }) as never)
    expect(withToken.runId).toBe('run-ctx-1')
    expect(withToken.visitor).toBe(false)
    const visitor = autoApproveExecutionDeps(runCtx({ runId: 'run-ctx-2', ghToken: '  ', publicRelayUrl: 'https://relay.example' }) as never)
    expect(visitor.visitor).toBe(true)
  })

  it('onPlaced journals the irreversible entry carrying the order id', () => {
    const recorded: Array<{ kind: string; label: string }> = []
    const deps = autoApproveExecutionDeps(runCtx({ journal: { record: (e: { kind: string; label: string }) => recorded.push(e) } }) as never)
    deps.onPlaced!({ positionId: 'p2', ticker: 'KX-T', clientOrderId: 'fc-p2-1', orderId: 'ord-9', fillCount: 3 })
    expect(recorded).toHaveLength(1)
    expect(recorded[0].kind).toBe('irreversible')
    expect(recorded[0].label).toContain('ord-9')
  })

  it('onFailure writes to the tool error log with the run ID and context', () => {
    const deps = autoApproveExecutionDeps(runCtx({ runId: 'run-ctx-3' }) as never)
    deps.onFailure!({ stage: 'balance', message: 'Kalshi refused the balance check.', positionId: 'p2', ticker: 'KX-T' })
    const entries = getErrorLog().filter(e => e.source === 'kalshi')
    expect(entries.length).toBeGreaterThan(0)
    expect(entries[0].message).toBe('Kalshi refused the balance check.')
    expect(entries[0].details).toContain('run-ctx-3')
    expect(entries[0].details).toContain('p2')
    expect(entries[0].details).toContain('balance')
  })

  it('a refusal through funds_propose reaches the error log carrying the run ID', async () => {
    fundAndOpenGate()
    runFundsCommand('/funds limits autoapprove=100')
    const out = await executeTool({ id: '1', name: 'funds_propose', input: {
      venue: 'kalshi', market: 'KX-RAIN-OCT', side: 'yes', price: 0.4, probability: 0.55,
      rationale: 'NWS forecast gives 60% rain for the window and three models agree; the market lags the update.',
      sources: ['https://weather.gov/forecast'],
    } }, runCtx({ runId: 'run-propose-1' }) as never)
    expect(out).toMatch(/Auto-approve/)
    expect(out).toMatch(/no Kalshi API key in this browser/)
    const entries = getErrorLog().filter(e => e.source === 'kalshi' && e.message.includes('no API key'))
    expect(entries.length).toBeGreaterThan(0)
    expect(entries[0].details).toContain('run-propose-1')
    expect(loadFunds().positions.find(p => p.id === 'p2')!.status).toBe('proposed')
  })
})

// Owner directive 2026-10-24 (A), through the tool the model actually calls.
describe('funds_propose on a fight market', () => {
  const THREAD = 'https://www.reddit.com/r/MMA/comments/1xdgbl2/petr_yan_vs_merab_dvalishvili_faceoff/'
  const CHAIN = [
    'REMATCH SEQUENCE: Merab won decisively in 2023; Yan took the belt back in Dec 2025. This is the rubber match.',
    'BOOK LINE: DraftKings Yan -150 and BetMGM -148, no-vig 58.1% for Yan; Kalshi YES ask 55c.',
    'STATS & FACTS: Yan 4-fight streak; both made weight at the official weigh-ins (source: ufc.com).',
    'MATCHUP NEUTRALIZATION: primary path: Merab wins by wrestling pace and top control, Yan by standing Muay Thai; neutralization: demonstrated — Yan defended the takedowns for five rounds in the second fight after losing the first to the wrestling; the fight that remains: a standing fight, which favors Yan.',
    'SENTIMENT SCAN: unavailable — Reddit search was blocked for the fetcher (HTTP 403), so the crowd weighs 0%.',
    'FIGHTER STATE: unavailable — no own-account post was indexed for either fighter in the last 60 days.',
    'FUSION: range: 58-65%; the book line and facts carry it; sentiment weight: 0%; fighter-state weight: 0%.',
    'EDGE: net edge: 6¢ per contract after the 2¢ fee and the 1¢ spread.',
    'FALSIFIER: a late injury report for Yan, or the line moving to Merab -120 before the walkout.',
  ].join('\n')
  const fightPropose = (over: Record<string, unknown> = {}) => propose({
    market: 'KXUFCFIGHT-26OCT24YANDVA-YAN', price: 0.55, probability: 0.62, rationale: CHAIN, sources: [THREAD], ...over,
  })

  it('refuses a hunch, teaches the template in the same answer, and records nothing', async () => {
    fundAndOpenGate()
    const out = await fightPropose({ rationale: 'Yan is the champion and the market is too low on him, I like this one a lot.' })
    expect(out).toMatch(/TOOL ERROR.*Not proposed:.*fight-card market, so the rationale must follow the fight template/)
    expect(out).toContain('REMATCH SEQUENCE: <')
    expect(out).toContain('FALSIFIER: <')
    expect(loadFunds().positions).toHaveLength(0)
  })

  it('accepts the chain, with the sentiment scan honestly unavailable, and the proposal waits for the owner', async () => {
    fundAndOpenGate()
    const out = await fightPropose()
    expect(out).toMatch(/Proposed p\d+ \[real, proposed\] kalshi "KXUFCFIGHT-26OCT24YANDVA-YAN" YES/)
    expect(out).toMatch(/Waiting for the owner/)
    const [stored] = loadFunds().positions
    expect(stored.rationale).toContain('SENTIMENT SCAN: unavailable — Reddit search was blocked')
    expect(stored.rationale).toContain('FALSIFIER:')
  })
})

// Owner directive 2026-10-24 (B), through the tools the model calls: the lean is kept at proposal time and compared at settle time.
describe('the crowd, from funds_propose to funds_settle', () => {
  const THREAD = 'https://www.reddit.com/r/MMA/comments/1xdgbl2/petr_yan_vs_merab_dvalishvili_faceoff/'
  const CHAIN = [
    'REMATCH SEQUENCE: Merab won decisively in 2023; Yan took the belt back in Dec 2025. This is the rubber match.',
    'BOOK LINE: DraftKings Yan -150 and BetMGM -148, no-vig 58.1% for Yan; Kalshi YES ask 55c.',
    'STATS & FACTS: Yan 4-fight streak; both made weight at the official weigh-ins (source: ufc.com).',
    'MATCHUP NEUTRALIZATION: primary path: Merab wins by wrestling pace and top control, Yan by standing Muay Thai; neutralization: demonstrated — Yan defended the takedowns for five rounds in the second fight after losing the first to the wrestling; the fight that remains: a standing fight, which favors Yan.',
    `SENTIMENT SCAN: r/MMA threads ${THREAD}. The crowd leans Merab: crowd lean: 44%. Record on comparable fights: 6 of 12 called correctly.`,
    'FIGHTER STATE: unavailable — no own-account post was indexed for either fighter in the last 60 days.',
    'FUSION: range: 58-65%; the book line and facts carry it; sentiment weight: 0%; fighter-state weight: 0%.',
    'EDGE: net edge: 6¢ per contract after the 2¢ fee and the 1¢ spread.',
    'FALSIFIER: a late injury report for Yan, or the line moving to Merab -120 before the walkout.',
  ].join('\n')
  const MARKET = 'KXUFCFIGHT-26OCT24YANDVA-YAN'

  it('the proposal echoes the lean it recorded; the settlement from Kalshi reports how the crowd compared', async () => {
    fundAndOpenGate()
    const out = await propose({ market: MARKET, price: 0.55, probability: 0.62, rationale: CHAIN, sources: [THREAD] })
    expect(out).toContain('Crowd snapshot recorded for the settle-time comparison: leans 44% for this side; weight 0%; 1 link.')
    const id = loadFunds().positions[0].id
    runFundsCommand(`/funds approve ${id}`)
    runFundsCommand(`/funds placed ${id} 0.56`)
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ markets: [{ ticker: MARKET, status: 'finalized', result: 'no' }] })))
    const settled = await call('funds_settle', { id })
    expect(settled).toMatch(/settled from Kalshi \(result no\): lost, P\/L -\$/)
    expect(settled).toContain('Crowd: leaned 44% for this side and it lost (called it right); squared error crowd 0.194 vs your estimate 0.384 vs price 0.314')
    expect(await call('funds_status', {})).toContain('Crowd record (only fights ForgeClaw proposed on, so a biased sample): 1 scored, called 1/1 right (100%)')
  })

  it('a position with no snapshot settles exactly as before, with no crowd line', async () => {
    fundAndOpenGate()
    await propose()
    runFundsCommand('/funds approve p2')
    runFundsCommand('/funds placed p2 0.41')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ markets: [{ ticker: 'KX-RAIN-OCT', status: 'finalized', result: 'yes' }] })))
    const settled = await call('funds_settle', { id: 'p2' })
    expect(settled).toMatch(/settled from Kalshi \(result yes\): won/)
    expect(settled).not.toContain('Crowd:')
  })
})
