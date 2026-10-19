// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Moonshot (Kimi) Provider Adapter ───────────────────────────────────────
// OpenAI-compatible API via https://api.moonshot.ai/v1
// Supports native tool calling.
// PROD NOTE: When hosted with ForgeMind engine, calls can route through /api/moonshot
// to keep the API key server-side. See engine/server.ts.
// For GitHub Pages (static hosting, no backend), always use the direct API URL
// since the key is stored in browser localStorage anyway.

import type { AIProvider, AIRequest, AIResponse, AIToolCall, AIMessage } from '../types'

// Always use direct API URL in the browser — the proxy path (/api/moonshot)
// only works when the ForgeMind engine backend is running, which isn't the
// case for GitHub Pages deployments.
const MOONSHOT_BASE_URL = 'https://api.moonshot.ai/v1';

export const MOONSHOT_MODELS = [
  { id: 'kimi-k2.6', label: 'Kimi K2.6', contextK: 256, note: 'General reasoning model' },
  { id: 'kimi-k2.7-code', label: 'Kimi K2.7 Code', contextK: 256, note: 'Coding-focused model' },
]

export const DEFAULT_MOONSHOT_MODEL = MOONSHOT_MODELS[0].id // K2.6 default for this API account

function cleanApiKey(apiKey: string): string {
  return apiKey.trim()
}

function isConfigured(apiKey: string): boolean {
  const key = cleanApiKey(apiKey)
  return key.startsWith('sk-') && key.length > 20
}

function toMoonshotMessages(systemPrompt: string, messages: AIMessage[]): Array<{ role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string }> {
  const result: Array<{ role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string }> = [
    { role: 'system', content: systemPrompt },
  ]
  
  for (const msg of messages) {
    // Moonshot rejects empty assistant messages (400). Skip messages with
    // no content and no tool calls — these come from failed/empty responses.
    const hasContent = msg.content && msg.content.trim().length > 0
    const hasToolCalls = msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0
    if (!hasContent && !hasToolCalls) continue
    if (msg.role === 'tool') {
      result.push({
        role: 'tool',
        content: msg.content,
        tool_call_id: msg.tool_call_id || '',
      })
    } else if (msg.role === 'assistant' && msg.tool_calls) {
      result.push({
        role: 'assistant',
        content: msg.content || '',
        tool_calls: msg.tool_calls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.input || {}),
          },
        })),
      })
    } else {
      result.push({
        role: msg.role,
        content: msg.content,
      })
    }
  }
  
  return result
}

function toMoonshotTools(tools: NonNullable<AIRequest['tools']>) {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }))
}

async function moonshotError(response: Response): Promise<string> {
  const raw = await response.text().catch(() => '')
  if (!raw) return `Moonshot ${response.status}`
  
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } | string; message?: string }
    const detail = typeof parsed.error === 'string'
      ? parsed.error
      : parsed.error?.message ?? parsed.message
    return detail ? `Moonshot ${response.status}: ${detail}` : `Moonshot ${response.status}`
  } catch {
    return `Moonshot ${response.status}: ${raw.slice(0, 300)}`
  }
}

