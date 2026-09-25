// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_LOCAL_ENDPOINT, DEFAULT_LOCAL_MODEL, localInferenceProvider } from './localInferenceProvider'
import { callProvider } from '../../modelProviders'
import { runSubAgent } from '../../managedAgent'
import { FORGE_TOOLS } from '../../forgeTools'
import { classifyFailure, extractStatus, decideRetry } from '../../agentCore'
import { executeTool } from '../../forgeTools'

describe('ForgeClaw Local Mode v0.1 smoke path', () => {
  const endpoint = process.env.FORGECLAW_LOCAL_ENDPOINT || DEFAULT_LOCAL_ENDPOINT

  it('sends the authorized Ollama endpoint and model through the provider path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'OLLAMA_PROVIDER_PATH_OK' }, finish_reason: 'stop' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const result = await localInferenceProvider.send({
        systemPrompt: 'You are a local test model.',
        messages: [{ role: 'user', content: 'Confirm the provider path.' }],
        model: DEFAULT_LOCAL_MODEL,
      }, DEFAULT_LOCAL_ENDPOINT)
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(String(init.body)) as { model: string; messages: Array<{ role: string }> }
      expect(url).toBe(`${DEFAULT_LOCAL_ENDPOINT}/chat/completions`)
      expect(body.model).toBe('qwen2.5:1.5b')
      expect(body.messages[0]?.role).toBe('system')
      expect(result.text).toBe('OLLAMA_PROVIDER_PATH_OK')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('connects to llama.cpp and completes inference through the provider bridge', async () => {
    await localInferenceProvider.test(endpoint)
    const result = await callProvider(
      'local',
      DEFAULT_LOCAL_MODEL,
      'Reply with exactly the word VERIFIED.',
      [{ role: 'user', content: 'Confirm the local inference path.' }],
      endpoint,
      { maxTokens: 16 },
    )
    expect(result.provider).toBe('local')
    expect(result.text.trim().length).toBeGreaterThan(0)
  }, 120_000)

  it('exercises the agent-core classification, verification fields, and retry policy', () => {
    expect(classifyFailure('local tool execution failed')).toBe('TOOL_FAILURE')
    expect(extractStatus('STATUS: COMPLETE\nNEXT_ACTION: none')).toBe('COMPLETE')
    expect(decideRetry('NETWORK_FAILURE', 1, false).shouldRetry).toBe(true)
    expect(decideRetry('TOOL_FAILURE', 1, true).requiresUserApproval).toBe(true)
  })

  it('exercises an offline local tool without external credentials', async () => {
    const output = await executeTool(
      { id: 'smoke-run-js', name: 'run_js', input: { code: 'return 6 * 7' } },
      { ghToken: '', ghOwner: 'DeviousDevv303', ghRepo: 'forgeclaw' },
    )
    expect(output).toBe('42')
  })

  it('runs the bounded managed-agent loop through the local provider', async () => {
    const output = await runSubAgent(
      'You are a local smoke-test agent. Answer concisely and do not use network tools.',
      'State the result of a local execution check in one sentence.',
      ['run_js'],
      'local',
      DEFAULT_LOCAL_MODEL,
      endpoint,
      FORGE_TOOLS,
      { ghToken: '', ghOwner: 'DeviousDevv303', ghRepo: 'forgeclaw' },
    )
    expect(output.trim().length).toBeGreaterThan(0)
  }, 120_000)
})
