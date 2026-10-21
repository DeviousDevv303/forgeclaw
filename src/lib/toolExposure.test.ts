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
