// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── OpenAI Provider Adapter ─────────────────────────────────────────────────

import type { AIProvider, AIRequest, AIToolCall } from '../types'

// ─── Models ─────────────────────────────────────────────────────────────────

export const OPENAI_MODELS = [
  { id: 'gpt-4o',           label: 'GPT-4o',           contextK: 128, note: 'Flagship' },
  { id: 'gpt-4o-mini',      label: 'GPT-4o Mini',      contextK: 128, note: 'Fast & cheap' },
  { id: 'gpt-4-turbo',      label: 'GPT-4 Turbo',      contextK: 128 },
  { id: 'gpt-3.5-turbo',    label: 'GPT-3.5 Turbo',    contextK: 16,  note: 'Legacy' },
]

export type OpenAIModelId = typeof OPENAI_MODELS[number]['id']

// ─── Tool Format Conversion ─────────────────────────────────────────────────

function toOpenAITools(tools: NonNullable<AIRequest['tools']>) {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }))
}

// ─── Streaming Parser ─────────────────────────────────────────────────────────

interface StreamChunk {
  choices?: Array<{
    delta?: {
      content?: string
      tool_calls?: Array<{
        index: number
        id?: string
        type?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
  error?: { message?: string }
}

// ─── Provider Implementation ─────────────────────────────────────────────────

export const openaiProvider: AIProvider = {
  id: 'openai',
  label: 'OpenAI',
  requiresKey: true,
  models: OPENAI_MODELS,

  isConfigured(apiKey: string) {
    return typeof apiKey === 'string' && apiKey.startsWith('sk-') && apiKey.length > 20
  },

  supportsTools() {
    return true // All current OpenAI chat models support function calling
  },

  async send(request, apiKey) {
    const { systemPrompt, messages, model, maxTokens = 4096, tools, onToken } = request
    const streaming = !!onToken

    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => {
          const base: Record<string, unknown> = { role: m.role, content: m.content }
          if (m.tool_call_id) base.tool_call_id = m.tool_call_id
          if (m.tool_calls) base.tool_calls = m.tool_calls
          return base
        }),
      ],
      stream: streaming,
    }

    if (tools?.length) {
      body.tools = toOpenAITools(tools)
      body.tool_choice = 'auto'
    }

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const raw = await res.text().catch(() => '')
      let detail = `OpenAI ${res.status}`
      try {
        const parsed = JSON.parse(raw) as { error?: { message?: string } }
        detail = parsed.error?.message || detail
      } catch { /* raw stays as detail fallback */ }
      throw new Error(detail)
    }

    // ── Streaming ────────────────────────────────────────────────────────────
    if (streaming && res.body) {
      let fullText = ''
      const toolCallBuffers: Record<number, { id: string; name: string; args: string }> = {}

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.startsWith('data: ') || line.includes('[DONE]')) continue
            let chunk: StreamChunk
            try { chunk = JSON.parse(line.slice(6)) } catch { continue }

            if (chunk.error?.message) throw new Error(chunk.error.message)

            const delta = chunk.choices?.[0]?.delta
            if (delta?.content) {
              fullText += delta.content
              onToken!(delta.content)
            }

            // Accumulate tool calls from stream
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (!toolCallBuffers[tc.index]) {
                  toolCallBuffers[tc.index] = {
                    id: tc.id || `call_${tc.index}`,
                    name: tc.function?.name || '',
                    args: tc.function?.arguments || '',
                  }
                } else {
                  if (tc.function?.name) toolCallBuffers[tc.index].name = tc.function.name
                  if (tc.function?.arguments) toolCallBuffers[tc.index].args += tc.function.arguments
                }
              }
            }
          }
        }
      } finally {
        reader.releaseLock()
      }

      const toolCalls: AIToolCall[] | undefined = Object.values(toolCallBuffers).length
        ? Object.values(toolCallBuffers).map(b => ({
            id: b.id,
            name: b.name,
            input: b.args ? JSON.parse(b.args) as Record<string, unknown> : {},
          }))
        : undefined

      return {
        text: fullText,
        provider: 'openai',
        model,
        toolCalls,
      }
    }

    // ── Non-streaming ──────────────────────────────────────────────────────────
    type OAIResponse = {
      choices: Array<{
        message: {
          content: string | null
          tool_calls?: Array<{
            id: string
            type: string
            function: { name: string; arguments: string }
          }>
        }
        finish_reason: string | null
      }>
    }

    const data = await res.json() as OAIResponse
    const msg = data.choices[0]?.message
    const rawToolCalls = msg?.tool_calls
    const toolCalls: AIToolCall[] | undefined = rawToolCalls?.map(tc => {
      try {
        return { id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments) as Record<string, unknown> }
      } catch {
        return { id: tc.id, name: tc.function.name, input: {} }
      }
    })

    return {
      text: msg?.content ?? '',
      provider: 'openai',
      model,
      toolCalls: toolCalls?.length ? toolCalls : undefined,
      stopReason: data.choices[0]?.finish_reason ?? undefined,
    }
  },

  async test(apiKey) {
    await this.send(
      {
        systemPrompt: 'You are a test assistant.',
        messages: [{ role: 'user', content: 'ping' }],
        model: 'gpt-4o-mini',
        maxTokens: 1,
      },
      apiKey,
    )
  },
}
