/*
 * ForgeClaw — Ollama/Termux local runtime integration.
 *
 * The phone runtime exposes Ollama's CORS-enabled OpenAI-compatible /v1
 * endpoints. The default endpoint is the loopback root; requests are made to
 * /v1/chat/completions and /v1/models. Tool definitions remain subject to
 * ForgeClaw's existing Guardian/tool execution boundary.
 *
 * Unfinished/untested: live phone connectivity cannot be verified from this
 * sandbox until an Ollama listener is reachable here or through the phone's
 * configured address. The UI endpoint field supports that deployment choice.
 */

import type { AIMessage, AIProvider, AIRequest, AIResponse, AIToolCall } from '../types'

export const DEFAULT_OLLAMA_ENDPOINT = 'http://127.0.0.1:11434'
export const DEFAULT_OLLAMA_MODEL = 'qwen2.5:1.5b'

export const OLLAMA_MODELS = [
  {
    id: DEFAULT_OLLAMA_MODEL,
    label: 'Qwen2.5 1.5B (Ollama)',
    contextK: 8,
    note: 'Verified phone model: qwen2.5:1.5b',
  },
]

type OllamaMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_call_id?: string
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
}

type OllamaTool = {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

type OllamaResponse = {
  model?: string
  choices?: Array<{
    message?: {
      content?: string | null
      tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>
    }
    delta?: { content?: string }
    finish_reason?: string
  }>
  error?: { message?: string } | string
}

type OllamaChoiceMessage = {
  content?: string | null
  tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>
}

function endpoint(apiKey: string): string {
  const configured = apiKey.trim() || import.meta.env.VITE_OLLAMA_URL || DEFAULT_OLLAMA_ENDPOINT
  const normalized = configured.replace(/\/+$/, '')
  return normalized.endsWith('/v1') ? normalized : `${normalized}/v1`
}

function toMessages(systemPrompt: string, messages: AIMessage[]): OllamaMessage[] {
  return [
    { role: 'system', content: systemPrompt },
    ...messages.map(message => {
      const mapped: OllamaMessage = { role: message.role, content: message.content }
      if (message.role === 'tool') mapped.tool_call_id = message.tool_call_id
      if (message.role === 'assistant' && message.tool_calls?.length) {
        mapped.tool_calls = message.tool_calls.map(call => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) },
        }))
      }
      return mapped
    }),
  ]
}

function toTools(tools: NonNullable<AIRequest['tools']>): OllamaTool[] {
  return tools.map(tool => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }))
}

async function responseError(response: Response): Promise<string> {
  const raw = await response.text().catch(() => '')
  if (!raw) return `Ollama ${response.status}`
  try {
    const parsed = JSON.parse(raw) as OllamaResponse
    const detail = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message
    return detail ? `Ollama ${response.status}: ${detail}` : `Ollama ${response.status}: ${raw.slice(0, 300)}`
  } catch {
    return `Ollama ${response.status}: ${raw.slice(0, 300)}`
  }
}

function parseToolCalls(message: OllamaChoiceMessage | undefined): AIToolCall[] | undefined {
  const calls = (message?.tool_calls ?? []).map((call, index) => {
    const name = call.function?.name ?? ''
    const rawInput = call.function?.arguments ?? '{}'
    let input: Record<string, unknown> = {}
    try { input = JSON.parse(rawInput) as Record<string, unknown> } catch { input = {} }
    return { id: call.id || `ollama-call-${Date.now()}-${index}`, name, input }
  }).filter(call => call.name)
  return calls.length ? calls : undefined
}

async function readStream(response: Response, onToken: (token: string) => void): Promise<{ text: string; toolCalls?: AIToolCall[]; stopReason?: string }> {
  const reader = response.body?.getReader()
  if (!reader) return { text: '' }
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let toolCalls: AIToolCall[] | undefined
  let stopReason: string | undefined
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
        const event = JSON.parse(raw) as OllamaResponse
        const token = event.choices?.[0]?.delta?.content ?? ''
        if (token) { text += token; onToken(token) }
        const parsedCalls = parseToolCalls(event.choices?.[0]?.message)
        if (parsedCalls) toolCalls = [...(toolCalls ?? []), ...parsedCalls]
        if (event.choices?.[0]?.finish_reason) stopReason = event.choices[0].finish_reason
      }
    }
    if (buffer.trim().startsWith('data: ')) {
      const raw = buffer.trim().slice(6).trim()
      if (raw && raw !== '[DONE]') {
        const event = JSON.parse(raw) as OllamaResponse
        const token = event.choices?.[0]?.delta?.content ?? ''
        if (token) { text += token; onToken(token) }
        const parsedCalls = parseToolCalls(event.choices?.[0]?.message)
        if (parsedCalls) toolCalls = [...(toolCalls ?? []), ...parsedCalls]
        stopReason = event.choices?.[0]?.finish_reason ?? stopReason
      }
    }
  } finally {
    reader.releaseLock()
  }
  return { text, toolCalls, stopReason }
}

export const ollamaProvider: AIProvider = {
  id: 'ollama',
  label: 'Ollama (Termux)',
  requiresKey: false,
  models: OLLAMA_MODELS,

  isConfigured(apiKey: string): boolean {
    const value = apiKey.trim() || import.meta.env.VITE_OLLAMA_URL || DEFAULT_OLLAMA_ENDPOINT
    return /^https?:\/\//i.test(value)
  },

  supportsTools(): boolean { return true },

  async send(request: AIRequest, apiKey: string): Promise<AIResponse> {
    const model = request.model || DEFAULT_OLLAMA_MODEL
    const body: Record<string, unknown> = {
      model,
      messages: toMessages(request.systemPrompt, request.messages),
      stream: !!request.onToken,
      max_tokens: request.maxTokens ?? 2048,
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
      const streamed = await readStream(response, request.onToken)
      return { text: streamed.text, provider: 'ollama', model, toolCalls: streamed.toolCalls, stopReason: streamed.stopReason ?? 'stop' }
    }

    const data = await response.json() as OllamaResponse
    if (data.error) throw new Error(typeof data.error === 'string' ? data.error : data.error.message || 'Ollama error')
    const choice = data.choices?.[0]
    const message = choice?.message
    return {
      text: message?.content ?? '',
      provider: 'ollama',
      model: data.model ?? model,
      toolCalls: parseToolCalls(message),
      stopReason: choice?.finish_reason,
    }
  },

  async test(apiKey: string): Promise<void> {
    const response = await fetch(`${endpoint(apiKey)}/models`)
    if (!response.ok) throw new Error(await responseError(response))
  },
}
