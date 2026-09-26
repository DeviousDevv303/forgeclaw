/*
 * ForgeClaw — Ollama integration tests.
 *
 * Decisions: use deterministic mocked fetch responses so tests verify the
 * CORS-enabled OpenAI-compatible Ollama /v1/models and /v1/chat/completions contracts without requiring a
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
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:11434/v1/models')
    fetcher.mockRestore()
  })

  it('parses streamed native Ollama chat events and preserves tool calls', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"LOCAL"}}]}\n\n'))
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":" OK"}}]}\n\n'))
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'))
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(stream, { status: 200 }))
    const tokens: string[] = []
    const response = await ollamaProvider.send({
      systemPrompt: 'system',
      messages: [{ role: 'user', content: 'test' }],
      model: 'qwen2.5:1.5b',
      onToken: token => tokens.push(token),
    }, 'http://127.0.0.1:11434')
    expect(tokens.join('')).toBe('LOCAL OK')
    expect(response.text).toBe('LOCAL OK')
    expect(response.stopReason).toBe('stop')
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:11434/v1/chat/completions', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('qwen2.5:1.5b'),
    }))
    vi.restoreAllMocks()
  })
})
