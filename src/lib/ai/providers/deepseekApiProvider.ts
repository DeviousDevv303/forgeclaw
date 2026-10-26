// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── DeepSeek API Provider Adapter (direct api.deepseek.com; NOT the Actions-hosted "deepseek" route) ───────────────────────────────────────
// OpenAI-compatible API via https://api.deepseek.com. Supports native tool calling.
// The key is stored in browser localStorage (static hosting), so calls go direct.

import type { AIProvider, AIRequest, AIResponse, AIToolCall, AIMessage } from '../types'
import { keyFormatProblem, type KeyFormatRule } from '../keyFormat'

const DEEPSEEK_API_BASE_URL = 'https://api.deepseek.com'

// Model IDs from DeepSeek's docs (api-docs.deepseek.com, read 2026-10-26). Context sizes are not stated
// there, so contextK is a conservative placeholder until verified. Legacy deepseek-v4-flash IDs still
// resolve server-side but are retired, so they are not offered.
export const DEEPSEEK_API_MODELS = [
  { id: 'deepseek-flash', label: 'DeepSeek Flash', contextK: 128, note: 'Fast, low cost' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', contextK: 128, note: 'Flagship' },
]

export const DEFAULT_DEEPSEEK_API_MODEL = DEEPSEEK_API_MODELS[0].id

/** Thinking-capable models spend reasoning tokens from max_tokens; leave room so tool arguments are not cut off. */
export const DEEPSEEK_API_DEFAULT_MAX_TOKENS = 16384

/** A saved model ID that is not in the current list (e.g. a retired one) falls back to the default. */
export function resolveDeepSeekApiModel(stored: string | null | undefined): string {
  return DEEPSEEK_API_MODELS.some(m => m.id === stored) ? (stored as string) : DEFAULT_DEEPSEEK_API_MODEL
}

/** finish_reason values meaning the output limit cut the response off. */
const TRUNCATED_FINISH_REASONS = new Set(['length', 'max_tokens'])

function parseToolArguments(raw: string, truncated: boolean): { input: Record<string, unknown>; parseError?: string } {
  if (truncated) return { input: {}, parseError: 'the response hit the output token limit before the tool arguments were complete' }
  try {
    const parsed = JSON.parse(raw || '{}') as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { input: parsed as Record<string, unknown> }
    return { input: {}, parseError: 'tool arguments were not a JSON object' }
  } catch {
    return { input: {}, parseError: `tool arguments were not valid JSON (${raw.length} chars)` }
  }
}

function cleanApiKey(apiKey: string): string {
  return apiKey.trim()
}

/** The key format send() enforces; the Diagnostics panel words its reason from the same rule (keyFormat.ts). */
export const DEEPSEEK_API_KEY_FORMAT: KeyFormatRule = { prefix: 'sk-', minLength: 21 }

function isConfigured(apiKey: string): boolean {
  return keyFormatProblem(cleanApiKey(apiKey), DEEPSEEK_API_KEY_FORMAT) === null
}

type DeepSeekApiMessage = { role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string; reasoning_content?: string }

export function toDeepSeekApiMessages(systemPrompt: string, messages: AIMessage[]): DeepSeekApiMessage[] {
  const result: DeepSeekApiMessage[] = [
    { role: 'system', content: systemPrompt },
  ]
  
  for (const msg of messages) {
    // DeepSeek API rejects empty assistant messages (400). Skip messages with
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
        // DeepSeek API: pass the assistant message back as returned, reasoning included, in tool-call loops.
        ...(msg.reasoning_content ? { reasoning_content: msg.reasoning_content } : {}),
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

function toDeepSeekApiTools(tools: NonNullable<AIRequest['tools']>) {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }))
}

async function deepseekApiError(response: Response): Promise<string> {
  const raw = await response.text().catch(() => '')
  if (!raw) return `DeepSeek API ${response.status}`
  
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } | string; message?: string }
    const detail = typeof parsed.error === 'string'
      ? parsed.error
      : parsed.error?.message ?? parsed.message
    return detail ? `DeepSeek API ${response.status}: ${detail}` : `DeepSeek API ${response.status}`
  } catch {
    return `DeepSeek API ${response.status}: ${raw.slice(0, 300)}`
  }
}

