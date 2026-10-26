import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEEPSEEK_API_DEFAULT_MAX_TOKENS, DEFAULT_DEEPSEEK_API_MODEL, deepseekApiProvider, resolveDeepSeekApiModel, toDeepSeekApiMessages } from './deepseekApiProvider'
import { diagKeyFormat } from '../../diagKeyFormat'
import { providers, isDeepSeekProvider } from '../providerRouter'
import { HOSTED_TOOL_PROVIDERS } from '../../toolExposure'

const KEY = 'sk-test-key-12345678901234567890'

function sseResponse(events: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(event))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

afterEach(() => vi.unstubAllGlobals())

describe('DeepSeek API provider', () => {
  it('is a distinct provider from the Actions-hosted deepseek route', () => {
    expect(providers.deepseekapi).toBe(deepseekApiProvider)
    expect(isDeepSeekProvider('deepseekapi')).toBe(false)
    expect(HOSTED_TOOL_PROVIDERS.has('deepseekapi')).toBe(true)
  })

  it('posts to api.deepseek.com with the bearer key and the default token budget', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input; void _init
      return Response.json({ choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }] })
    })
    vi.stubGlobal('fetch', fetchMock)
    const response = await deepseekApiProvider.send({ systemPrompt: 's', messages: [{ role: 'user', content: 'hello' }], model: DEFAULT_DEEPSEEK_API_MODEL }, ` ${KEY} `)
    expect(response.text).toBe('hi')
    expect(response.provider).toBe('deepseekapi')
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.deepseek.com/chat/completions')
    const init = fetchMock.mock.calls[0]?.[1]
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`)
    expect(JSON.parse(init?.body as string).max_tokens).toBe(DEEPSEEK_API_DEFAULT_MAX_TOKENS)
  })

  it('keeps streamed native tool calls and flags truncated arguments instead of running them', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"github_read_file","arguments":"{\\"path\\":\\"a.ts\\"}"}}]}}]}\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n',
      'data: [DONE]\n',
    ])))
    const ok = await deepseekApiProvider.send({ systemPrompt: '', messages: [{ role: 'user', content: 'x' }], model: DEFAULT_DEEPSEEK_API_MODEL, onToken: () => {} }, KEY)
    expect(ok.toolCalls).toEqual([{ id: 'call_1', name: 'github_read_file', input: { path: 'a.ts' } }])

    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_2","function":{"name":"github_read_file","arguments":"{\\"pa"}}]}}]}\n',
      'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n',
    ])))
    const cut = await deepseekApiProvider.send({ systemPrompt: '', messages: [{ role: 'user', content: 'x' }], model: DEFAULT_DEEPSEEK_API_MODEL, onToken: () => {} }, KEY)
    expect(cut.toolCalls?.[0]?.parseError).toMatch(/token limit/)
  })

  it('returns reasoning_content separately and sends it back with the tool-call turn', () => {
    const messages = toDeepSeekApiMessages('sys', [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: '', reasoning_content: 'think', tool_calls: [{ id: 'c1', name: 't', input: { a: 1 } }] },
      { role: 'tool', content: 'result', tool_call_id: 'c1' },
      { role: 'assistant', content: '' },
    ])
    expect(messages[2]).toMatchObject({ role: 'assistant', reasoning_content: 'think' })
    expect(messages).toHaveLength(4) // the empty assistant message is dropped
  })

  it('surfaces API errors with the DeepSeek name and status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Authentication Fails' } }), { status: 401 })))
    await expect(deepseekApiProvider.send({ systemPrompt: '', messages: [{ role: 'user', content: 'x' }], model: DEFAULT_DEEPSEEK_API_MODEL }, KEY)).rejects.toThrow('DeepSeek API 401: Authentication Fails')
  })

  it('rejects a malformed key before any request and falls back from an unknown saved model', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock)
    await expect(deepseekApiProvider.test('nope')).rejects.toThrow(/Invalid DeepSeek API key/)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(resolveDeepSeekApiModel('retired-model')).toBe(DEFAULT_DEEPSEEK_API_MODEL)
    expect(resolveDeepSeekApiModel('deepseek-v4-pro')).toBe('deepseek-v4-pro')
  })

  it('reports key-format problems from the same rule in Diagnostics', () => {
    expect(diagKeyFormat('deepseekapi', '', '', true, '', 'abc').valid).toBe(false)
    expect(diagKeyFormat('deepseekapi', '', '', true, '', KEY)).toEqual({ valid: true, problem: null })
  })
})
