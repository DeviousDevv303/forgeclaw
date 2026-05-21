// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── OpenRouter Provider Adapter ────────────────────────────────────────────

import type { AIProvider, AIRequest, AIResponse, AIToolCall, AIMessage } from '../types'

// Verified against https://openrouter.ai/api/v1/models on 2026-05-21.
export const OPENROUTER_MODELS = [
  { id: 'deepseek/deepseek-v4-flash:free', label: 'DeepSeek V4 Flash', contextK: 1024, note: 'Free, large context' },
  { id: 'google/gemma-4-26b-a4b-it:free', label: 'Gemma 4 26B A4B', contextK: 262, note: 'Free' },
  { id: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B', contextK: 262, note: 'Free' },
  { id: 'qwen/qwen3-coder:free', label: 'Qwen3 Coder 480B', contextK: 1024, note: 'Free coding model' },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B', contextK: 131, note: 'Free' },
  { id: 'nousresearch/hermes-3-llama-3.1-405b:free', label: 'Hermes 3 405B', contextK: 131, note: 'Free' },
  { id: 'cognitivecomputations/dolphin-mistral-24b-venice-edition:free', label: 'Venice Uncensored 24B', contextK: 32, note: 'Free' },
  { id: 'qwen/qwen3-next-80b-a3b-instruct:free', label: 'Qwen3 Next 80B', contextK: 262, note: 'Free' },
]

export const DEFAULT_OPENROUTER_MODEL = OPENROUTER_MODELS[0].id
export type OpenRouterModelId = typeof OPENROUTER_MODELS[number]['id']

type OpenRouterToolCall = {
  id: string
  type?: 'function'
  function?: {
    name?: string
    arguments?: string
  }
}

type OpenRouterMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

type OpenRouterResponse = {
  choices?: Array<{
    message?: {
      content?: string | null
      tool_calls?: OpenRouterToolCall[]
    }
    finish_reason?: string
  }>
  error?: { message?: string }
}

type OpenRouterStreamEvent = {
  choices?: Array<{
    delta?: { content?: string }
    finish_reason?: string
  }>
  error?: { message?: string }
}

function isKnownModel(modelId: string): boolean {
  return OPENROUTER_MODELS.some(model => model.id === modelId)
}

function cleanApiKey(apiKey: string): string {
  return apiKey.trim()
}

export function resolveOpenRouterModel(modelId: string | undefined): string {
  return modelId && isKnownModel(modelId) ? modelId : DEFAULT_OPENROUTER_MODEL
}

function parseToolInput(args: string | undefined): Record<string, unknown> {
  if (!args) return {}
  try {
    const parsed = JSON.parse(args) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function toOpenRouterTools(tools: NonNullable<AIRequest['tools']>) {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }))
}

function toOpenRouterMessages(systemPrompt: string, messages: AIMessage[]): OpenRouterMessage[] {
  return [
    { role: 'system', content: systemPrompt },
    ...messages.map((message): OpenRouterMessage => {
      if (message.role === 'tool') {
        return {
          role: 'tool',
          content: message.content,
          tool_call_id: message.tool_call_id,
        }
      }

      if (message.role === 'assistant') {
        return {
          role: 'assistant',
          content: message.content || null,
          tool_calls: message.tool_calls?.map(toolCall => ({
            id: toolCall.id,
            type: 'function' as const,
            function: {
              name: toolCall.name,
              arguments: JSON.stringify(toolCall.input ?? {}),
            },
          })),
        }
      }

      return { role: 'user', content: message.content }
    }),
  ]
}

async function openRouterError(response: Response): Promise<string> {
  const raw = await response.text().catch(() => '')
  if (!raw) return `OpenRouter ${response.status}`

  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } | string; message?: string }
    const detail = typeof parsed.error === 'string'
      ? parsed.error
      : parsed.error?.message ?? parsed.message
    return detail ? `OpenRouter ${response.status}: ${detail}` : `OpenRouter ${response.status}`
  } catch {
    return `OpenRouter ${response.status}: ${raw.slice(0, 300)}`
  }
}

async function readStreamingResponse(
  response: Response,
  onToken: (token: string) => void,
): Promise<string> {
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

        const event = JSON.parse(raw) as OpenRouterStreamEvent
        if (event.error?.message) throw new Error(event.error.message)

        const token = event.choices?.[0]?.delta?.content
        if (token) {
          text += token
          onToken(token)
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  return text
}

export const openrouterProvider: AIProvider = {
  id: 'openrouter',
  label: 'OpenRouter',
  requiresKey: true,
  models: OPENROUTER_MODELS,

  isConfigured(apiKey: string): boolean {
    const key = cleanApiKey(apiKey)
    return key.startsWith('sk-or-') && key.length > 20
  },

  supportsTools(modelId: string): boolean {
    return !modelId.endsWith(':free')
  },

  async send(request: AIRequest, apiKey: string): Promise<AIResponse> {
    const key = cleanApiKey(apiKey)
    const model = resolveOpenRouterModel(request.model)
    const body: Record<string, unknown> = {
      model,
      messages: toOpenRouterMessages(request.systemPrompt, request.messages),
      max_tokens: request.maxTokens ?? 4096,
      stream: !!request.onToken,
    }

    if (request.tools?.length && this.supportsTools(model)) {
      body.tools = toOpenRouterTools(request.tools)
      body.tool_choice = 'auto'
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'HTTP-Referer': 'https://deviousdevv303.github.io/forgeclaw',
        'X-Title': 'ForgeClaw',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(await openRouterError(response))
    }

    if (request.onToken) {
      const text = await readStreamingResponse(response, request.onToken)
      return { text, provider: 'openrouter', model, stopReason: 'stop' }
    }

    const data = await response.json() as OpenRouterResponse
    if (data.error?.message) throw new Error(data.error.message)

    const message = data.choices?.[0]?.message
    const rawToolCalls = message?.tool_calls ?? []
    const toolCalls: AIToolCall[] = rawToolCalls.map(tc => ({
      id: tc.id,
      name: tc.function?.name || '',
      input: parseToolInput(tc.function?.arguments),
    })).filter(tc => tc.id && tc.name)

    return {
      text: message?.content ?? '',
      provider: 'openrouter',
      model,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      stopReason: data.choices?.[0]?.finish_reason,
    }
  },

  async test(apiKey: string): Promise<void> {
    const key = cleanApiKey(apiKey)
    if (!this.isConfigured(key)) {
      throw new Error('Invalid OpenRouter API key format. Expected sk-or-...')
    }

    const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: { Authorization: `Bearer ${key}` },
    })

    if (!response.ok) {
      throw new Error(`OpenRouter key validation failed: ${response.status}`)
    }
  },
}
