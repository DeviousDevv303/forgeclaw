// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Local Inference Provider Adapter ─────────────────────────────────────────
// OpenAI-compatible transport for a local llama.cpp server.
// The runtime is replaceable: ForgeClaw depends on this HTTP contract, not on
// llama.cpp internals. Start llama-server with a GGUF model and expose /v1.

import type { AIProvider, AIRequest, AIResponse, AIToolCall, AIMessage } from '../types'

export const DEFAULT_LOCAL_ENDPOINT = 'http://127.0.0.1:8080/v1'
export const DEFAULT_LOCAL_MODEL = 'local-model'

export const LOCAL_MODELS = [
  {
    id: DEFAULT_LOCAL_MODEL,
    label: 'Local GGUF (llama.cpp)',
    contextK: 8,
    note: 'Use a quantized 1.5B–3B model; server selects the loaded GGUF',
  },
]

type LocalMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

type LocalResponse = {
  choices?: Array<{
    message?: {
      content?: string | null
      tool_calls?: Array<{
        id: string
        type?: 'function'
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string
  }>
  error?: { message?: string } | string
}

function endpoint(apiKey: string): string {
  const configured = apiKey.trim() || import.meta.env.VITE_LOCAL_INFERENCE_URL || DEFAULT_LOCAL_ENDPOINT
  return configured.replace(/\/+$/, '')
}

function toMessages(systemPrompt: string, messages: AIMessage[]): LocalMessage[] {
  return [
    { role: 'system', content: systemPrompt },
    ...messages.map((message): LocalMessage => {
      if (message.role === 'tool') {
        return { role: 'tool', content: message.content, tool_call_id: message.tool_call_id }
      }
      if (message.role === 'assistant') {
        return {
          role: 'assistant',
          content: message.content || null,
          tool_calls: message.tool_calls?.map(call => ({
            id: call.id,
            type: 'function' as const,
            function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) },
          })),
        }
      }
      return { role: 'user', content: message.content }
    }),
  ]
}

function toTools(tools: NonNullable<AIRequest['tools']>) {
  return tools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
}

async function responseError(response: Response): Promise<string> {
  const raw = await response.text().catch(() => '')
  if (!raw) return `Local inference ${response.status}`
  try {
    const parsed = JSON.parse(raw) as LocalResponse
    const detail = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message
    return detail ? `Local inference ${response.status}: ${detail}` : `Local inference ${response.status}`
  } catch {
    return `Local inference ${response.status}: ${raw.slice(0, 300)}`
  }
}

async function readStream(response: Response, onToken: (token: string) => void): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const raw = line.slice(6).trim()
        if (!raw || raw === '[DONE]') continue
        const event = JSON.parse(raw) as { choices?: Array<{ delta?: { content?: string } }> }
        const token = event.choices?.[0]?.delta?.content
        if (token) { text += token; onToken(token) }
      }
    }
  } finally {
    reader.releaseLock()
  }
  return text
}

export const localInferenceProvider: AIProvider = {
  id: 'local',
  label: 'Local Inference (llama.cpp)',
  requiresKey: false,
  models: LOCAL_MODELS,

  isConfigured(apiKey: string): boolean {
    const value = apiKey.trim() || import.meta.env.VITE_LOCAL_INFERENCE_URL || DEFAULT_LOCAL_ENDPOINT
    return /^https?:\/\//i.test(value)
  },

  supportsTools(): boolean {
    return true
  },

  async send(request: AIRequest, apiKey: string): Promise<AIResponse> {
    const model = request.model || DEFAULT_LOCAL_MODEL
    const body: Record<string, unknown> = {
      model,
      messages: toMessages(request.systemPrompt, request.messages),
      max_tokens: request.maxTokens ?? 2048,
      stream: !!request.onToken,
    }
    if (request.tools?.length) {
      body.tools = toTools(request.tools)
      body.tool_choice = 'auto'
    }

    const response = await fetch(`${endpoint(apiKey)}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(await responseError(response))

    if (request.onToken) {
      return {
        text: await readStream(response, request.onToken),
        provider: 'local',
        model,
        stopReason: 'stop',
      }
    }

    const data = await response.json() as LocalResponse
    if (data.error) throw new Error(typeof data.error === 'string' ? data.error : data.error.message || 'Local inference error')
    const choice = data.choices?.[0]
    const message = choice?.message
    const toolCalls: AIToolCall[] = (message?.tool_calls ?? []).map(call => ({
      id: call.id,
      name: call.function?.name || '',
      input: (() => {
        try { return JSON.parse(call.function?.arguments || '{}') as Record<string, unknown> } catch { return {} }
      })(),
    })).filter(call => call.id && call.name)

    return {
      text: message?.content ?? '',
      provider: 'local',
      model,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      stopReason: choice?.finish_reason,
    }
  },

  async test(apiKey: string): Promise<void> {
    const response = await fetch(`${endpoint(apiKey)}/models`)
    if (!response.ok) throw new Error(await responseError(response))
  },
}
