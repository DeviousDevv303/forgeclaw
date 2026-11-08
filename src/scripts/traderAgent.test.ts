// @vitest-environment node
// The Nexus Trader agent (.github/scripts/trader_agent.py + .github/workflows/trader-agent.yml). Owner order 2026-11-08, verbatim:
// "They can do everything. Kill switch, hold, exit, entry, bet down, bet up. They do everything autonomously." The default mode is
// therefore LIVE in both the script and the workflow, and this test fails if either is turned back into a shadow or approval default.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(p, 'utf8')

describe('the trader agent', () => {
  it('passes its offline python suite (fake MCP server, fake model)', () => {
    const r = spawnSync('python3', ['-B', '-m', 'unittest', 'discover', '-s', '.github/scripts', '-p', 'test_trader_agent.py'],
      { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
    expect(r.stderr, r.stdout).toMatch(/\nOK\s*$/)
  }, 60_000)

  it('runs live by default in the script and the workflow (owner order: full autonomy)', () => {
    expect(read('.github/scripts/trader_agent.py')).toMatch(/^DEFAULT_AGENT_MODE = "live"$/m)
    expect(read('.github/workflows/trader-agent.yml')).toContain("AGENT_MODE: ${{ vars.AGENT_MODE || 'live' }}")
  })

  it('keeps the owner token in Actions secrets and leaves no git credential on disk', () => {
    const wf = read('.github/workflows/trader-agent.yml')
    expect(wf).toContain('NEXUS_OWNER_TOKEN: ${{ secrets.NEXUS_OWNER_TOKEN }}')
    expect(wf).toContain('persist-credentials: false')
    expect(wf).toMatch(/^permissions:\n {2}contents: read$/m)
  })
})
