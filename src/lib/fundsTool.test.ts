// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeTool, FORGE_TOOLS } from './forgeTools'
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
    expect(out).toMatch(/Proposed p2 \[real, proposed\] kalshi "KX-RAIN-OCT" YES x119 @ \$0\.40/)
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
    runFundsCommand('/funds limits daily=3')
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
