// @vitest-environment node
// ─── End-to-End Tool Execution Chain ────────────────────────────────────────
// Written by MANUS. Proves the runtime path the operator asked for:
//
//   NEXUS → TOOL DISPATCHER → TOOL → TOOL RESULT → NEXUS → CONCISE RESPONSE
//
// It exercises the real dispatcher (`executeTool`), the real tool schemas, the real
// attribution contract and the real persistence layer. The GitHub legs run against
// the live API when FORGECLAW_E2E_GITHUB=1 and a PAT is present, and skip otherwise
// so the suite stays green offline. Nothing here reads or writes Ollama/Termux.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FORGE_TOOLS, executeTool, loadToolContext } from './forgeTools'
import {
  buildAttributedCommitMessage,
  isAttributedCommitMessage,
  isGenericCommitMessage,
  applyAttributionContract,
  FORGECLAW_AGENT_ID,
  FORGECLAW_ORCHESTRATOR_ID,
} from './githubAttribution'
import { loadCodingAgentState, saveCodingAgentState, clearCodingAgentState, restoreCodingAgentState } from './codingAgentState'
import {
  parseRepoState,
  isCodingTaskRequest,
  isExplicitShellRequest,
  extractExplicitShellCommand,
  selectRequestTools,
  buildRuntimeRequestContext,
  measureRequestMetrics,
  CANONICAL_IDENTITY,
} from './codingAgentRuntime'
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

const toolNames = FORGE_TOOLS.map(tool => tool.name)
const ctx = () => ({ ...loadToolContext(), ghToken: '' })

