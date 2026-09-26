/*
 * ForgeClaw — Ollama/Termux local runtime integration.
 *
 * Decisions: use Ollama's native /api/chat and /api/tags endpoints rather than
 * assuming OpenAI compatibility. The default endpoint is loopback port 11434,
 * which is correct when ForgeClaw and Ollama run on the same Android device.
 * Streaming uses Ollama's newline-delimited JSON protocol. Tool definitions are
 * forwarded in Ollama's native function shape, but the provider remains subject
 * to ForgeClaw's existing Guardian/tool execution boundary.
 *
 * Unfinished/untested: live phone connectivity cannot be verified from this
 * sandbox until an Ollama listener is reachable here or through the phone's
 * configured address. The UI endpoint field supports that deployment choice.
 */

import type { AIMessage, AIProvider, AIRequest, AIResponse, AIToolCall } from '../types'

export const DEFAULT_OLLAMA_ENDPOINT = 'http://127.0.0.1:11434'
export const DEFAULT_OLLAMA_MODEL = 'llama3.2:3b'

export const OLLAMA_MODELS = [
  {
    id: DEFAULT_OLLAMA_MODEL,
    label: 'Llama 3.2 3B (Ollama)',
    contextK: 8,
    note: 'Install with: ollama pull llama3.2:3b',
  },
]

type OllamaMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>
}

type OllamaTool = {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

type OllamaResponse = {
  model?: string
  message?: { role?: string; content?: string; tool_calls?: Array<{ function?: { name?: string; arguments?: Record<string, unknown> | string } }> }
  done?: boolean
  done_reason?: string
  error?: string
}

function endpoint(apiKey: string): string {
  const configured = apiKey.trim() || import.meta.env.VITE_OLLAMA_URL || DEFAULT_OLLAMA_ENDPOINT
  return configured.replace(/\/+$/, '')
}

function toMessages(systemPrompt: string, messages: AIMessage[]): OllamaMessage[] {
  return [
    { role: 'system', content: systemPrompt },
    ...messages.map(message => {
      const mapped: OllamaMessage = { role: message.role, content: message.content }
      if (message.role === 'tool') mapped.tool_call_id = message.tool_call_id
      if (message.role === 'assistant' && message.tool_calls?.length) {
        mapped.tool_calls = message.tool_calls.map(call => ({ function: { name: call.name, arguments: call.input ?? {} } }))
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
    return parsed.error ? `Ollama ${response.status}: ${parsed.error}` : `Ollama ${response.status}: ${raw.slice(0, 300)}`
  } catch {
    return `Ollama ${response.status}: ${raw.slice(0, 300)}`
  }
}

function parseToolCalls(message: OllamaResponse['message']): AIToolCall[] | undefined {
  const calls = (message?.tool_calls ?? []).map((call, index) => {
    const name = call.function?.name ?? ''
    const rawInput = call.function?.arguments ?? {}
    let input: Record<string, unknown> = {}
    if (typeof rawInput === 'string') {
      try { input = JSON.parse(rawInput) as Record<string, unknown> } catch { input = {} }
    } else input = rawInput
    return { id: `ollama-call-${Date.now()}-${index}`, name, input }
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
        const raw = line.trim()
        if (!raw) continue
        const event = JSON.parse(raw) as OllamaResponse
        if (event.error) throw new Error(`Ollama: ${event.error}`)
        const token = event.message?.content ?? ''
        if (token) { text += token; onToken(token) }
        const parsedCalls = parseToolCalls(event.message)
        if (parsedCalls) toolCalls = [...(toolCalls ?? []), ...parsedCalls]
        if (event.done) stopReason = event.done_reason
      }
    }
    if (buffer.trim()) {
      const event = JSON.parse(buffer.trim()) as OllamaResponse
      const token = event.message?.content ?? ''
      if (token) { text += token; onToken(token) }
      const parsedCalls = parseToolCalls(event.message)
      if (parsedCalls) toolCalls = [...(toolCalls ?? []), ...parsedCalls]
      stopReason = event.done_reason ?? stopReason
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
      options: { num_predict: request.maxTokens ?? 2048 },
    }
    if (request.tools?.length) body.tools = toTools(request.tools)

    const response = await fetch(`${endpoint(apiKey)}/api/chat`, {
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
    if (data.error) throw new Error(`Ollama: ${data.error}`)
    return {
      text: data.message?.content ?? '',
      provider: 'ollama',
      model: data.model ?? model,
      toolCalls: parseToolCalls(data.message),
      stopReason: data.done_reason,
    }
  },

  async test(apiKey: string): Promise<void> {
    const response = await fetch(`${endpoint(apiKey)}/api/tags`)
    if (!response.ok) throw new Error(await responseError(response))
  },
}