type MoonshotStreamEvent = {
  choices?: Array<{
    delta?: {
      content?: string | null
      tool_calls?: Array<{
        index?: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
  error?: { message?: string } | string
}

async function readMoonshotStream(
  response: Response,
  onToken: (token: string) => void,
): Promise<{ text: string; toolCalls?: AIToolCall[]; stopReason?: string }> {
  const reader = response.body?.getReader()
  if (!reader) return { text: '' }

  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  const streamedCalls = new Map<number, { id: string; name: string; arguments: string }>()
  let stopReason: string | undefined

  const consumeLine = (line: string) => {
    if (!line.startsWith('data: ')) return
    const raw = line.slice(6).trim()
    if (!raw || raw === '[DONE]') return
    const event = JSON.parse(raw) as MoonshotStreamEvent
    if (event.error) {
      const detail = typeof event.error === 'string' ? event.error : event.error.message
      throw new Error(detail || 'Moonshot stream error')
    }
    const choice = event.choices?.[0]
    const delta = choice?.delta
    if (choice?.finish_reason) stopReason = choice.finish_reason
    if (delta?.content) {
      text += delta.content
      onToken(delta.content)
    }
    for (const call of delta?.tool_calls ?? []) {
      const index = call.index ?? streamedCalls.size
      const existing = streamedCalls.get(index) ?? { id: '', name: '', arguments: '' }
      if (call.id) existing.id = call.id
      if (call.function?.name) existing.name += call.function.name
      if (call.function?.arguments) existing.arguments += call.function.arguments
      streamedCalls.set(index, existing)
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) consumeLine(line.trimEnd())
    }
    if (buffer) consumeLine(buffer.trimEnd())
  } finally {
    reader.releaseLock()
  }

  const toolCalls = [...streamedCalls.values()]
    .map(call => ({
      id: call.id,
      name: call.name,
      input: (() => {
        try { return JSON.parse(call.arguments || '{}') as Record<string, unknown> } catch { return {} }
      })(),
    }))
    .filter(call => call.id && call.name)

  return { text, toolCalls: toolCalls.length ? toolCalls : undefined, stopReason }
}

export const moonshotProvider: AIProvider = {
  id: 'moonshot',
  label: 'Moonshot (Kimi)',
  requiresKey: true,
  models: MOONSHOT_MODELS,
  
  isConfigured,
  
  supportsTools(): boolean {
    return true // Kimi supports native tool calling
  },
  
  async send(request: AIRequest, apiKey: string): Promise<AIResponse> {
    const key = cleanApiKey(apiKey)
    const model = request.model || DEFAULT_MOONSHOT_MODEL
    
    const body: Record<string, unknown> = {
      model,
      messages: toMoonshotMessages(request.systemPrompt, request.messages),
      max_tokens: request.maxTokens ?? 4096,
      stream: !!request.onToken,
    }
    
    if (request.tools?.length && this.supportsTools(model)) {
      body.tools = toMoonshotTools(request.tools)
      body.tool_choice = 'auto'
    }
    
    const response = await fetch(`${MOONSHOT_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: request.signal,
    })
    
    if (!response.ok) {
      throw new Error(await moonshotError(response))
    }
    
    if (request.onToken) {
      // Streaming response
      const streamed = await readMoonshotStream(response, request.onToken)
      return { text: streamed.text, provider: 'moonshot', model, toolCalls: streamed.toolCalls, stopReason: streamed.stopReason || 'stop' }
    }
    
    // Non-streaming response
    const data = await response.json() as {
      choices?: Array<{
        message?: {
          content?: string | null
          tool_calls?: Array<{
            id: string
            type: 'function'
            function: { name: string; arguments: string }
          }>
        }
        finish_reason?: string
      }>
      error?: { message?: string }
    }
    
    if (data.error?.message) throw new Error(data.error.message)
    
    const message = data.choices?.[0]?.message
    const rawToolCalls = message?.tool_calls ?? []
    const toolCalls: AIToolCall[] = rawToolCalls.map(tc => ({
      id: tc.id,
      name: tc.function?.name || '',
      input: (() => {
        try {
          return JSON.parse(tc.function?.arguments || '{}') as Record<string, unknown>
        } catch {
          return {}
        }
      })(),
    })).filter(tc => tc.id && tc.name)
    
    return {
      text: message?.content ?? '',
      provider: 'moonshot',
      model,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      stopReason: data.choices?.[0]?.finish_reason,
    }
  },
  
  async test(apiKey: string): Promise<void> {
    const key = cleanApiKey(apiKey)
    if (!isConfigured(key)) {
      throw new Error('Invalid Moonshot API key format. Expected sk-...')
    }
    
    // Test with a minimal completion
    const response = await fetch(`${MOONSHOT_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: DEFAULT_MOONSHOT_MODEL,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 1,
      }),
    })
    
    if (!response.ok) {
      throw new Error(await moonshotError(response))
    }
  },
}
