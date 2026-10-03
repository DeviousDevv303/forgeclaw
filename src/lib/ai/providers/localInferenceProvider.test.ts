// @vitest-environment node
// Updated by MANUS: two assertions in this file called a real local inference server server on
// 127.0.0.1:8080, so the suite failed with "fetch failed" on any machine without
// local inference server running — including CI. The local runtime is untouched; the network tests
// now skip when no endpoint is reachable instead of reporting a false failure.
import { describe, expect, it } from 'vitest'
import { localInferenceProvider, routeLocalTask, shouldUseLocalModel } from './localInferenceProvider'
import { callProvider } from '../../modelProviders'
import { runSubAgent } from '../../managedAgent'
import { FORGE_TOOLS, executeTool } from '../../forgeTools'
import { parseManualToolCalls } from '../manualToolMode'
import { classifyFailure, extractStatus, decideRetry } from '../../agentCore'

const endpoint = process.env.FORGECLAW_LOCAL_ENDPOINT || 'http://127.0.0.1:8080/v1'

/** Probe the local endpoint so an absent local inference server skips instead of failing. */
async function localServerReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${endpoint.replace(/\/+$/, '')}/models`)
    return response.ok
  } catch {
    return false
  }
}

const reachable = await localServerReachable()

describe('ForgeClaw Local Mode v0.1 smoke path', () => {
  it('routes both routine and complex prompts to DeepSeek', () => {
    expect(shouldUseLocalModel([{ role: 'user', content: 'pwd' }])).toBe(false)
    expect(routeLocalTask([{ role: 'user', content: 'pwd' }])).toBe('deepseek')
    expect(routeLocalTask([{ role: 'user', content: 'Design a robust migration plan for the repository and explain tradeoffs.' }])).toBe('deepseek')
  })

  it('does not send custom grammar with image tool requests', async () => {
    const originalFetch = globalThis.fetch
    let captured: Record<string, unknown> | undefined
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [] }, finish_reason: 'stop' }] }), { status: 200 })
    }) as typeof fetch
    try {
      await localInferenceProvider.send({
        systemPrompt: 'system',
        messages: [{ role: 'user', content: 'Generate an image', image_url: 'data:image/png;base64,abc' }],
        model: 'local-model',
        tools: [{ name: 'analyze_image', description: 'Analyze', parameters: { type: 'object' } }],
      }, 'http://127.0.0.1:8080/v1')
      expect(captured).toBeDefined()
      expect(captured).not.toHaveProperty('grammar')
      expect(captured?.tool_choice).toEqual({ type: 'function', function: { name: 'analyze_image' } })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('parses the model toolcalls envelope and normalizes generateimage', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: '{"toolcalls":[{"id":"call1","type":"function","function":{"name":"generateimage","arguments":"{\\"prompt\\":\\"Rick and Morty\\",\\"style\\":\\"cartoon\\",\\"width\\":256,\\"height\\":256}"}}]}',
        },
        finish_reason: 'stop',
      }],
    }), { status: 200 })) as typeof fetch
    try {
      const result = await localInferenceProvider.send({
        systemPrompt: 'system',
        messages: [{ role: 'user', content: 'Generate an image' }],
        model: 'local-model',
        tools: [{ name: 'generate_image', description: 'Generate', parameters: { type: 'object' } }],
      }, 'http://127.0.0.1:8080/v1')
      expect(result.toolCalls).toEqual([{
        id: 'call1',
        name: 'generate_image',
        input: { prompt: 'Rick and Morty', style: 'cartoon', width: 256, height: 256 },
      }])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('parses streamed toolcalls before returning text to the renderer', async () => {
    const originalFetch = globalThis.fetch
    const payload = '{"toolcalls":[{"id":"call1","type":"function","function":{"name":"generateimage","arguments":"{\\"prompt\\":\\"Rick and Morty\\",\\"style\\":\\"cartoon\\",\\"width\\":256,\\"height\\":256}"}}]}'
    globalThis.fetch = (async () => new Response([
      `data: ${JSON.stringify({ choices: [{ delta: { content: payload } }] })}`,
      'data: [DONE]',
      '',
    ].join('\n'), { status: 200 })) as typeof fetch
    try {
      const result = await localInferenceProvider.send({
        systemPrompt: 'system',
        messages: [{ role: 'user', content: 'Generate an image' }],
        model: 'local-model',
        tools: [{ name: 'generate_image', description: 'Generate', parameters: { type: 'object' } }],
        onToken: () => undefined,
      }, 'http://127.0.0.1:8080/v1')
      expect(result.toolCalls?.[0]?.name).toBe('generate_image')
      expect(parseManualToolCalls(payload)[0]?.toolName).toBe('generate_image')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

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

  it.skipIf(!reachable)('connects to local inference server and completes inference through the provider bridge', async () => {
    await localInferenceProvider.test(endpoint)
    const result = await callProvider(
      'local',
      'local-model',
      'Reply with exactly the word VERIFIED.',
      [{ role: 'user', content: 'Confirm the local inference path.' }],
      endpoint,
      { maxTokens: 16 },
    )
    expect(result.provider).toBe('local')
    expect(result.text.trim().length).toBeGreaterThan(0)
  }, 120_000)

  it.skipIf(!reachable)('runs the bounded managed-agent loop through the local provider', async () => {
    const output = await runSubAgent(
      'You are a local smoke-test agent. Answer concisely and do not use network tools.',
      'State the result of a local execution check in one sentence.',
      ['run_js'],
      'local',
      'local-model',
      endpoint,
      FORGE_TOOLS,
      { ghToken: '', ghOwner: 'DeviousDevv303', ghRepo: 'forgeclaw' },
    )
    expect(output.trim().length).toBeGreaterThan(0)
  }, 120_000)
})
