// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { executeTool, loadToolContext } from './forgeTools'

// Area 1 (shell commands under Nexus) — the dispatch-side half. A Nexus segment becomes a
// normal app tool call (pinned in ai/nexusCapability.test.ts); these pin what executeTool
// itself does with that call BEFORE any network traffic: argument validation failures come
// back as [TOOL ERROR] strings, which buildNexusTranscript then injects as <|result:error|>
// spans — never as prose the model (or the owner) could mistake for command output.

const withToken = { ...loadToolContext(), ghToken: 't', ghOwner: 'o', ghRepo: 'r', guardianPosture: 'autonomous' as const }
const noToken = { ...loadToolContext(), ghToken: '', ghOwner: 'o', ghRepo: 'r', guardianPosture: 'autonomous' as const }

describe('shell_exec argument validation (no dispatch happens)', () => {
  it('refuses a call with no command', async () => {
    const out = await executeTool({ id: '1', name: 'shell_exec', input: {} }, withToken)
    expect(out).toBe('[TOOL ERROR] shell_exec requires a command.')
  })

  it('refuses a working_directory outside the checked-out repository', async () => {
    const out = await executeTool({ id: '2', name: 'shell_exec', input: { command: 'ls', working_directory: '/etc' } }, withToken)
    expect(out).toContain('[TOOL ERROR]')
    expect(out).toContain('must resolve inside the checked-out repository')
  })

  it('checks the working directory before the token, so the refusal names the real problem', async () => {
    const out = await executeTool({ id: '3', name: 'shell_exec', input: { command: 'ls', working_directory: '/etc' } }, noToken)
    expect(out).toContain('must resolve inside the checked-out repository')
  })

  it('refuses a valid command with neither a GitHub token nor a family code', async () => {
    const out = await executeTool({ id: '4', name: 'shell_exec', input: { command: 'git status --short', working_directory: '.' } }, noToken)
    expect(out).toBe('[TOOL ERROR] No GitHub token configured. Add gh_token in memory or settings.')
  })
})
