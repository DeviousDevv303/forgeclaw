/*
 * ForgeClaw — Ollama integration tests.
 *
 * Decisions: use deterministic mocked fetch responses so tests verify the native
 * Ollama /api/tags and newline-delimited /api/chat contracts without requiring a
 * phone, Termux process, model download, or network access.
 *
 * Unfinished/untested: live Android/Termux connectivity and CORS are environment
 * acceptance checks, not unit-test concerns.
 */

import { describe, expect, it, vi } from 'vitest'
import { ollamaProvider } from './ollamaProvider'

describe('ollamaProvider', () => {
  it('tests the configured Ollama tags endpoint', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ models: [] }), { status: 200 }))
    await ollamaProvider.test('http://127.0.0.1:11434')
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:11434/api/tags')
    fetcher.mockRestore()
  })

  it('parses streamed native Ollama chat events and preserves tool calls', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"message":{"role":"assistant","content":"LOCAL"},"done":false}\n'))
        controller.enqueue(new TextEncoder().encode('{"message":{"content":" OK"},"done":false}\n'))
        controller.enqueue(new TextEncoder().encode('{"message":{"content":"","tool_calls":[{"function":{"name":"run_js","arguments":{"code":"6*7"}}}]},"done":true,"done_reason":"stop"}\n'))
        controller.close()
      },
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(stream, { status: 200 }))
    const tokens: string[] = []
    const response = await ollamaProvider.send({
      systemPrompt: 'system',
      messages: [{ role: 'user', content: 'test' }],
      model: 'llama3.2:3b',
      onToken: token => tokens.push(token),
    }, 'http://127.0.0.1:11434')
    expect(tokens.join('')).toBe('LOCAL OK')
    expect(response.text).toBe('LOCAL OK')
    expect(response.toolCalls?.[0]?.name).toBe('run_js')
    expect(response.stopReason).toBe('stop')
    vi.restoreAllMocks()
  })
})
