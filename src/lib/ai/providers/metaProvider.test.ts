import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_META_MODEL,
  META_CHAT_COMPLETIONS_URL,
  META_KEY_FORMAT,
  metaProvider,
  resolveMetaModel,
  toMetaMessages,
} from './metaProvider'
import { keyFormatProblem } from '../keyFormat'
import { DEFAULT_MODEL, PROVIDERS, callProvider, modelSupportsTools, testProviderKey } from '../../modelProviders'
import { DEFAULT_PROVIDER, PROVIDER_IDS, resolveInitialProvider } from '../../providerDefaults'
import { baselineToolNames } from '../../toolExposure'
import { diagKeyFormat, diagKeyFormatValid } from '../../diagKeyFormat'

const VALID_KEY = 'LLM_test-key-1234567890abcdef'

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

describe('Meta provider — request shape (dev.meta.ai Chat Completions)', () => {
  it('posts the documented shape: URL, Bearer header, model id, system + messages', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input
      void _init
      return Response.json({
        choices: [{ message: { content: 'Hello from Wonder.' }, finish_reason: 'stop' }],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await metaProvider.send({
      systemPrompt: 'You are ForgeClaw.',
      messages: [{ role: 'user', content: 'Say hello.' }],
      model: 'muse-wonder-1.0',
    }, VALID_KEY)

    expect(response.text).toBe('Hello from Wonder.')
    expect(response.provider).toBe('muse')
    expect(response.model).toBe('muse-wonder-1.0')
    expect(response.stopReason).toBe('stop')

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(String(url)).toBe('https://api.meta.ai/v1/chat/completions')
    expect(String(url)).toBe(META_CHAT_COMPLETIONS_URL)
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${VALID_KEY}`)
    expect(headers['Content-Type']).toBe('application/json')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.model).toBe('muse-wonder-1.0')
    expect(body.messages).toEqual([
      { role: 'system', content: 'You are ForgeClaw.' },
      { role: 'user', content: 'Say hello.' },
    ])
  })

  it('streams ordinary text token by token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
      'data: {"choices":[{"delta":{"content":" from Wonder."},"finish_reason":"stop"}]}\n',
      'data: [DONE]\n',
    ])))

    const tokens: string[] = []
    const response = await metaProvider.send({
      systemPrompt: '',
      messages: [{ role: 'user', content: 'Say hello.' }],
      model: 'muse-wonder-1.0',
      onToken: token => tokens.push(token),
    }, VALID_KEY)

    expect(response.text).toBe('Hello from Wonder.')
    expect(tokens).toEqual(['Hello', ' from Wonder.'])
  })

  it('keeps streamed native tool calls instead of dropping them before the tool loop', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"github_read_file","arguments":"{\\"path\\":\\"src/App.tsx\\"}"}}]}}]}\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n',
      'data: [DONE]\n',
    ])))

    const response = await metaProvider.send({
      systemPrompt: 'You are ForgeClaw.',
      messages: [{ role: 'user', content: 'Read the app file.' }],
      model: 'muse-wonder-1.0',
      tools: [{ name: 'github_read_file', description: 'Read a file', parameters: { type: 'object' } }],
      onToken: () => {},
    }, VALID_KEY)

    expect(response.toolCalls).toEqual([{
      id: 'call_1',
      name: 'github_read_file',
      input: { path: 'src/App.tsx' },
    }])
    expect(response.stopReason).toBe('tool_calls')
  })

  it('parses native tool calls from a non-streamed response and round-trips tool messages', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input
      void _init
      return Response.json({
      choices: [{
        message: {
          content: '',
          tool_calls: [{ id: 'call_9', type: 'function', function: { name: 'github_read_file', arguments: '{"path":"README.md"}' } }],
        },
        finish_reason: 'tool_calls',
      }],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await metaProvider.send({
      systemPrompt: 's', messages: [{ role: 'user', content: 'Read the readme.' }], model: 'muse-wonder-1.0',
      tools: [{ name: 'github_read_file', description: 'Read a file', parameters: { type: 'object' } }],
    }, VALID_KEY)

    expect(response.toolCalls).toEqual([{ id: 'call_9', name: 'github_read_file', input: { path: 'README.md' } }])
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string)
    expect(body.tools).toEqual([{ type: 'function', function: { name: 'github_read_file', description: 'Read a file', parameters: { type: 'object' } } }])
    expect(body.tool_choice).toBe('auto')

    const next = toMetaMessages('s', [
      { role: 'user', content: 'Read the readme.' },
      { role: 'assistant', content: '', tool_calls: response.toolCalls },
      { role: 'tool', content: '# ForgeClaw', tool_call_id: 'call_9' },
    ])
    expect(next[2]).toMatchObject({ role: 'assistant' })
    expect(next[3]).toEqual({ role: 'tool', content: '# ForgeClaw', tool_call_id: 'call_9' })
  })

  it('keeps reasoning_content out of the visible answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'data: {"choices":[{"delta":{"reasoning_content":"thinking..."}}]}\n',
      'data: {"choices":[{"delta":{"content":"Done."},"finish_reason":"stop"}]}\n',
    ])))
    const tokens: string[] = []
    const response = await metaProvider.send({ systemPrompt: '', messages: [{ role: 'user', content: 'x' }], model: 'muse-wonder-1.0', onToken: t => tokens.push(t) }, VALID_KEY)
    expect(tokens).toEqual(['Done.'])
    expect(response.text).toBe('Done.')
    expect(response.reasoningContent).toBe('thinking...')
  })

  it('marks a tool call cut off by the output limit instead of running it with empty arguments', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_2","function":{"name":"github_write_file","arguments":"{\\"path\\":\\"index.html\\",\\"content\\":\\"<html>"}}]}}]}\n',
      'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n',
    ])))
    const response = await metaProvider.send({ systemPrompt: '', messages: [{ role: 'user', content: 'x' }], model: 'muse-wonder-1.0', onToken: () => {} }, VALID_KEY)
    expect(response.stopReason).toBe('length')
    expect(response.toolCalls?.[0]).toMatchObject({ id: 'call_2', name: 'github_write_file', input: {} })
    expect(response.toolCalls?.[0]?.parseError).toMatch(/output token limit/)
  })

  it('surfaces an API error with its status and detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), { status: 401 })))
    await expect(metaProvider.send({ systemPrompt: '', messages: [{ role: 'user', content: 'x' }], model: 'muse-wonder-1.0' }, VALID_KEY))
      .rejects.toThrow('Meta 401: Invalid API key')
  })
})

describe('Meta provider — key handling', () => {
  it('a missing key names Settings, never a generic failure', async () => {
    await expect(metaProvider.send({ systemPrompt: '', messages: [{ role: 'user', content: 'x' }], model: 'muse-wonder-1.0' }, ''))
      .rejects.toThrow(/add your Meta Model API key in Settings/)
    await expect(metaProvider.test('')).rejects.toThrow(/add your Meta Model API key in Settings/)
  })

  it('a malformed key is refused by the format gate before any request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(metaProvider.send({ systemPrompt: '', messages: [{ role: 'user', content: 'x' }], model: 'muse-wonder-1.0' }, 'sk-not-a-meta-key-123456'))
      .rejects.toThrow(/Expected a key starting with LLM_/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('isConfigured is exactly "no format problem"', () => {
    const KEYS = ['', 'abc', 'LLM_', 'LLM_short', 'sk-ant-xxxxxxxxxxxxxxxxxxxx', `LLM_${'x'.repeat(16)}`, `LLM_${'x'.repeat(17)}`, `  LLM_${'x'.repeat(17)}  `]
    for (const key of KEYS) {
      expect(metaProvider.isConfigured(key), key).toBe(keyFormatProblem(key, META_KEY_FORMAT) === null)
    }
    expect(metaProvider.isConfigured(VALID_KEY)).toBe(true)
  })

  it('tests the key against the documented chat endpoint with the real model', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input
      void _init
      return Response.json({ choices: [{ message: { content: 'Hi' }, finish_reason: 'stop' }] })
    })
    vi.stubGlobal('fetch', fetchMock)
    await metaProvider.test(VALID_KEY)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(String(url)).toBe('https://api.meta.ai/v1/chat/completions')
    expect(((init as RequestInit).headers as Record<string, string>).Authorization).toBe(`Bearer ${VALID_KEY}`)
    expect(JSON.parse((init as RequestInit).body as string).model).toBe('muse-wonder-1.0')

    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(metaProvider.test(VALID_KEY)).rejects.toThrow(/Meta 401/)
  })
})

describe('Meta provider — registration', () => {
  it('is a registered, selectable provider and the default stays DeepSeek', () => {
    expect(PROVIDER_IDS).toContain('muse')
    expect(PROVIDERS.muse).toMatchObject({ id: 'muse', name: 'Muse · Meta', keyPrefix: 'LLM_' })
    expect(PROVIDERS.muse.url).toBe('https://api.meta.ai/v1/chat/completions')
    expect(DEFAULT_MODEL.muse).toBe('muse-wonder-1.0')
    expect(DEFAULT_PROVIDER).toBe('deepseek')
    expect(resolveInitialProvider('muse')).toBe('muse')
    expect(resolveInitialProvider(null)).toBe('deepseek')
  })

  it('migrates an unknown saved model to Muse Wonder', () => {
    expect(resolveMetaModel('muse-spark-1.0')).toBe(DEFAULT_META_MODEL)
    expect(resolveMetaModel(null)).toBe('muse-wonder-1.0')
    expect(resolveMetaModel('muse-wonder-1.0')).toBe('muse-wonder-1.0')
  })

  it('supports tools like the other hosted providers, baseline included', () => {
    expect(metaProvider.supportsTools('muse-wonder-1.0')).toBe(true)
    expect(modelSupportsTools('muse', 'muse-wonder-1.0')).toBe(true)
    expect(baselineToolNames('muse')).toEqual(expect.arrayContaining(['github_read_file', 'web_search']))
  })

  it('callProvider and testProviderKey route to the Meta adapter', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content: 'Routed.' }, finish_reason: 'stop' }] })))
    const result = await callProvider('muse', '', 's', [{ role: 'user', content: 'x' }], VALID_KEY)
    expect(result).toMatchObject({ text: 'Routed.', provider: 'muse', model: 'muse-wonder-1.0' })
    await expect(testProviderKey('muse', '', VALID_KEY)).resolves.toBeUndefined()
  })

  it('the Diagnostics gate reads the Meta format rule', () => {
    expect(diagKeyFormatValid('muse', '', '', true, VALID_KEY)).toBe(true)
    expect(diagKeyFormatValid('muse', '', '', true, 'abc')).toBe(false)
    expect(diagKeyFormat('muse', '', '', true, 'abc')).toEqual({ valid: false, problem: { kind: 'prefix', prefix: 'LLM_' } })
    expect(diagKeyFormat('muse', '', '', true, VALID_KEY)).toEqual({ valid: true, problem: null })
  })
})
