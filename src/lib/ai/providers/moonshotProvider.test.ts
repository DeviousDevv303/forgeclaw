import { describe, expect, it, vi } from 'vitest'
import { moonshotProvider } from './moonshotProvider'

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
})
