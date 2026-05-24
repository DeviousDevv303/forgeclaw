// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── OpenRouter Provider Adapter ────────────────────────────────────────────

import type { AIProvider, AIRequest, AIResponse, AIToolCall, AIMessage } from '../types'

// Updated May 2026 - including high-utility free and monetization-ready models.
export const OPENROUTER_MODELS = [
  { id: 'poolside/laguna-xs.2:free', label: 'Laguna XS.2', contextK: 131, note: 'Free, fast streaming' },
  { id: 'deepseek/deepseek-v4-flash:free', label: 'DeepSeek V4 Flash', contextK: 1024, note: 'Free, large context' },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B', contextK: 131, note: 'Free, tool-capable' },
  { id: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B', contextK: 262, note: 'Free, high quality' },
  { id: 'qwen/qwen3-coder:free', label: 'Qwen3 Coder 480B', contextK: 1024, note: 'Free, expert coding' },
  { id: 'liquid/lfm-2.5-1.2b-thinking:free', label: 'Liquid LFM2.5 Thinking', contextK: 32, note: 'Free, reasoning model' },
  { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', label: 'Nemotron 3 Nano Reasoning', contextK: 256, note: 'Free, multimodal reasoning' },
  { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B (Paid)', contextK: 131, note: 'Reliable, tool-capable' },
  { id: 'anthropic/claude-4-sonnet', label: 'Claude 4 Sonnet', contextK: 200, note: 'Premium, best for complex tasks' },
  { id: 'openai/gpt-5-omni', label: 'GPT-5 Omni', contextK: 128, note: 'Premium, fast and capable' },
  { id: 'deepseek/deepseek-v4', label: 'DeepSeek V4 (Paid)', contextK: 1024, note: 'High performance' },
]

export const DEFAULT_OPENROUTER_MODEL = OPENROUTER_MODELS[0].id
export type OpenRouterModelId = typeof OPENROUTER_MODELS[number]['id']

// ─── XML fallback: some free-tier models emit raw <toolcall> in content ─────
function parseXmlToolCalls(content: string): AIToolCall[] {
  const calls: AIToolCall[] = []
  const pattern = /<<toolcall(\w+)\s*([^>]*)>>/g
  let match
  while ((match = pattern.exec(content)) !== null) {
    const name = match[1]
    const rawArgs = match[2]
    const args: Record<string, unknown> = {}
    // Parse argkey/argvalue pairs
    const argPattern = /<<argkey(\w+)>><<argvalue([^>]*)>>/g
    let argMatch
    while ((argMatch = argPattern.exec(rawArgs)) !== null) {
      const key = argMatch[1]
      const value = argMatch[2].trim()
      // Try JSON parse, fall back to string
      try { args[key] = JSON.parse(value) } catch { args[key] = value }
    }
    calls.push({ id: `xml-${Date.now()}-${calls.length}`, name, input: args })
  }
  return calls
}

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
  error?: { message?: string; code?: number; metadata?: any }
}

type OpenRouterStreamEvent = {
  choices?: Array<{
    delta?: { content?: string; tool_calls?: OpenRouterToolCall[] }
    finish_reason?: string
  }>
  error?: { message?: string; code?: number }
}

function isKnownModel(modelId: string): boolean {
  return OPENROUTER_MODELS.some(model => model.id === modelId)
}

function cleanApiKey(apiKey: string): string {
  return apiKey.trim()
}

export function resolveOpenRouterModel(modelId: string | undefined): string {
  // Allow unknown models if they look like OpenRouter model IDs (provider/name)
  if (modelId && modelId.includes('/')) return modelId
  return modelId && isKnownModel(modelId) ? modelId : DEFAULT_OPENROUTER_MODEL
}

// Models verified to support native tool calling on OpenRouter.
const TOOL_CAPABLE_OPENROUTER_MODELS = new Set<string>([
  'meta-llama/llama-3.3-70b-instruct:free',
  'meta-llama/llama-3.3-70b-instruct',
  'meta-llama/llama-3.2-3b-instruct:free',
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
  'anthropic/claude-4-sonnet',
  'openai/gpt-5-omni',
  'deepseek/deepseek-v4',
  'deepseek/deepseek-v4-flash:free',
])

function supportsNativeToolUse(modelId: string): boolean {
  return TOOL_CAPABLE_OPENROUTER_MODELS.has(resolveOpenRouterModel(modelId))
}

function isToolUseUnsupportedError(message: string): boolean {
  return /no endpoints found that support tool use|support tool use|tool use/i.test(message)
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

        try {
          const event = JSON.parse(raw) as OpenRouterStreamEvent
          if (event.error?.message) throw new Error(event.error.message)

          const token = event.choices?.[0]?.delta?.content
          if (token) {
            text += token
            onToken(token)
          }
        } catch (e) {
          console.warn('Failed to parse OpenRouter stream event:', e, raw)
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
    return supportsNativeToolUse(modelId)
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

    let response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
      const message = await openRouterError(response)
      if (body.tools && isToolUseUnsupportedError(message)) {
        const retryBody = { ...body }
        delete retryBody.tools
        delete retryBody.tool_choice

        response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
            'HTTP-Referer': 'https://deviousdevv303.github.io/forgeclaw',
            'X-Title': 'ForgeClaw',
          },
          body: JSON.stringify(retryBody),
        })

        if (!response.ok) {
          throw new Error(await openRouterError(response))
        }
      } else {
        throw new Error(message)
      }
    }

    if (request.onToken) {
      const text = await readStreamingResponse(response, request.onToken)
      return { text, provider: 'openrouter', model, stopReason: 'stop' }
    }

    const data = await response.json() as OpenRouterResponse
    if (data.error?.message) throw new Error(data.error.message)

    const message = data.choices?.[0]?.message
    const rawToolCalls = message?.tool_calls ?? []
    let toolCalls: AIToolCall[] = rawToolCalls.map(tc => ({
      id: tc.id,
      name: tc.function?.name || '',
      input: parseToolInput(tc.function?.arguments),
    })).filter(tc => tc.id && tc.name)

    // Fallback: if API returned no tool_calls but content has XML toolcalls, parse them
    if (toolCalls.length === 0 && message?.content) {
      const xmlCalls = parseXmlToolCalls(message.content)
      if (xmlCalls.length > 0) {
        toolCalls = xmlCalls
      }
    }

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
