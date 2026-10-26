// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── OpenRouter Provider Adapter ────────────────────────────────────────────
// OpenAI-compatible gateway at https://openrouter.ai/api/v1; the model ID picks the upstream model
// (e.g. 'vendor/model'). Tool support depends on that upstream model. Key stays in browser localStorage.

import type { AIProvider, AIRequest, AIResponse, AIToolCall, AIMessage } from '../types'
import { keyFormatProblem, type KeyFormatRule } from '../keyFormat'

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

// OpenRouter serves hundreds of models, so any 'vendor/model' ID is accepted; these are only suggestions.
// 'openrouter/auto' is OpenRouter's router model (from memory of their docs; the overview page read on
// 2026-10-26 did not mention it), so the operator can type any ID shown at openrouter.ai/models.
export const OPENROUTER_MODELS = [
  { id: 'openrouter/auto', label: 'OpenRouter Auto', contextK: 128, note: 'OpenRouter picks the model' },
]

export const DEFAULT_OPENROUTER_MODEL = OPENROUTER_MODELS[0].id

/** Reasoning models spend reasoning tokens from max_tokens; leave room so tool arguments are not cut off. */
export const OPENROUTER_DEFAULT_MAX_TOKENS = 16384

/** A saved ID is kept if it looks like 'vendor/model'; anything else falls back to the default. */
export function resolveOpenRouterModel(stored: string | null | undefined): string {
  const id = (stored ?? '').trim()
  return /^[\w.-]+\/[\w.:-]+$/.test(id) ? id : DEFAULT_OPENROUTER_MODEL
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
export const OPENROUTER_KEY_FORMAT: KeyFormatRule = { prefix: 'sk-or-', minLength: 20 }

function isConfigured(apiKey: string): boolean {
  return keyFormatProblem(cleanApiKey(apiKey), OPENROUTER_KEY_FORMAT) === null
}

type OpenRouterMessage = { role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string; reasoning_content?: string }

export function toOpenRouterMessages(systemPrompt: string, messages: AIMessage[]): OpenRouterMessage[] {
  const result: OpenRouterMessage[] = [
    { role: 'system', content: systemPrompt },
  ]
  
  for (const msg of messages) {
    // OpenRouter rejects empty assistant messages (400). Skip messages with
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
        // reasoning_content is not echoed back: the upstream model is arbitrary and strict ones reject unknown fields.
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

async function openrouterError(response: Response): Promise<string> {
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

type OpenRouterStreamEvent = {
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

async function readOpenRouterStream(
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
    const event = JSON.parse(raw) as OpenRouterStreamEvent
    if (event.error) {
      const detail = typeof event.error === 'string' ? event.error : event.error.message
      throw new Error(detail || 'OpenRouter stream error')
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

export const openrouterProvider: AIProvider = {
  id: 'openrouter',
  label: 'OpenRouter',
  requiresKey: true,
  models: OPENROUTER_MODELS,
  
  isConfigured,
  
  supportsTools(_modelId?: string): boolean {
    void _modelId
    return true // native tool calling
  },
  
  async send(request: AIRequest, apiKey: string): Promise<AIResponse> {
    const key = cleanApiKey(apiKey)
    const model = request.model || DEFAULT_OPENROUTER_MODEL
    
    const body: Record<string, unknown> = {
      model,
      messages: toOpenRouterMessages(request.systemPrompt, request.messages),
      max_tokens: request.maxTokens ?? OPENROUTER_DEFAULT_MAX_TOKENS,
      stream: !!request.onToken,
    }
    
    if (request.tools?.length && this.supportsTools(model)) {
      body.tools = toOpenRouterTools(request.tools)
      body.tool_choice = 'auto'
    }
    
    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'X-Title': 'ForgeClaw',
      },
      body: JSON.stringify(body),
      signal: request.signal,
    })
    
    if (!response.ok) {
      throw new Error(await openrouterError(response))
    }
    
    if (request.onToken) {
      // Streaming response
      const streamed = await readOpenRouterStream(response, request.onToken)
      return { text: streamed.text, provider: 'openrouter', model, toolCalls: streamed.toolCalls, stopReason: streamed.stopReason || 'stop', reasoningContent: streamed.reasoningContent }
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
      provider: 'openrouter',
      model,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      stopReason,
      reasoningContent: message?.reasoning_content || undefined,
    }
  },
  
  async test(apiKey: string): Promise<void> {
    const key = cleanApiKey(apiKey)
    if (!isConfigured(key)) {
      throw new Error('Invalid OpenRouter key format. Expected sk-or-...')
    }
    
    // GET /key is an authenticated, token-free check (path from memory of OpenRouter's docs; not verified
    // live). /models is public and would pass any key. Model availability is not asserted here.
    const response = await fetch(`${OPENROUTER_BASE_URL}/key`, {
      headers: { Authorization: `Bearer ${key}` },
    })

    if (!response.ok) {
      throw new Error(await openrouterError(response))
    }
  },
}