afterEach(() => {
  storage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('dispatcher integrity (offline)', () => {
  it('exposes every capability the coding agent needs', () => {
    for (const required of [
      'github_read_file', 'github_write_file', 'github_list_files', 'github_search_code',
      'github_repo_state', 'github_verify_commit', 'coding_task_update',
      'run_js', 'memory_write', 'memory_read', 'spawn_agent', 'ask_deepseek',
    ]) {
      expect(toolNames).toContain(required)
    }
  })

  it('has no duplicate tool name in the registry', () => {
    expect(new Set(toolNames).size).toBe(toolNames.length)
  })

  it('returns a tool result for run_js (TOOL → TOOL RESULT)', async () => {
    const output = await executeTool({ id: 'e2e-js', name: 'run_js', input: { code: 'return [1,2,3].length' } }, ctx())
    expect(output).toBe('3')
  })

  it('returns a structured error result instead of throwing (error handling)', async () => {
    const output = await executeTool({ id: 'e2e-bad', name: 'run_js', input: { code: 'throw new Error("boom")' } }, ctx())
    expect(output.startsWith('[TOOL ERROR]')).toBe(true)
    expect(output).toContain('boom')
  })

  it('rejects an unknown tool without crashing the loop', async () => {
    const output = await executeTool({ id: 'e2e-unknown', name: 'not_a_tool', input: {} }, ctx())
    expect(output).toContain('[TOOL ERROR]')
    expect(output).toContain('Unknown tool')
  })

  it('persists memory through the dispatcher (survives reload)', async () => {
    await executeTool({ id: 'e2e-mem-w', name: 'memory_write', input: { key: 'e2e', value: 'persisted' } }, ctx())
    const read = await executeTool({ id: 'e2e-mem-r', name: 'memory_read', input: { key: 'e2e' } }, ctx())
    expect(read).toBe('persisted')
  })

  it('gates repository writes on a configured token', async () => {
    const output = await executeTool(
      { id: 'e2e-write', name: 'github_write_file', input: { path: 'x.md', content: 'x', message: 'doc: x' } },
      ctx(),
    )
    expect(output).toContain('[TOOL ERROR]')
    expect(output).toContain('No GitHub token configured')
  })

  it('runs pwd from the repository root when a local model emits /workspace', async () => {
    let invocationId = ''
    let runListReads = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/dispatches')) {
        const payload = JSON.parse(String(init?.body)) as { inputs: { command: string; working_directory: string; invocation_id: string } }
        expect(payload.inputs.command).toBe('pwd')
        expect(payload.inputs.working_directory).toBe('.')
        invocationId = payload.inputs.invocation_id
        return new Response(null, { status: 204 })
      }
      if (url.pathname.endsWith('/runs')) {
        expect(url.searchParams.get('per_page')).toBe('100')
        expect(init?.cache).toBe('no-store')
        runListReads += 1
        if (runListReads === 1) return Response.json({ workflow_runs: [] })
        return Response.json({ workflow_runs: [{
          id: 4242,
          name: `Shell exec ${invocationId}`,
          display_title: `Shell exec ${invocationId}`,
          event: 'workflow_dispatch',
          status: 'queued',
          conclusion: null,
          created_at: new Date().toISOString(),
          head_branch: 'main',
          html_url: 'https://github.com/DeviousDevv303/forgeclaw/actions/runs/4242',
          run_number: 99,
        }] })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const output = await executeTool({
      id: 'pwd-workspace-alias',
      name: 'shell_exec',
      input: { command: 'pwd', working_directory: '/workspace', wait: false },
    }, { ...ctx(), ghToken: 'test-token', ghOwner: 'DeviousDevv303', ghRepo: 'forgeclaw' })

    expect(output).toContain('Shell execution dispatched.')
    expect(output).toContain('id: 4242')
    expect(invocationId).toMatch(/^shell-/)
    expect(runListReads).toBe(2)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('dispatches the exact ForgeClaw reasoning question and supplied project context to the fixed workflow without NEXUS learning', async () => {
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()
    zip.file('result.txt', 'The capital of France is Paris.')
    const zipBytes = await zip.generateAsync({ type: 'arraybuffer' })
    let dispatchedUrl = ''
    let payload: { ref: string; inputs: { task: string; context: string; nexus_learning: string; invocation_id: string } } | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/deepseek-16b.yml/dispatches')) {
        dispatchedUrl = url
        payload = JSON.parse(String(init?.body)) as NonNullable<typeof payload>
        return new Response(null, { status: 204 })
      }
      if (url.includes('/deepseek-16b.yml/runs?')) {
        return Response.json({ workflow_runs: [{
          id: 84,
          name: `DeepSeek 16B ${payload?.inputs.invocation_id}`,
          display_title: `DeepSeek 16B ${payload?.inputs.invocation_id}`,
          event: 'workflow_dispatch',
          status: 'completed',
          conclusion: 'success',
          created_at: new Date().toISOString(),
          head_branch: 'main',
          html_url: 'https://github.com/DeviousDevv303/forgeclaw/actions/runs/84',
          run_number: 84,
        }] })
      }
      if (url.endsWith('/actions/runs/84')) {
        return Response.json({ id: 84, name: 'DeepSeek 16B', display_title: `DeepSeek 16B ${payload?.inputs.invocation_id}`, event: 'workflow_dispatch', status: 'completed', conclusion: 'success', created_at: new Date().toISOString(), head_branch: 'main', html_url: 'https://github.com/DeviousDevv303/forgeclaw/actions/runs/84', run_number: 84 })
      }
      if (url.endsWith('/actions/runs/84/artifacts?per_page=100')) {
        return Response.json({ artifacts: [{ name: `deepseek-${payload?.inputs.invocation_id}`, archive_download_url: 'https://example.test/deepseek.zip', expired: false }] })
      }
      // The mirror is probed first; a missing mirror falls through to the artifact.
      if (url.includes('raw.githubusercontent.com')) return new Response('', { status: 404 })
      if (url === 'https://example.test/deepseek.zip') return new Response(zipBytes, { status: 200 })
      throw new Error(`Unexpected fetch URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const output = await executeTool({
      id: 'direct-deepseek-test',
      name: 'ask_deepseek',
      input: {
        question: "Explain ForgeClaw's default reasoning flow. Tell me which model is primary and which is secondary.",
        context: 'ForgeClaw architecture facts: DeepSeek-Coder 6.7B primary; Qwen2.5 WebGPU 3B secondary.',
      },
    }, { ...ctx(), ghToken: 'test-token', ghOwner: 'DeviousDevv303', ghRepo: 'forgeclaw' })

    expect(dispatchedUrl).toBe('https://api.github.com/repos/DeviousDevv303/forgeclaw/actions/workflows/deepseek-16b.yml/dispatches')
    expect(payload?.inputs.task).toBe("Explain ForgeClaw's default reasoning flow. Tell me which model is primary and which is secondary.")
    expect(payload?.inputs.context).toBe('ForgeClaw architecture facts: DeepSeek-Coder 6.7B primary; Qwen2.5 WebGPU 3B secondary.')
    expect(payload?.inputs.nexus_learning).toBe('false')
    expect(payload?.inputs.invocation_id).toMatch(/^deepseek-/)
    expect(output).toContain('DeepSeek-16B completed')
    expect(output).toContain('The capital of France is Paris.')
    expect(output).not.toContain('learning candidate')
    // dispatch + runs list + run status + mirror probe + artifact list + artifact zip
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })

  it('generates an image through the complete dispatch, run, artifact, and registry pipeline', async () => {
    const JSZip = (await import('jszip')).default
    let dispatchedUrl = ''
    let payload: { ref: string; inputs: { prompt: string; style: string; width: string; height: string; invocation_id: string } } | undefined
    let invocationId = ''

    const zip = new JSZip()
    zip.file('generated_512x512.png', new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]))
    const zipBytes = await zip.generateAsync({ type: 'arraybuffer' })

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.endsWith('/actions/workflows/generate-image.yml/dispatches')) {
        dispatchedUrl = url
        payload = JSON.parse(String(init?.body)) as NonNullable<typeof payload>
        invocationId = payload.inputs.invocation_id
        return new Response(null, { status: 204 })
      }

      if (url.includes('/actions/workflows/generate-image.yml/runs?')) {
        return new Response(JSON.stringify({
          workflow_runs: [{
            id: 42,
            name: 'generate-image',
            display_title: `Generate image ${invocationId}`,
            event: 'workflow_dispatch',
            status: 'completed',
            conclusion: 'success',
            created_at: new Date(Date.now() + 1000).toISOString(),
            head_branch: 'main',
            html_url: 'https://github.com/DeviousDevv303/forgeclaw/actions/runs/42',
            run_number: 42,
          }],
        }), { status: 200 })
      }

      if (url.endsWith('/actions/runs/42')) {
        return new Response(JSON.stringify({
          id: 42,
          name: 'generate-image',
          display_title: `Generate image ${invocationId}`,
          event: 'workflow_dispatch',
          status: 'completed',
          conclusion: 'success',
          created_at: new Date(Date.now() + 1000).toISOString(),
          head_branch: 'main',
          html_url: 'https://github.com/DeviousDevv303/forgeclaw/actions/runs/42',
          run_number: 42,
        }), { status: 200 })
      }

      if (url.endsWith('/actions/runs/42/artifacts?per_page=100')) {
        return new Response(JSON.stringify({
          artifacts: [{
            id: 7,
            name: `generated-image-${invocationId}`,
            size_in_bytes: zipBytes.byteLength,
            archive_download_url: 'https://example.test/generated-image.zip',
            expired: false,
          }],
        }), { status: 200 })
      }

      if (url === 'https://example.test/generated-image.zip') {
        return new Response(zipBytes, {
          status: 200,
          headers: { 'Content-Type': 'application/zip' },
        })
      }

      throw new Error(`Unexpected fetch URL: ${url}`)
    })

    vi.stubGlobal('fetch', fetchMock)

    const output = await executeTool({
      id: 'direct-image-test',
      name: 'generate_image',
      input: { prompt: 'a red fox in a forge', style: 'artistic' },
    }, { ...ctx(), ghToken: 'test-token', ghOwner: 'DeviousDevv303', ghRepo: 'forgeclaw' })

    expect(dispatchedUrl).toBe('https://api.github.com/repos/DeviousDevv303/forgeclaw/actions/workflows/generate-image.yml/dispatches')
    expect(payload?.inputs.prompt).toContain('a red fox in a forge')
    expect(payload?.inputs.prompt).not.toContain('APPLICATIONIDENTITY')
    expect(payload?.inputs.prompt).not.toContain('RUNTIMESTATE')
    expect(payload?.inputs.style).toBe('artistic')
    expect(payload?.inputs.width).toBe('512')
    expect(payload?.inputs.height).toBe('512')
    expect(payload?.inputs.invocation_id).toMatch(/^sd-/)
    expect(output).toContain('Image generated (512x512')
    expect(output).toContain(`Invocation: ${invocationId}`)
    expect(output).toContain('Run: https://github.com/DeviousDevv303/forgeclaw/actions/runs/42')
    // The runtime probes the CORS-safe raw mirror before this legacy artifact fixture.
    expect(fetchMock).toHaveBeenCalledTimes(6)

    const { takeGeneratedImage } = await import('./imageArtifact')
    expect(takeGeneratedImage(invocationId)).toMatch(/^data:image\/png;base64,/)
    expect(takeGeneratedImage(invocationId)).toBeUndefined()
  })

  it('explains a rejected GitHub token after dispatch 401 without leaking it', async () => {
    const secret = 'ghp_test_secret_must_not_appear'
    const fetchMock = vi.fn(async () => new Response(null, { status: 401, statusText: 'Unauthorized' }))
    vi.stubGlobal('fetch', fetchMock)

    const output = await executeTool({
      id: 'shell-auth-401',
      name: 'shell_exec',
      input: { command: 'pwd', working_directory: '.', wait: false },
    }, { ...ctx(), ghToken: secret, ghOwner: 'DeviousDevv303', ghRepo: 'forgeclaw' })

    expect(output).toContain('GitHub rejected the saved token (401 Unauthorized)')
    expect(output).toContain('invalid, expired, revoked, or malformed')
    expect(output).toContain('Actions: Read and write')
    expect(output).not.toContain(secret)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('enforces Guardian at the dispatcher boundary even without an App caller', async () => {
    const output = await executeTool(
      { id: 'guardian-boundary', name: 'github_write_file', input: { path: 'x.md', content: 'x', message: 'doc: x' } },
      { ...ctx(), ghToken: 'test-token', tier1Active: true },
    )
    expect(output).toContain('[GUARDIAN BLOCK]')
    expect(output).toContain('no project-owned approval handler')
  })

  it('executes a protected write only after the context approval callback', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method
        ? new Response(JSON.stringify({ commit: { sha: 'approved123', html_url: 'https://github.com/x' } }), { status: 200 })
        : new Response(JSON.stringify({ sha: 'existing' }), { status: 200 }),
    ))
    const approved = vi.fn(async () => true)
    const output = await executeTool(
      { id: 'guardian-approved', name: 'github_write_file', input: { path: 'x.md', content: 'x', message: 'docs: x' } },
      { ...ctx(), ghToken: 'test-token', tier1Active: true, requestGuardianApproval: approved },
    )
    expect(approved).toHaveBeenCalledOnce()
    expect(output).toContain('approved123')
  })

  it('keeps coding state separate for saved agents', async () => {
    await executeTool({ id: 'agent-state', name: 'coding_task_update', input: { task: 'agent task', status: 'in_progress' } }, { ...ctx(), agentId: 'custom-agent-1' })
    expect(loadCodingAgentState('custom-agent-1').task).toBe('agent task')
    expect(loadCodingAgentState().task).not.toBe('agent task')
  })
})

describe('agent attribution contract', () => {
  it('builds a message naming MANUS, what changed, and why', () => {
    const message = buildAttributedCommitMessage({
      agentId: FORGECLAW_AGENT_ID,
      agentLabel: 'ForgeClaw Coding Specialist',
      what: 'tool dispatcher restores live repository state',
      why: 'The agent must identify current HEAD before editing',
      branch: 'main',
    })
    expect(message).toContain(FORGECLAW_ORCHESTRATOR_ID)
    expect(message).toContain('what:')
    expect(message).toContain('WHY:')
    expect(message).toContain(FORGECLAW_AGENT_ID)
    expect(isAttributedCommitMessage(message)).toBe(true)
  })

  it('rejects generic commit subjects', () => {
    for (const generic of ['fix', 'update', 'changes', 'WIP']) {
      expect(isGenericCommitMessage(generic)).toBe(true)
      expect(isAttributedCommitMessage(generic)).toBe(false)
    }
  })

  it('refuses attribution without an acting agent', () => {
    expect(() => buildAttributedCommitMessage({ agentId: '', agentLabel: '' })).toThrow(/agentId/)
  })

  it('states the attribution rule to native and manual tool callers', () => {
    const ruled = applyAttributionContract(FORGE_TOOLS)
    const write = ruled.find(tool => tool.name === 'github_write_file')
    expect(write?.description).toContain(FORGECLAW_ORCHESTRATOR_ID)
    expect(write?.description).toContain('generic')
    // Every other tool is untouched.
    expect(ruled.filter(t => t.name !== 'github_write_file').every((t, i) =>
      t.description === FORGE_TOOLS.filter(x => x.name !== 'github_write_file')[i].description,
    )).toBe(true)
  })

  it('applies attribution through the dispatcher when a write is authorized', async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method || 'GET', body: init?.body as string | undefined })
      if (!init?.method) return new Response(JSON.stringify({ sha: 'existing' }), { status: 200 })
      return new Response(JSON.stringify({ commit: { sha: 'abc1234def', html_url: 'https://github.com/x' } }), { status: 200 })
    }))
    saveCodingAgentState({ task: 'wire the dispatcher', branch: 'main' })

    const output = await executeTool(
      { id: 'e2e-attributed', name: 'github_write_file', input: { path: 'note.md', content: 'hello', message: 'docs: record dispatcher wiring' } },
      { ...ctx(), ghToken: 'test-token' },
    )

    const put = calls.find(call => call.method === 'PUT')
    expect(put).toBeDefined()
    const sent = JSON.parse(put!.body!) as { message: string }
    expect(sent.message).toContain(`agent: ${FORGECLAW_ORCHESTRATOR_ID}`)
    expect(sent.message).toContain('WHY:')
    expect(isGenericCommitMessage(sent.message.split('\n')[0])).toBe(false)
    // The result returns to NEXUS carrying the real commit coordinates.
    expect(output).toContain('abc1234def')
    expect(output).toContain('docs: record dispatcher wiring')
    // And the change is recorded against the persisted task.
    expect(loadCodingAgentState().filesModified).toContain('note.md')
    expect(loadCodingAgentState().lastCommitSha).toBe('abc1234def')
  })
})

describe('persistent agent state', () => {
  beforeEach(() => storage.clear())

  it('resumes an unfinished task and refuses to replay a completed one', () => {
    saveCodingAgentState({
      task: 'restore tool execution',
      taskStatus: 'in_progress',
      pendingSteps: ['verify commit'],
      headShaShort: '1f35568',
    })
    const resumed = restoreCodingAgentState()
    expect(resumed?.task).toBe('restore tool execution')
    expect(resumed?.pendingSteps).toEqual(['verify commit'])
    expect(resumed?.headShaShort).toBe('1f35568')

    saveCodingAgentState({ taskStatus: 'complete' })
    expect(restoreCodingAgentState()).toBeNull()
  })

  it('never returns a fresh agent for an idle state', () => {
    clearCodingAgentState()
    expect(restoreCodingAgentState()).toBeNull()
  })

  it('records task state through the dispatcher so it survives a reload', async () => {
    const output = await executeTool({
      id: 'e2e-task',
      name: 'coding_task_update',
      input: {
        task: 'deliver documented change',
        status: 'in_progress',
        completed_steps: JSON.stringify(['inspect repo']),
        pending_steps: JSON.stringify(['edit', 'test', 'push']),
        verification_result: 'lint clean',
        continuation: 'push and verify the commit',
      },
    }, ctx())
    expect(output).toContain('persisted')

    // Simulate a fresh page load: state must come back from storage.
    const reloaded = loadCodingAgentState()
    expect(reloaded.taskStatus).toBe('in_progress')
    expect(reloaded.completedSteps).toEqual(['inspect repo'])
    expect(reloaded.pendingSteps).toEqual(['edit', 'test', 'push'])
    expect(reloaded.verificationResults).toContain('lint clean')
    expect(reloaded.continuationNotes).toBe('push and verify the commit')
    expect(restoreCodingAgentState()?.task).toBe('deliver documented change')
  })

  it('records a blocker so a stuck task is resumable with its reason', async () => {
    await executeTool({
      id: 'e2e-block',
      name: 'coding_task_update',
      input: { task: 'ship change', status: 'blocked', blocker: 'PAT lacks contents:write' },
    }, ctx())
    const state = loadCodingAgentState()
    expect(state.taskStatus).toBe('blocked')
    expect(state.blockers[0]).toContain('contents:write')
    expect(restoreCodingAgentState()).not.toBeNull()
  })
})

describe('coding task detection and repo state parsing', () => {
  it('routes an explicit Shell command to shell_exec instead of repository inspection', () => {
    expect(isExplicitShellRequest('git push origin main')).toBe(true)
    expect(isExplicitShellRequest('execute git push origin main')).toBe(true)
    expect(isExplicitShellRequest('pwd')).toBe(true)
    const readonlyTools = FORGE_TOOLS.filter(tool => ['github_repo_state', 'github_read_file'].includes(tool.name))
    const selected = selectRequestTools('git push origin main', FORGE_TOOLS, readonlyTools).map(tool => tool.name)
    expect(selected).toEqual(['shell_exec'])
    expect(selected).not.toContain('github_repo_state')
    expect(selectRequestTools('pwd', FORGE_TOOLS, readonlyTools).map(tool => tool.name)).toEqual(['shell_exec'])
  })

  it('extracts bare pwd and explicitly wrapped CLI commands for deterministic execution', () => {
    expect(extractExplicitShellCommand('pwd')).toBe('pwd')
    expect(extractExplicitShellCommand('run pwd')).toBe('pwd')
    expect(extractExplicitShellCommand('Please run the shell command: `pwd`')).toBe('pwd')
    expect(extractExplicitShellCommand('```bash\npwd\n```')).toBe('pwd')
    expect(extractExplicitShellCommand('inspect the repository and report its current directory')).toBeNull()
    expect(extractExplicitShellCommand('run whatever you think is best')).toBeNull()
  })

  it('keeps ordinary repository-state requests on github_repo_state', () => {
    expect(isExplicitShellRequest('inspect the repository and report the current HEAD')).toBe(false)
    const readonlyTools = FORGE_TOOLS.filter(tool => ['github_repo_state', 'github_read_file'].includes(tool.name))
    const selected = selectRequestTools('inspect the repository and report the current HEAD', FORGE_TOOLS, readonlyTools).map(tool => tool.name)
    expect(selected).toContain('github_repo_state')
    expect(selected).not.toContain('shell_exec')
  })

  it('recognises coding objectives and ignores ordinary chat', () => {
    expect(isCodingTaskRequest('inspect the forgeclaw repository and identify current HEAD')).toBe(true)
    expect(isCodingTaskRequest('fix the tool dispatcher and push to GitHub')).toBe(true)
    expect(isCodingTaskRequest('Go check the ForgeClaw repo and give me some feedback on the repo.')).toBe(true)
    expect(isCodingTaskRequest('resume the unfinished task')).toBe(false)
    expect(isCodingTaskRequest('what is the weather today')).toBe(false)
  })

  it('uses one canonical identity and keeps repository evidence out of the runtime envelope', () => {
    expect(CANONICAL_IDENTITY).toEqual({
      application: 'ForgeClaw',
      owner: 'DeviousDevv303',
      repository: 'forgeclaw',
      fullRepository: 'DeviousDevv303/forgeclaw',
      defaultBranch: 'main',
    })
    const context = buildRuntimeRequestContext({ requiresRepositoryTool: true, taskStatus: 'in_progress' })
    expect(context).toContain('DeviousDevv303/forgeclaw')
    expect(context).toContain('github_repo_state')
    expect(context).not.toContain('HEAD:')
    expect(context.length).toBeLessThan(500)
  })

  it('measures context and tool payloads without putting metrics into the prompt', () => {
    const metrics = measureRequestMetrics({
      systemPrompt: 'identity',
      userMessages: 'check the repo',
      toolDefinitions: [{ name: 'github_repo_state' }],
      toolResults: 'HEAD: abc',
      modelCalls: 2,
      toolCalls: 1,
    })
    expect(metrics.systemTokens).toBeGreaterThan(0)
    expect(metrics.userTokens).toBeGreaterThan(0)
    expect(metrics.toolDefinitionTokens).toBeGreaterThan(0)
    expect(metrics.toolResultTokens).toBeGreaterThan(0)
    expect(metrics.totalRequestTokens).toBe(
      metrics.systemTokens + metrics.userTokens + metrics.toolDefinitionTokens + metrics.toolResultTokens,
    )
    expect(JSON.stringify(metrics)).not.toContain('HEAD:')
  })

  it('parses the dispatcher output into a HEAD snapshot', () => {
    const raw = [
      'repo: DeviousDevv303/forgeclaw (public)',
      'url: https://github.com/DeviousDevv303/forgeclaw',
      'defaultBranch: main',
      'inspectedBranch: main',
      'HEAD: 1f35568c0347972f77cd14cb1e4f32e58456d276',
      'HEAD short: 1f35568',
      'HEAD commit: feat: coding agent state persistence',
      'lastPush: 2026-09-26T18:12:30Z',
    ].join('\n')
    const snapshot = parseRepoState(raw)
    expect(snapshot.owner).toBe('DeviousDevv303')
    expect(snapshot.repo).toBe('forgeclaw')
    expect(snapshot.branch).toBe('main')
    expect(snapshot.headShaShort).toBe('1f35568')
    expect(snapshot.headSubject).toContain('coding agent state persistence')
  })
})


describe('GitHub read resilience', () => {
  it('retries a transient GitHub network failure and succeeds', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url)
      if (calls.length === 1) throw new TypeError('Failed to fetch')
      return new Response(JSON.stringify({ content: 'ok' }), { status: 200 })
    }))

    const output = await executeTool(
      { id: 'retry-network', name: 'github_read_file', input: { owner: 'DeviousDevv303', repo: 'forgeclaw', path: 'package.json' } },
      ctx(),
    )

    expect(calls).toHaveLength(2)
    expect(output).not.toContain('[TOOL ERROR]')
  })

  it('retries transient GitHub HTTP statuses and succeeds', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1
      if (calls === 1) return new Response('', { status: 503 })
      if (calls === 2) return new Response('', { status: 429 })
      return new Response(JSON.stringify({ content: 'ok' }), { status: 200 })
    }))

    const output = await executeTool(
      { id: 'retry-status', name: 'github_read_file', input: { owner: 'DeviousDevv303', repo: 'forgeclaw', path: 'package.json' } },
      ctx(),
    )

    expect(calls).toBe(3)
    expect(output).not.toContain('[TOOL ERROR]')
  })

  it('preserves the existing error after exhausting GitHub read retries', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1
      throw new TypeError('Failed to fetch')
    }))

    const output = await executeTool(
      { id: 'retry-exhausted', name: 'github_read_file', input: { owner: 'DeviousDevv303', repo: 'forgeclaw', path: 'package.json' } },
      ctx(),
    )

    expect(calls).toBe(3)
    expect(output).toBe('[TOOL ERROR] Failed to fetch')
  })

  it('does not retry non-idempotent GitHub requests', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1
      return new Response('', { status: 503 })
    }))

    const output = await executeTool(
      { id: 'no-retry-write', name: 'github_create_issue', input: { owner: 'DeviousDevv303', repo: 'forgeclaw', title: 'x', body: 'x' } },
      { ...ctx(), ghToken: 'test-token' },
    )

    expect(calls).toBe(1)
    expect(output).toContain('[TOOL ERROR]')
  })

  it('stops GitHub read retries when the run is aborted', async () => {
    const controller = new AbortController()
    let calls = 0

    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1
      throw new TypeError('Failed to fetch')
    }))

    const promise = executeTool(
      { id: 'retry-abort', name: 'github_read_file', input: { owner: 'DeviousDevv303', repo: 'forgeclaw', path: 'package.json' } },
      { ...ctx(), signal: controller.signal },
    )

    setTimeout(() => controller.abort(), 10)

    const output = await promise
    expect(calls).toBe(1)
    expect(output).toContain('[TOOL ERROR] Run aborted')
  })
})

// ─── Live GitHub legs ───────────────────────────────────────────────────────
// Enabled with FORGECLAW_E2E_GITHUB=1 and a PAT in gh_token / VITE_GITHUB_TOKEN.
// These are the acceptance assertions: real API, real repository, real HEAD.
const liveEnabled = process.env.FORGECLAW_E2E_GITHUB === '1'
const liveToken = (process.env.FORGECLAW_E2E_TOKEN || resolveGithubToken() || '').trim()
const live = liveEnabled && Boolean(liveToken)

describe.skipIf(!live)('live GitHub execution (NEXUS → tool → GitHub API → NEXUS)', () => {
  const liveCtx = () => ({ ...loadToolContext(), ghToken: liveToken })
  const owner = process.env.FORGECLAW_E2E_OWNER || 'DeviousDevv303'
  const repo = process.env.FORGECLAW_E2E_REPO || 'forgeclaw'

  it('authenticates and reads the live repository', async () => {
    const output = await executeTool({ id: 'live-auth', name: 'github_list_files', input: { owner, repo, path: '' } }, liveCtx())
    expect(output).not.toContain('[TOOL ERROR]')
    expect(output).toContain('Contents of /')
    expect(output).toContain('package.json')
  })

  it('identifies the current HEAD through the dispatcher', async () => {
    const output = await executeTool({ id: 'live-head', name: 'github_repo_state', input: { owner, repo } }, liveCtx())
    expect(output).not.toContain('[TOOL ERROR]')
    const snapshot = parseRepoState(output)
    expect(snapshot.headSha).toMatch(/^[0-9a-f]{40}$/)
    expect(snapshot.branch.length).toBeGreaterThan(0)
    expect(loadCodingAgentState().headSha).toBe(snapshot.headSha)
  })

  it('reads a real file from the repository', async () => {
    const output = await executeTool({ id: 'live-read', name: 'github_read_file', input: { owner, repo, path: 'package.json' } }, liveCtx())
    expect(output).not.toContain('[TOOL ERROR]')
    expect(output).toContain('"name": "forgeclaw"')
  })

  it('verifies a real commit and reports its changed files', async () => {
    const stateOutput = await executeTool({ id: 'live-head-2', name: 'github_repo_state', input: { owner, repo } }, liveCtx())
    const head = parseRepoState(stateOutput).headSha
    const verified = await executeTool({ id: 'live-verify', name: 'github_verify_commit', input: { owner, repo, sha: head, branch: 'main' } }, liveCtx())
    expect(verified).toContain('✓ VERIFIED')
    expect(verified).toContain(head)
    expect(verified).toContain('files changed')
  })

  it('reports a missing commit as a failed verification, not a success', async () => {
    const output = await executeTool(
      { id: 'live-verify-missing', name: 'github_verify_commit', input: { owner, repo, sha: '0'.repeat(40) } },
      liveCtx(),
    )
    expect(output).toContain('VERIFICATION FAILED')
  })
})
