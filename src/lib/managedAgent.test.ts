// @vitest-environment node
// ─── Managed Agent Tool Routing ──────────────────────────────────────────────
// Written by MANUS. Proves the saved-agent execution path actually reaches tools.
//
// The defect this covers: the managed saved-agent path disabled tool exposure for
// every provider without native function calling, and it had no manual-tool
// parsing. A saved `GitHub Coding Specialist` therefore answered a repository
// question by asking the operator to paste repository contents, even though the
// repository tools, token resolution, dispatcher and Guardian gate all existed.
//
// `nexus` is the non-native provider (browser-local WebGPU Qwen, supportsTools
// false); `local` is the native Ollama path. Both are exercised below.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  runSubAgent,
  toolsForCapability,
  CODING_READONLY_TOOL_NAMES,
  CODING_TOOL_ORDER,
  WRITE_TOOL_NAMES,
  SUB_AGENT_SYSTEM_RESERVE,
  SUB_AGENT_TASK_RESERVE,
} from './managedAgent'
import { FORGE_TOOLS, loadToolContext } from './forgeTools'
import { injectToolSchema, injectToolSchemaWithinBudget, parseManualToolCalls, stripToolSyntax } from './ai/manualToolMode'
import { boundPrefixByBudget, MAX_NEXUS_CONTEXT_TOKENS, conservativeTokenCount, limitNexusContext } from './ai/nexusContext'
import { PROVIDERS, modelSupportsTools } from './modelProviders'
import { hasSuccessfulRepositoryEvidence } from './codingAgentRuntime'

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

const ctx = () => ({ ...loadToolContext(), ghToken: '', agentId: 'agent-under-test', runId: 'run-1' })

