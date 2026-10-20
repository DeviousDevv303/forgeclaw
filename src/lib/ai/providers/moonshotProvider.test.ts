import { describe, expect, it, vi } from 'vitest'
import { MOONSHOT_DEFAULT_MAX_TOKENS, moonshotProvider, resolveMoonshotModel, toMoonshotMessages } from './moonshotProvider'

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

describe('Moonshot provider', () => {
  it('keeps streamed native tool calls instead of dropping them before the tool loop', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input
      void _init
      return sseResponse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"github_read_file","arguments":"{\\"path\\":\\"src/App.tsx\\"}"}}]}}]}\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n',
      'data: [DONE]\n',
      ])
    })
    vi.stubGlobal('fetch', fetchMock)

    const tokens: string[] = []
    const response = await moonshotProvider.send({
      systemPrompt: 'You are ForgeClaw.',
      messages: [{ role: 'user', content: 'Read the app file.' }],
      model: 'kimi-k2.7-code',
      tools: [{ name: 'github_read_file', description: 'Read a file', parameters: { type: 'object' } }],
      onToken: token => tokens.push(token),
    }, 'sk-test-key-12345678901234567890')

    expect(response.toolCalls).toEqual([{
      id: 'call_1',
      name: 'github_read_file',
      input: { path: 'src/App.tsx' },
    }])
    expect(response.text).toBe('')
    expect(response.stopReason).toBe('tool_calls')
    expect(tokens).toEqual([])
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string).model).toBe('kimi-k2.7-code')
  })

  it('streams ordinary text while preserving the selected Kimi model', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
      'data: {"choices":[{"delta":{"content":" from Kimi."},"finish_reason":"stop"}]}\n',
      'data: [DONE]\n',
    ])))

    const tokens: string[] = []
    const response = await moonshotProvider.send({
      systemPrompt: '',
      messages: [{ role: 'user', content: 'Say hello.' }],
      model: 'kimi-k2.7-code',
      onToken: token => tokens.push(token),
    }, 'sk-test-key-12345678901234567890')

    expect(response.text).toBe('Hello from Kimi.')
    expect(tokens).toEqual(['Hello', ' from Kimi.'])
    expect(response.model).toBe('kimi-k2.7-code')
  })

  it('keeps Kimi reasoning_content out of the answer and sends it back on the tool-call turn', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input
      void _init
      return Response.json({
      choices: [{
        message: {
          content: '',
          reasoning_content: 'I should read the file first.',
          tool_calls: [{ id: 'call_9', type: 'function', function: { name: 'github_read_file', arguments: '{"path":"README.md"}' } }],
        },
        finish_reason: 'tool_calls',
      }],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await moonshotProvider.send({
      systemPrompt: 's', messages: [{ role: 'user', content: 'Read the readme.' }], model: 'kimi-k2.6',
      tools: [{ name: 'github_read_file', description: 'Read a file', parameters: { type: 'object' } }],
    }, 'sk-test-key-12345678901234567890')

    expect(response.text).toBe('')
    expect(response.reasoningContent).toBe('I should read the file first.')
    expect(response.toolCalls).toEqual([{ id: 'call_9', name: 'github_read_file', input: { path: 'README.md' } }])
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)
    expect(body.max_tokens).toBe(MOONSHOT_DEFAULT_MAX_TOKENS)
    expect(body.max_tokens).toBeGreaterThanOrEqual(16000)
    expect(body.temperature).toBeUndefined()

    const next = toMoonshotMessages('s', [
      { role: 'user', content: 'Read the readme.' },
      { role: 'assistant', content: '', reasoning_content: response.reasoningContent, tool_calls: response.toolCalls },
      { role: 'tool', content: '# ForgeClaw', tool_call_id: 'call_9' },
    ])
    expect(next[2]).toMatchObject({ role: 'assistant', reasoning_content: 'I should read the file first.' })
    expect(next[3]).toEqual({ role: 'tool', content: '# ForgeClaw', tool_call_id: 'call_9' })
  })

  it('never streams reasoning tokens into the visible answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'data: {"choices":[{"delta":{"reasoning_content":"thinking..."}}]}\n',
      'data: {"choices":[{"delta":{"content":"Done."},"finish_reason":"stop"}]}\n',
    ])))
    const tokens: string[] = []
    const response = await moonshotProvider.send({ systemPrompt: '', messages: [{ role: 'user', content: 'x' }], model: 'kimi-k2.6', onToken: t => tokens.push(t) }, 'sk-test-key-12345678901234567890')
    expect(tokens).toEqual(['Done.'])
    expect(response.text).toBe('Done.')
    expect(response.reasoningContent).toBe('thinking...')
  })

  it('marks a tool call cut off by the output limit instead of running it with empty arguments', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_2","function":{"name":"github_write_file","arguments":"{\\"path\\":\\"index.html\\",\\"content\\":\\"<html>"}}]}}]}\n',
      'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n',
    ])))
    const response = await moonshotProvider.send({ systemPrompt: '', messages: [{ role: 'user', content: 'x' }], model: 'kimi-k2.6', onToken: () => {} }, 'sk-test-key-12345678901234567890')
    expect(response.stopReason).toBe('length')
    expect(response.toolCalls?.[0]).toMatchObject({ id: 'call_2', name: 'github_write_file', input: {} })
    expect(response.toolCalls?.[0]?.parseError).toMatch(/output token limit/)
  })

  it('marks invalid tool-call JSON rather than silently passing {}', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      choices: [{ message: { content: '', tool_calls: [{ id: 'c', type: 'function', function: { name: 'github_read_file', arguments: '{path:' } }] }, finish_reason: 'tool_calls' }],
    })))
    const response = await moonshotProvider.send({ systemPrompt: '', messages: [{ role: 'user', content: 'x' }], model: 'kimi-k2.6' }, 'sk-test-key-12345678901234567890')
    expect(response.toolCalls?.[0]?.parseError).toMatch(/not valid JSON/)
  })

  it('migrates a retired saved model to the default', () => {
    expect(resolveMoonshotModel('kimi-k2.5')).toBe('kimi-k2.6')
    expect(resolveMoonshotModel('moonshot-v1-8k')).toBe('kimi-k2.6')
    expect(resolveMoonshotModel(null)).toBe('kimi-k2.6')
    expect(resolveMoonshotModel('kimi-k3')).toBe('kimi-k3')
  })

  it('tests the key with GET /models, spending no tokens', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _init
      return Response.json({ data: [{ id: 'kimi-k2.6' }, { id: 'kimi-k3' }] })
    })
    vi.stubGlobal('fetch', fetchMock)
    await moonshotProvider.test('sk-test-key-12345678901234567890')
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://api.moonshot.ai/v1/models')
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBeUndefined()
  })

  it('reports a key that works but has none of the selectable models', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ id: 'some-other-model' }] })))
    await expect(moonshotProvider.test('sk-test-key-12345678901234567890')).rejects.toThrow(/none of ForgeClaw's Kimi models/)
  })
})
