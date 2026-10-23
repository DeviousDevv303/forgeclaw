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