afterEach(() => {
  storage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** Replay scripted provider answers and capture exactly what the provider saw. */
function makeTransport(replies: Array<{ text: string; toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }> }>) {
  const seen: Array<{ systemPrompt: string; messages: Array<{ role: string; content: string }>; toolsOffered: number }> = []
  let index = 0
  const callProviderFn = (async (
    _provider: unknown,
    _model: unknown,
    systemPrompt: string,
    messages: Array<{ role: string; content: string }>,
    _apiKey: unknown,
    options: { tools?: unknown[] } = {},
  ) => {
    seen.push({ systemPrompt, messages: messages.map(m => ({ role: m.role, content: m.content })), toolsOffered: options.tools?.length ?? 0 })
    const reply = replies[Math.min(index, replies.length - 1)]
    index += 1
    return { text: reply.text, provider: 'nexus', model: 'qwen', toolCalls: reply.toolCalls }
  }) as never
  return { seen, callProviderFn }
}

const TASK = 'Check my forge claw repo to see what it says it can do versus what it can actually do so I can blend the two'

describe('capability profiles decide tool authority', () => {
  it('grants nothing to a chat profile', () => {
    expect(toolsForCapability('chat', FORGE_TOOLS)).toHaveLength(0)
  })

  it('grants repository read tools but never a write tool to coding-readonly', () => {
    const granted = toolsForCapability('coding-readonly', FORGE_TOOLS).map(tool => tool.name)
    expect(granted).toContain('github_repo_state')
    expect(granted).toContain('github_read_file')
    expect(granted).toContain('github_search_code')
    for (const write of WRITE_TOOL_NAMES) expect(granted).not.toContain(write)
  })

  it('grants the existing write tools to coding so writes keep flowing through the dispatcher', () => {
    const granted = toolsForCapability('coding', FORGE_TOOLS).map(tool => tool.name)
    for (const read of CODING_READONLY_TOOL_NAMES) expect(granted).toContain(read)
    expect(granted).toContain('github_write_file')
    expect(granted).toContain('github_verify_commit')
    // Priority order is preserved so a tight budget keeps the valuable tools.
    expect(granted).toEqual(CODING_TOOL_ORDER.filter(name => FORGE_TOOLS.some(t => t.name === name)))
  })

  it('lets a caller narrow a profile but never widen one', () => {
    const narrowed = toolsForCapability('coding', FORGE_TOOLS, ['github_write_file']).map(tool => tool.name)
    expect(narrowed).toEqual(['github_write_file'])
    // A read-only profile cannot be widened into write authority by naming writes.
    const attempt = toolsForCapability('coding-readonly', FORGE_TOOLS, ['github_write_file', 'github_read_file']).map(tool => tool.name)
    expect(attempt).toEqual(['github_read_file'])
  })

  it('ignores tool names that do not exist in the registry', () => {
    expect(toolsForCapability('coding', FORGE_TOOLS, ['not_a_real_tool'])).toHaveLength(0)
  })
})

describe('budget-aware manual tool catalog', () => {
  it('parses the observed bare GitHub fallback but not arbitrary JavaScript', () => {
    const actions = parseManualToolCalls('I will inspect the repo now:\ngithub_repo_state();')
    expect(actions).toEqual([{ toolName: 'github_repo_state', params: {}, rawOutput: 'github_repo_state();' }])
    expect(stripToolSyntax('github_repo_state();')).toBe('')
    expect(parseManualToolCalls('run_js();')).toHaveLength(0)
  })

  it('is necessary: the full registry catalog does not fit the browser-local budget', () => {
    const unbounded = injectToolSchema('SYSTEM', FORGE_TOOLS).replace('SYSTEM', '')
    expect(conservativeTokenCount(unbounded)).toBeGreaterThan(MAX_NEXUS_CONTEXT_TOKENS)
  })

  it('always states the callable protocol and stays inside the budget', () => {
    const bounded = injectToolSchemaWithinBudget('SYSTEM', FORGE_TOOLS, SUB_AGENT_SYSTEM_RESERVE)
    expect(bounded.systemPrompt).toContain('```tool_call')
    expect(conservativeTokenCount(bounded.systemPrompt)).toBeLessThanOrEqual(SUB_AGENT_SYSTEM_RESERVE)
  })

  it('names omitted tools as unavailable instead of silently dropping them', () => {
    const bounded = injectToolSchemaWithinBudget('SYSTEM', FORGE_TOOLS, 700)
    expect(bounded.omitted.length).toBeGreaterThan(0)
    expect(bounded.systemPrompt).toContain('NOT AVAILABLE')
    // Every omitted name is a real registry tool; the runtime never invents one.
    expect(bounded.omitted.every(name => FORGE_TOOLS.some(tool => tool.name === name))).toBe(true)
  })

  it('offers repository inspection tools first so a coding task can act in a small budget', () => {
    const bounded = injectToolSchemaWithinBudget('SYSTEM', toolsForCapability('coding-readonly', FORGE_TOOLS), 1600)
    expect(bounded.included).toContain('github_repo_state')
    expect(bounded.included).toContain('github_read_file')
  })

  it('fits the granted coding set inside the reserved system budget', () => {
    const granted = toolsForCapability('coding', FORGE_TOOLS)
    const bounded = injectToolSchemaWithinBudget('SYSTEM', granted, SUB_AGENT_SYSTEM_RESERVE)
    expect(bounded.omitted).toHaveLength(0)
  })

  it('survives the provider context limiter with the reserved task turn', () => {
    const granted = toolsForCapability('coding-readonly', FORGE_TOOLS)
    const catalog = injectToolSchemaWithinBudget('SYSTEM', granted, SUB_AGENT_SYSTEM_RESERVE)
    const task = 'USER: ' + 'x'.repeat(SUB_AGENT_TASK_RESERVE - 10)
    const bounded = limitNexusContext(catalog.systemPrompt, [{ role: 'user', content: task }], MAX_NEXUS_CONTEXT_TOKENS)
    expect(bounded.systemPrompt).toContain('```tool_call')
    expect(bounded.systemPrompt).toContain('github_repo_state')
    expect(String(bounded.messages.at(-1)?.content)).toContain('USER:')
  })

  it('keeps the ForgeMind manual protocol and first GitHub reads after prose reservation', () => {
    const granted = toolsForCapability('coding-readonly', FORGE_TOOLS)
    const longForgeMindPrompt = 'IDENTITY\n' + 'x'.repeat(9000) + '\nEXECUTION RULES\nUse tools.'
    const catalog = injectToolSchemaWithinBudget(
      boundPrefixByBudget(longForgeMindPrompt, 1024),
      granted,
      MAX_NEXUS_CONTEXT_TOKENS - 1024,
    )
    const bounded = limitNexusContext(catalog.systemPrompt, [{ role: 'user', content: 'repository task' }], MAX_NEXUS_CONTEXT_TOKENS)
    expect(catalog.included).toContain('github_repo_state')
    expect(catalog.included).toContain('github_list_files')
    expect(bounded.systemPrompt).toContain('```tool_call')
    expect(bounded.systemPrompt).toContain('github_repo_state')
    expect(bounded.systemPrompt).toContain('github_list_files')
  })
})

describe('saved-agent run reaches real tools without native function calling', () => {
  it('turns the observed pseudo-call into a real dispatcher continuation', async () => {
    const { seen, callProviderFn } = makeTransport([
      { text: 'github_repo_state();' },
      { text: 'STATUS: COMPLETE — grounded in the returned repository state.' },
    ])

    const result = await runSubAgent('You are the GitHub Coding Specialist.', TASK, undefined, 'nexus', 'qwen', '', FORGE_TOOLS, ctx(), {
      capability: 'coding-readonly',
      callProviderFn,
    })

    const toolTurn = seen[1].messages.find(message => message.role === 'tool')
    expect(toolTurn).toBeDefined()
    expect(String(toolTurn?.content).includes('repo:') || String(toolTurn?.content).includes('[TOOL ERROR]')).toBe(true)
    expect(result).toContain('STATUS: COMPLETE')
    expect(result).not.toContain('github_repo_state();')
  })

  it('reports the real unauthenticated failure when no token is configured', async () => {
    // Wiring check that must not depend on network reachability: the dispatcher
    // reports a missing credential rather than inventing repository state.
    const { seen, callProviderFn } = makeTransport([
      { text: '```tool_call\n{"name":"github_write_file","arguments":{"path":"x.md","content":"x","message":"docs: x"}}\n```' },
      { text: 'STATUS: BLOCKED — no repository credential is configured.' },
    ])

    const result = await runSubAgent('specialist', TASK, undefined, 'nexus', 'qwen', '', FORGE_TOOLS, ctx(), {
      capability: 'coding',
      callProviderFn,
    })

    const toolTurn = seen[1].messages.find(message => message.role === 'tool')
    expect(toolTurn?.content).toContain('No GitHub token configured')
    expect(result).toContain('STATUS: BLOCKED')
    expect(result).not.toContain('tool_call')
  })

  it('offers a manual catalog, parses the emitted call, dispatches it, and continues', async () => {
    const { seen, callProviderFn } = makeTransport([
      { text: 'Reading repository state.\n```tool_call\n{"name":"github_repo_state","arguments":{}}\n```\nSTATUS: IN_PROGRESS' },
      { text: 'STATUS: COMPLETE — the repository reports its own capability from live tool output.' },
    ])

    const reports: Array<{ nativeTools: boolean; catalogTools: string[]; unavailableTools: string[] }> = []
    const result = await runSubAgent(
      'You are the GitHub Coding Specialist.',
      TASK,
      undefined,
      'nexus',
      'qwen2.5:1.5b',
      '',
      FORGE_TOOLS,
      ctx(),
      { capability: 'coding-readonly', onBudget: report => reports.push(report), callProviderFn },
    )

    // The runtime reported the real tool mode and the offered catalog.
    expect(reports).toHaveLength(1)
    expect(reports[0].nativeTools).toBe(false)
    expect(reports[0].catalogTools).toContain('github_repo_state')

    // A second provider turn happened, which only occurs after a tool result.
    expect(seen).toHaveLength(2)
    // The requested tool was never sent as a native tool definition.
    expect(seen[0].toolsOffered).toBe(0)
    // The catalog reached the provider inside the system prompt.
    expect(seen[0].systemPrompt).toContain('```tool_call')
    expect(seen[0].systemPrompt).toContain('github_repo_state')

    // The dispatcher ran the tool and returned its real output to the model. The
    // exact output depends on network reachability: against a reachable API the
    // anonymous read returns live repository state, and with no network the
    // dispatcher reports the failure. Either way it is a real result and never a
    // fabricated success, which is the property under test.
    const toolTurn = seen[1].messages.find(message => message.role === 'tool')
    expect(toolTurn).toBeDefined()
    expect(String(toolTurn?.content).length).toBeGreaterThan(0)
    const realResult = String(toolTurn?.content)
    expect(realResult.includes('repo:') || realResult.includes('[TOOL ERROR]')).toBe(true)

    // The model's answer is the continuation and carries no raw tool syntax.
    expect(result).toContain('STATUS: COMPLETE')
    expect(result).not.toContain('tool_call')
  })

  it('never offers a write tool to a read-only profile, so a model-emitted write cannot execute', async () => {
    const { seen, callProviderFn } = makeTransport([
      { text: '```tool_call\n{"name":"github_write_file","arguments":{"path":"x.md","content":"x","message":"y"}}\n```' },
      { text: 'done' },
    ])

    await runSubAgent('specialist', 'inspect only', undefined, 'nexus', 'qwen', '', FORGE_TOOLS, ctx(), {
      capability: 'coding-readonly',
      callProviderFn,
    })

    expect(seen[0].systemPrompt).not.toContain('github_write_file')
    const toolTurn = seen[1].messages.find(message => message.role === 'tool')
    expect(toolTurn?.content).toContain('[TOOL ERROR]')
  })

  it('keeps Guardian authoritative on the saved-agent path', async () => {
    const { seen, callProviderFn } = makeTransport([
      { text: '```tool_call\n{"name":"github_write_file","arguments":{"path":"x.md","content":"x","message":"docs: x"}}\n```' },
      { text: 'blocked' },
    ])

    // Tier 1 is armed but no Guardian approval handler is attached to this run.
    await runSubAgent('specialist', 'write a file', undefined, 'nexus', 'qwen', '', FORGE_TOOLS, {
      ...ctx(),
      ghToken: 'test-token',
      tier1Active: true,
    }, { capability: 'coding', callProviderFn })

    const toolTurn = seen[1].messages.find(message => message.role === 'tool')
    expect(toolTurn?.content).toContain('[GUARDIAN BLOCK]')
  })

  it('does not treat a refusal to approve as success', async () => {
    const { seen, callProviderFn } = makeTransport([
      { text: '```tool_call\n{"name":"github_write_file","arguments":{"path":"x.md","content":"x","message":"docs: x"}}\n```' },
      { text: 'the operator declined' },
    ])

    await runSubAgent('specialist', 'write a file', undefined, 'nexus', 'qwen', '', FORGE_TOOLS, {
      ...ctx(),
      ghToken: 'test-token',
      tier1Active: true,
      requestGuardianApproval: async () => false,
    }, { capability: 'coding', callProviderFn })

    const toolTurn = seen[1].messages.find(message => message.role === 'tool')
    expect(toolTurn?.content).toContain('[GUARDIAN REJECTED]')
  })

  it('still uses native tool calling when the provider supports it', async () => {
    const { seen, callProviderFn } = makeTransport([
      { text: '', toolCalls: [{ id: 'native-1', name: 'run_js', input: { code: 'return 2+2' } }] },
      { text: 'The result is 4.' },
    ])

    const result = await runSubAgent('specialist', 'compute', undefined, 'local', 'qwen2.5:1.5b', 'http://127.0.0.1:11434/v1', FORGE_TOOLS, ctx(), {
      capability: 'coding',
      callProviderFn,
    })

    // Native path passes real tool definitions and no manual protocol.
    expect(seen[0].toolsOffered).toBeGreaterThan(0)
    expect(seen[0].systemPrompt).not.toContain('```tool_call')
    expect(seen[1].messages.find(message => message.role === 'tool')?.content).toBe('4')
    expect(result).toBe('The result is 4.')
  })

  it('reports an aborted run instead of a fabricated answer', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await runSubAgent('specialist', 'do work', undefined, 'nexus', 'qwen', '', FORGE_TOOLS, {
      ...ctx(),
      signal: controller.signal,
    }, { capability: 'coding' })
    expect(result).toBe('[SUB-AGENT ABORTED]')
  })

  it('returns the bounded task when the saved prompt is longer than the reserved budget', async () => {
    const { seen, callProviderFn } = makeTransport([{ text: 'ok' }])
    await runSubAgent(
      'P'.repeat(SUB_AGENT_SYSTEM_RESERVE * 2),
      'T'.repeat(SUB_AGENT_TASK_RESERVE * 2),
      undefined,
      'nexus',
      'qwen',
      '',
      FORGE_TOOLS,
      ctx(),
      { capability: 'coding-readonly', callProviderFn },
    )
    // The catalog and protocol survive an over-long saved prompt.
    expect(seen[0].systemPrompt).toContain('```tool_call')
    expect(seen[0].systemPrompt).toContain('github_repo_state')
    // The task turn is bounded so the provider limiter cannot drop the catalog.
    expect(conservativeTokenCount(seen[0].messages[0].content)).toBeLessThanOrEqual(SUB_AGENT_TASK_RESERVE)
  })
})