type DeepSeekApiStreamEvent = {
  choices?: Array<{
    delta?: {
      content?: string | null
      reasoning_content?: string | null
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

async function readDeepSeekApiStream(
  response: Response,
  onToken: (token: string) => void,
): Promise<{ text: string; toolCalls?: AIToolCall[]; stopReason?: string; reasoningContent?: string }> {
  const reader = response.body?.getReader()
  if (!reader) return { text: '' }

  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let reasoning = ''
  const streamedCalls = new Map<number, { id: string; name: string; arguments: string }>()
  let stopReason: string | undefined

  const consumeLine = (line: string) => {
    if (!line.startsWith('data: ')) return
    const raw = line.slice(6).trim()
    if (!raw || raw === '[DONE]') return
    const event = JSON.parse(raw) as DeepSeekApiStreamEvent
    if (event.error) {
      const detail = typeof event.error === 'string' ? event.error : event.error.message
      throw new Error(detail || 'DeepSeek API stream error')
    }
    const choice = event.choices?.[0]
    const delta = choice?.delta
    if (choice?.finish_reason) stopReason = choice.finish_reason
    // Reasoning is kept for the next request, never streamed into the visible answer.
    if (delta?.reasoning_content) reasoning += delta.reasoning_content
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

  const truncated = TRUNCATED_FINISH_REASONS.has(stopReason ?? '')
  const toolCalls: AIToolCall[] = [...streamedCalls.values()]
    .filter(call => call.id && call.name)
    .map(call => ({ id: call.id, name: call.name, ...parseToolArguments(call.arguments, truncated) }))

  return { text, toolCalls: toolCalls.length ? toolCalls : undefined, stopReason, reasoningContent: reasoning || undefined }
}

export const deepseekApiProvider: AIProvider = {
  id: 'deepseekapi',
  label: 'DeepSeek API',
  requiresKey: true,
  models: DEEPSEEK_API_MODELS,
  
  isConfigured,
  
  supportsTools(_modelId?: string): boolean {
    void _modelId
    return true // native tool calling
  },
  
  async send(request: AIRequest, apiKey: string): Promise<AIResponse> {
    const key = cleanApiKey(apiKey)
    const model = request.model || DEFAULT_DEEPSEEK_API_MODEL
    
    const body: Record<string, unknown> = {
      model,
      messages: toDeepSeekApiMessages(request.systemPrompt, request.messages),
      max_tokens: request.maxTokens ?? DEEPSEEK_API_DEFAULT_MAX_TOKENS,
      stream: !!request.onToken,
    }
    
    if (request.tools?.length && this.supportsTools(model)) {
      body.tools = toDeepSeekApiTools(request.tools)
      body.tool_choice = 'auto'
    }
    
    const response = await fetch(`${DEEPSEEK_API_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: request.signal,
    })
    
    if (!response.ok) {
      throw new Error(await deepseekApiError(response))
    }
    
    if (request.onToken) {
      // Streaming response
      const streamed = await readDeepSeekApiStream(response, request.onToken)
      return { text: streamed.text, provider: 'deepseekapi', model, toolCalls: streamed.toolCalls, stopReason: streamed.stopReason || 'stop', reasoningContent: streamed.reasoningContent }
    }
    
    // Non-streaming response
    const data = await response.json() as {
      choices?: Array<{
        message?: {
          content?: string | null
          reasoning_content?: string | null
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
    const stopReason = data.choices?.[0]?.finish_reason
    const truncated = TRUNCATED_FINISH_REASONS.has(stopReason ?? '')
    const toolCalls: AIToolCall[] = (message?.tool_calls ?? [])
      .filter(tc => tc.id && tc.function?.name)
      .map(tc => ({ id: tc.id, name: tc.function.name, ...parseToolArguments(tc.function.arguments, truncated) }))

    return {
      text: message?.content ?? '',
      provider: 'deepseekapi',
      model,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      stopReason,
      reasoningContent: message?.reasoning_content || undefined,
    }
  },
  
  async test(apiKey: string): Promise<void> {
    const key = cleanApiKey(apiKey)
    if (!isConfigured(key)) {
      throw new Error('Invalid DeepSeek API key format. Expected sk-...')
    }
    
    // GET /models checks the key without spending tokens. Model availability is not asserted here: the
    // listed IDs are unverified against this key, and a wrong hard failure would block a working key.
    const response = await fetch(`${DEEPSEEK_API_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${key}` },
    })

    if (!response.ok) {
      throw new Error(await deepseekApiError(response))
    }
  },
}
