// @vitest-environment node
// ─── MANUS Live Acceptance: saved-agent GitHub capability path ───────────────
// Runs the ACTUAL operator request through the ACTUAL managed-agent runtime
// against the ACTUAL repository.
//
//   «Check my forge claw repo to see what it says it can do versus what it can
//     actually do so I can blend the two»
//
// The provider is scripted so the non-native (manual tool protocol) branch is
// exercised deterministically without consuming external model quota. Every tool
// call is dispatched through the real `executeTool()`, so the GitHub evidence in
// the transcript is live repository data rather than a fixture.
//
// Enable with FORGECLAW_E2E_GITHUB=1. A credential is used when present; the
// repository is public, so the read path is also exercised anonymously, and the
// assertions below state which mode actually ran rather than assuming one.
import { afterEach, describe, expect, it } from 'vitest'
import { runSubAgent } from './managedAgent'
import { FORGE_TOOLS, loadToolContext } from './forgeTools'
import type { ChatMessage } from './modelProviders'
import { resolveGithubToken } from './githubAuth'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

const storage = new MemoryStorage()
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })

const owner = process.env.FORGECLAW_E2E_OWNER || 'DeviousDevv303'
const repo = process.env.FORGECLAW_E2E_REPO || 'forgeclaw'
const token = (process.env.FORGECLAW_E2E_TOKEN || process.env.GH_TOKEN || resolveGithubToken() || '').trim()
const live = process.env.FORGECLAW_E2E_GITHUB === '1'
const authMode = token ? 'authenticated (PAT)' : 'anonymous (public read, no PAT in this environment)'

afterEach(() => storage.clear())

describe.skipIf(!live)('live acceptance — the operator request reaches the repository', () => {
  it('inspects the real repository and answers from live evidence', async () => {
    console.log(`[MANUS] live acceptance auth mode: ${authMode}`)
    const request = 'Check my forge claw repo to see what it says it can do versus what it can actually do so I can blend the two'

    let turn = 0
    const seen: Array<{ systemPrompt: string; messages: ChatMessage[] }> = []
    const callProviderFn = (async (
      _provider: unknown,
      _model: unknown,
      systemPrompt: string,
      messages: ChatMessage[],
    ) => {
      seen.push({ systemPrompt, messages: messages.map(m => ({ ...m })) })
      turn += 1
      if (turn === 1) {
        return {
          text: ['Inspecting the configured repository.', '```tool_call', '{"name":"github_repo_state","arguments":{}}', '```', 'STATUS: IN_PROGRESS'].join('\n'),
          provider: 'nexus',
          model: 'scripted',
        }
      }
      if (turn === 2) {
        return {
          text: [
            'Reading the repository root and its declared capability.',
            '```tool_call',
            '{"name":"github_list_files","arguments":{"path":""}}',
            '```',
            '```tool_call',
            '{"name":"github_read_file","arguments":{"path":"package.json"}}',
            '```',
            'STATUS: IN_PROGRESS',
          ].join('\n'),
          provider: 'nexus',
          model: 'scripted',
        }
      }
      return { text: 'STATUS: COMPLETE — grounded in the tool results above.', provider: 'nexus', model: 'scripted' }
    }) as never

    const reports: Array<{ nativeTools: boolean; catalogTools: string[]; unavailableTools: string[] }> = []
    const result = await runSubAgent(
      'You are the ForgeClaw GitHub Coding Specialist. Inspect the configured repository and answer from live evidence.',
      request,
      undefined,
      'nexus',
      'qwen',
      '',
      FORGE_TOOLS,
      { ...loadToolContext(), ghToken: token, ghOwner: owner, ghRepo: repo, agentId: 'github-coding-specialist', runId: 'acceptance-run' },
      { capability: 'coding-readonly', onBudget: r => reports.push(r), callProviderFn },
    )

    const toolOutputs = seen.flatMap(s => s.messages.filter(m => m.role === 'tool').map(m => String(m.content)))

    // 1. the runtime recognized the provider has no native tools and used the manual protocol
    expect(reports[0].nativeTools).toBe(false)
    expect(seen[0].systemPrompt).toContain('```tool_call')
    // 2. the existing GitHub read tools were offered
    expect(reports[0].catalogTools).toContain('github_repo_state')
    expect(reports[0].catalogTools).toContain('github_read_file')
    // 3. real tool calls were dispatched
    expect(toolOutputs.length).toBeGreaterThanOrEqual(3)
    // 4. actual repository data came back (live HEAD, root listing, file contents)
    expect(toolOutputs.some(o => o.includes(`${owner}/${repo}`) && o.includes('HEAD:'))).toBe(true)
    expect(toolOutputs.some(o => o.includes('Contents of /'))).toBe(true)
    expect(toolOutputs.some(o => o.includes('File: package.json') && o.includes('"name": "forgeclaw"'))).toBe(true)
    // 5. no tool call failed — the real read path worked. Rate limiting is the one
    // environment-dependent failure, and it is reported rather than hidden.
    const failures = toolOutputs.filter(o => o.startsWith('[TOOL ERROR]'))
    expect(failures.join('\n')).not.toMatch(/No GitHub token configured/)
    if (token) expect(failures).toHaveLength(0)
    // 6. the agent used the data and continued instead of asking for a paste
    expect(result).toContain('STATUS: COMPLETE')
    expect(result).not.toContain('tool_call')
    expect(result).not.toMatch(/paste|send me the (repo|code)|provide the (repo|contents)/i)
    // 7. a read-only profile never received a write tool
    expect(reports[0].catalogTools).not.toContain('github_write_file')
  }, 60_000)
})