describe('existing systems are untouched', () => {
  it('keeps the provider registry and its tool-support facts intact', () => {
    expect(Object.keys(PROVIDERS).sort()).toEqual(['anthropic', 'corpus', 'local', 'nexus'])
    expect(modelSupportsTools('nexus', 'qwen')).toBe(false)
    expect(modelSupportsTools('local', 'qwen2.5:1.5b')).toBe(true)
    expect(Object.keys(PROVIDERS).length).toBe(4)
  })

  it('keeps every pre-existing tool name in the registry', () => {
    const names = FORGE_TOOLS.map(tool => tool.name)
    for (const required of [
      'github_read_file', 'github_write_file', 'github_list_files', 'github_search_code',
      'github_create_issue', 'github_run_workflow', 'github_get_run_status', 'github_get_run_logs',
      'github_repo_state', 'github_verify_commit', 'coding_task_update',
      'http_fetch', 'memory_write', 'memory_read', 'memory_list', 'send_whatsapp',
      'run_js', 'web_search', 'gmail_read', 'gmail_send', 'calendar_read', 'calendar_create',
      'shell_exec', 'spawn_agent',
    ]) {
      expect(names).toContain(required)
    }
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('repository completion safety', () => {
  it('does not treat model text or failed tools as evidence', () => {
    expect(hasSuccessfulRepositoryEvidence([])).toBe(false)
    expect(hasSuccessfulRepositoryEvidence([{ name: 'github_repo_state', isError: true }])).toBe(false)
    expect(hasSuccessfulRepositoryEvidence([{ name: 'github_repo_state' }])).toBe(true)
    expect(hasSuccessfulRepositoryEvidence([{ name: 'run_js' }])).toBe(false)
  })
})
