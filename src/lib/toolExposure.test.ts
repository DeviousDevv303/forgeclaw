// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SHELL_EXEC_GUIDANCE } from './toolExposure'

// SHELL_EXEC_GUIDANCE makes factual claims about .github/workflows/shell-exec.yml. If the workflow
// changes (installs deps, deepens the checkout, persists credentials, changes the limit), this fails so
// the text Claude is told gets updated instead of silently becoming false.
describe('shell_exec guidance matches the workflow it describes', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/shell-exec.yml', import.meta.url), 'utf8')

  it('no git credentials: "cannot push"', () => {
    expect(workflow).toMatch(/persist-credentials:\s*false/)
    expect(SHELL_EXEC_GUIDANCE).toContain('cannot push')
  })

  it('no dependency install step: "node_modules is not installed"', () => {
    expect(workflow).not.toMatch(/npm (ci|install)|setup-node/)
    expect(SHELL_EXEC_GUIDANCE).toContain('node_modules is not installed')
  })

  it('default shallow checkout: "one commit deep"', () => {
    expect(workflow).not.toMatch(/fetch-depth/)
    expect(SHELL_EXEC_GUIDANCE).toContain('one commit deep')
  })

  it('10-minute job limit', () => {
    expect(workflow).toMatch(/timeout-minutes:\s*10\b/)
    expect(SHELL_EXEC_GUIDANCE).toContain('limited to 10 minutes')
  })
})

describe('self-modification guidance', () => {
  it('tells the model to diagnose failed runs itself and never to trust a step name', async () => {
    const { SELF_SCULPT_GUIDANCE } = await import('./toolExposure')
    expect(SELF_SCULPT_GUIDANCE).toMatch(/pre-approved debugging/)
    expect(SELF_SCULPT_GUIDANCE).toMatch(/instead of asking the owner to choose among options/)
    expect(SELF_SCULPT_GUIDANCE).toMatch(/step marked success is not proof/)
  })
})

describe('funds guidance playbook (PR B item 12)', () => {
  it('teaches weather first, with the named spread skip rule and the thin-book skip', async () => {
    const { FUNDS_GUIDANCE, FUNDS_WEATHER_MAX_SPREAD_CENTS } = await import('./toolExposure')
    expect(FUNDS_GUIDANCE).toContain('weather_forecast')
    expect(FUNDS_GUIDANCE).toContain('KXHIGH')
    expect(FUNDS_GUIDANCE).toContain(`wider than ${FUNDS_WEATHER_MAX_SPREAD_CENTS} cents`)
    expect(FUNDS_GUIDANCE).toMatch(/24h volume and open interest/)
  })

  it('econ second: a release needs its release time and a falsifier', async () => {
    const { FUNDS_GUIDANCE } = await import('./toolExposure')
    expect(FUNDS_GUIDANCE).toContain('CPI')
    expect(FUNDS_GUIDANCE).toMatch(/release time and a falsifier/)
    expect(FUNDS_GUIDANCE).toMatch(/no falsifier, no proposal/)
  })

  it('sizing learns per series: unproven or losing series are staked down', async () => {
    const { FUNDS_GUIDANCE } = await import('./toolExposure')
    expect(FUNDS_GUIDANCE).toMatch(/fewer than 5 settled positions is staked at half/)
    expect(FUNDS_GUIDANCE).toMatch(/lost money over 5 or more at a quarter/)
  })

  it('every bet carries evidence, a stated confidence and a falsifier (item 13)', async () => {
    const { FUNDS_GUIDANCE } = await import('./toolExposure')
    expect(FUNDS_GUIDANCE).toContain('deep_research')
    expect(FUNDS_GUIDANCE).toMatch(/structured data/)
    expect(FUNDS_GUIDANCE).toMatch(/a stated confidence, and a falsifier/)
    expect(FUNDS_GUIDANCE).toMatch(/does not belong in a plan/)
  })

  it('point 6 is true when autoapprove is set: the model must not re-propose after a non-Placed outcome', async () => {
    // Claude's B2 fix: the old "You cannot approve, place orders or move money" was false
    // once the owner's autoapprove limit lets funds_propose place.
    const { FUNDS_GUIDANCE } = await import('./toolExposure')
    expect(FUNDS_GUIDANCE).not.toContain('You cannot approve, place orders or move money')
    expect(FUNDS_GUIDANCE).toMatch(/autoapprove above zero/)
    expect(FUNDS_GUIDANCE).toMatch(/funds_propose reports the placement in its own output/)
    expect(FUNDS_GUIDANCE).toMatch(/do not re-propose that market/)
    expect(FUNDS_GUIDANCE).toMatch(/stack a second order/)
  })
})

