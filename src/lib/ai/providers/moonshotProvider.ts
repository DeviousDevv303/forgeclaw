// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Moonshot (Kimi) Provider Adapter ───────────────────────────────────────
// OpenAI-compatible API via https://api.moonshot.cn/v1
// Supports native tool calling.
// PROD NOTE: When hosted with ForgeMind engine, calls route through /api/moonshot
// to keep the API key server-side. See engine/server.ts.

import type { AIProvider, AIRequest, AIResponse, AIToolCall, AIMessage } from '../types'

const isDev = import.meta.env.DEV;
const MOONSHOT_BASE_URL = isDev
  ? 'https://api.moonshot.cn/v1'
  : '/api/moonshot/v1';

export const MOONSHOT_MODELS = [
  { id: 'moonshot-v1-8k', label: 'Kimi 8K', contextK: 8, note: 'Fast, lightweight' },
  { id: 'moonshot-v1-32k', label: 'Kimi 32K', contextK: 32, note: 'Balanced' },
  { id: 'moonshot-v1-128k', label: 'Kimi 128K', contextK: 128, note: 'Large context' },
  { id: 'moonshot-v1-auto', label: 'Kimi Auto', contextK: 128, note: 'Auto context sizing' },
]

export const DEFAULT_MOONSHOT_MODEL = MOONSHOT_MODELS[1].id // 32K default

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
    })
    
    if (!response.ok) {
      throw new Error(await moonshotError(response))
    }
    
    if (request.onToken) {
      // Streaming response
      const reader = response.body?.getReader()
      if (!reader) return { text: '', provider: 'moonshot', model, stopReason: 'stop' }
      
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
            
            try {
              const event = JSON.parse(raw) as { choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>; error?: { message?: string } }
              if (event.error?.message) throw new Error(event.error.message)
              
              const token = event.choices?.[0]?.delta?.content
              if (token) {
                text += token
                request.onToken?.(token)
              }
            } catch (e) {
              console.warn('Failed to parse Moonshot stream event:', e, raw)
            }
          }
        }
      } finally {
        reader.releaseLock()
      }
      
      return { text, provider: 'moonshot', model, stopReason: 'stop' }
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
