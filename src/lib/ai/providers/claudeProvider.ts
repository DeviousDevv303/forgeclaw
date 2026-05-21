// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Claude (Anthropic) Provider Adapter ────────────────────────────────────

import type { AIProvider, AIRequest, AIToolCall } from '../types'

// ─── Models ─────────────────────────────────────────────────────────────────

export const CLAUDE_MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5',  contextK: 200 },
  { id: 'claude-sonnet-4-6',         label: 'Sonnet 4.6', contextK: 200 },
  { id: 'claude-opus-4-7',           label: 'Opus 4.7',   contextK: 200 },
]

export type ClaudeModelId = typeof CLAUDE_MODELS[number]['id']

// ─── Tool Format Conversion ───────────────────────────────────────────────────

function toAnthropicTools(tools: NonNullable<AIRequest['tools']>) {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }))
}

// ─── Streaming Parser ───────────────────────────────────────────────────────

interface StreamEvent {
  type: string
  delta?: { type: string; text?: string }
  content_block?: { type: string; id?: string; name?: string; input?: Record<string, unknown> }
}

// ─── Provider Implementation ────────────────────────────────────────────────

export const claudeProvider: AIProvider = {
  id: 'anthropic',
  label: 'Claude',
  requiresKey: true,
  models: CLAUDE_MODELS,

  isConfigured(apiKey: string): boolean {
    return typeof apiKey === 'string' && apiKey.startsWith('sk-ant-') && apiKey.length > 20
  },

  supportsTools(_modelId: string): boolean {
    return true
  },

  async send(request: AIRequest, apiKey: string): Promise<{ text: string; provider: string; model: string; toolCalls?: AIToolCall[]; stopReason?: string }> {
    const { systemPrompt, messages, model, maxTokens = 4096, tools, onToken } = request

    // Build Anthropic message format
    const anthropicMessages = messages.map(m => {
      if (m.role === 'tool') {
        return {
          role: 'user' as const,
          content: [{ type: 'tool_result' as const, tool_use_id: m.tool_call_id, content: m.content }],
        }
      }
      if (m.role === 'assistant' && m.tool_calls) {
        return {
          role: 'assistant' as const,
          content: [
            ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
            ...m.tool_calls.map(tc => ({
              type: 'tool_use' as const,
              id: tc.id,
              name: tc.name,
              input: tc.input,
            })),
          ],
        }
      }
      return { role: m.role as 'user' | 'assistant', content: m.content }
    })

    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: anthropicMessages,
      stream: !!onToken,
    }

    if (tools?.length) {
      body.tools = toAnthropicTools(tools)
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
      throw new Error(err.error?.message || `Claude ${res.status}`)
    }

    // Streaming
    if (onToken && res.body) {
      let fullText = ''
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const evt = JSON.parse(line.slice(6)) as StreamEvent
            if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta' && evt.delta.text) {
              fullText += evt.delta.text
              onToken(evt.delta.text)
            }
          } catch { /* skip non-JSON lines */ }
        }
      }
      return { text: fullText, provider: 'anthropic', model, stopReason: 'end_turn' }
    }

    // Non-streaming
    type AnthropicResponse = {
      stop_reason: string
      content: Array<
        | { type: 'text'; text: string }
        | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
      >
    }

    const data = await res.json() as AnthropicResponse
    const textBlock = data.content.find(b => b.type === 'text') as { type: 'text'; text: string } | undefined
    const toolBlocks = data.content.filter(b => b.type === 'tool_use') as Array<{ type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }>
    const toolCalls: AIToolCall[] = toolBlocks.map(b => ({ id: b.id, name: b.name, input: b.input }))

    return {
      text: textBlock?.text ?? '',
      provider: 'anthropic',
      model,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      stopReason: data.stop_reason,
    }
  },

  async test(apiKey: string): Promise<void> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        system: 'You are a test assistant.',
        messages: [{ role: 'user', content: 'ping' }],
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
      throw new Error(err.error?.message || `Claude test failed: ${res.status}`)
    }
  },
}