describe('funds guidance — Master Money Multiplier, Module 1 (research-backed, 2026-10-23)', () => {
  it('net edge is computed per contract and must clear the taker bar; maker is future-only', async () => {
    const g = await import('./toolExposure')
    expect(g.FUNDS_MIN_NET_EDGE_TAKER_CENTS).toBe(5)
    expect(g.FUNDS_MIN_NET_EDGE_MAKER_CENTS).toBe(3)
    expect(g.FUNDS_GUIDANCE).toMatch(/net = q − price − fee per contract/)
    expect(g.FUNDS_GUIDANCE).toContain(`at least ${g.FUNDS_MIN_NET_EDGE_TAKER_CENTS} cents`)
    expect(g.FUNDS_GUIDANCE).toContain(`at least ${g.FUNDS_MIN_NET_EDGE_MAKER_CENTS} cents`)
    expect(g.FUNDS_GUIDANCE).toMatch(/taker-at-cross by design/)
    expect(g.FUNDS_GUIDANCE).toMatch(/maker \(resting limit\) execution is NOT built/)
    expect(g.FUNDS_GUIDANCE).toMatch(/Becker \(2026\)/)
  })

  it('extreme buckets need the higher bar, and cheap contracts are never directional bets', async () => {
    const g = await import('./toolExposure')
    expect(g.FUNDS_EXTREME_PRICE_LOW_CENTS).toBe(15)
    expect(g.FUNDS_EXTREME_PRICE_HIGH_CENTS).toBe(85)
    expect(g.FUNDS_MIN_NET_EDGE_EXTREME_CENTS).toBe(10)
    expect(g.FUNDS_LONGSHOT_MAX_PRICE_CENTS).toBe(10)
    expect(g.FUNDS_GUIDANCE).toContain(`at least ${g.FUNDS_MIN_NET_EDGE_EXTREME_CENTS} cents`)
    expect(g.FUNDS_GUIDANCE).toContain(`priced at ${g.FUNDS_LONGSHOT_MAX_PRICE_CENTS} cents or less as a directional bet`)
    expect(g.FUNDS_GUIDANCE).toMatch(/lose over 60%/)
    expect(g.FUNDS_GUIDANCE).toMatch(/buy the NO or the complementary favorite/)
  })

  it('weather proposals are priced for the settlement station and its named source', async () => {
    const { FUNDS_GUIDANCE } = await import('./toolExposure')
    expect(FUNDS_GUIDANCE).toMatch(/The Weather Company/)
    expect(FUNDS_GUIDANCE).toMatch(/2026-08-14/)
    expect(FUNDS_GUIDANCE).toMatch(/Central Park \(KNYC\)/)
    expect(FUNDS_GUIDANCE).toMatch(/Midway \(KMDW\)/)
    expect(FUNDS_GUIDANCE).toMatch(/state the station and the settlement source/)
  })

  it('weather probability integrates a bias-corrected distribution, never a point forecast', async () => {
    const g = await import('./toolExposure')
    expect(g.FUNDS_ENSEMBLE_STAND_DOWN_SPREAD_F).toBe(3)
    expect(g.FUNDS_GUIDANCE).toMatch(/integrating a bias-corrected error distribution/)
    expect(g.FUNDS_GUIDANCE).toMatch(/never from a point forecast/)
    expect(g.FUNDS_GUIDANCE).toMatch(/σ ≈ 2\.8°F/)
    expect(g.FUNDS_GUIDANCE).toMatch(/NYC −1\.1°F, MIA \+3\.7°F, LAX −4\.0°F/)
    expect(g.FUNDS_GUIDANCE).toMatch(/fat tails are measured/)
    expect(g.FUNDS_GUIDANCE).toContain(`disagree by ${g.FUNDS_ENSEMBLE_STAND_DOWN_SPREAD_F}°F or more`)
    expect(g.FUNDS_GUIDANCE).toMatch(/stand down/)
  })

  it('benchmark honesty: the market beats public forecasts, so disagreement alone is not an edge', async () => {
    const { FUNDS_GUIDANCE } = await import('./toolExposure')
    expect(FUNDS_GUIDANCE).toMatch(/beats the NBM by about 10% RMSE/)
    expect(FUNDS_GUIDANCE).toMatch(/blend of ALL public forecasts by 3–4%/)
    expect(FUNDS_GUIDANCE).toMatch(/merely disagreeing with the price is not an edge/)
    expect(FUNDS_GUIDANCE).toMatch(/name the specific information the market has not absorbed/)
    expect(FUNDS_GUIDANCE).toMatch(/no named information, no proposal/)
  })

  it('sizing: quarter-Kelly formula, one city-day event is one bet, no 1-contract orders', async () => {
    const { FUNDS_GUIDANCE } = await import('./toolExposure')
    expect(FUNDS_GUIDANCE).toMatch(/f = 0\.25 × \(q − price\) \/ \(1 − price\)/)
    expect(FUNDS_GUIDANCE).toMatch(/All buckets in one city-day event are ONE bet/)
    expect(FUNDS_GUIDANCE).toMatch(/Never split a position into 1-contract orders/)
    expect(FUNDS_GUIDANCE).toMatch(/round-up tax/)
    expect(FUNDS_GUIDANCE).toMatch(/unvalidated: keep max_stake small/)
  })

  it('economics: enter before the 8:29 AM ET close; quantified benchmark gap or no trade', async () => {
    const { FUNDS_GUIDANCE } = await import('./toolExposure')
    expect(FUNDS_GUIDANCE).toMatch(/close at 8:29 AM ET for the 8:30 AM ET print/)
    expect(FUNDS_GUIDANCE).toMatch(/Never fade a headline-CPI or day-before-FOMC price on judgment alone/)
    expect(FUNDS_GUIDANCE).toMatch(/Cleveland Fed nowcast/)
    expect(FUNDS_GUIDANCE).toMatch(/larger than that benchmark's historical print error/)
  })

  it('validation: Brier and calibration grading; fewer than 400 trades proves nothing', async () => {
    const { FUNDS_GUIDANCE } = await import('./toolExposure')
    expect(FUNDS_GUIDANCE).toMatch(/Brier score and calibration/)
    expect(FUNDS_GUIDANCE).toMatch(/fewer than 400 settled trades/)
    expect(FUNDS_GUIDANCE).toMatch(/proves nothing/)
  })
})
