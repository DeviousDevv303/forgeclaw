// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Meta Model API Provider Adapter ─────────────────────────────────────────
// Meta's hosted API via https://api.meta.ai/v1 (docs at dev.meta.ai, checked 2026-10-24).
// The API key remains in browser localStorage, matching ForgeClaw's existing provider-key model.
//
// ENDPOINT DECISION (docs ambiguity, recorded honestly): the Chat Completions guide's worked
// examples use Muse Spark and its text describes Chat Completions as serving Spark text models,
// while the Models / Choosing-an-endpoint pages state that all endpoints run the same models and
// switching endpoints is just a model-ID change; the only worked Muse Wonder example uses the
// Responses endpoint. ForgeClaw's provider interface is OpenAI-chat-shaped (system prompt +
// message list in, text + tool calls out), so this adapter implements Chat Completions with
// model muse-wonder-1.0, on the Choosing pages' basis. The owner's first real call with his
// key is the confirming test: if Meta rejects Wonder on this endpoint, the error surfaces
// verbatim below and the adapter moves to /responses — it never silently falls back.

import type { AIProvider, AIRequest, AIResponse, AIToolCall, AIMessage } from '../types'
import { keyFormatProblem, type KeyFormatRule } from '../keyFormat'

export const META_BASE_URL = 'https://api.meta.ai/v1'
/** The endpoint this adapter posts to (see the endpoint decision note above). */
export const META_CHAT_COMPLETIONS_URL = `${META_BASE_URL}/chat/completions`

// Model IDs per Meta's docs (dev.meta.ai, checked 2026-10-24). Muse Wonder is the flagship
// reasoning model; context 1,048,576 tokens. Standard mode.
export const META_MODELS = [
  { id: 'muse-wonder-1.0', label: 'Muse Wonder', contextK: 1024, note: 'Meta flagship reasoning model' },
]

export const DEFAULT_META_MODEL = META_MODELS[0].id

/**
 * Wonder is a reasoning model and reasoning tokens count toward max_tokens (the same trap
 * Moonshot documents for Kimi): at a small budget the reasoning can eat the whole allowance
 * and leave an empty answer or a tool call cut off mid-arguments, so the default matches the
 * other hosted reasoning providers.
 */
export const META_DEFAULT_MAX_TOKENS = 16384

/** A saved model ID that is not in the current list (e.g. a retired one) falls back to the default. */
export function resolveMetaModel(stored: string | null | undefined): string {
  return META_MODELS.some(m => m.id === stored) ? (stored as string) : DEFAULT_META_MODEL
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

/**
 * The key format send() enforces; the Diagnostics panel words its reason from the same rule (keyFormat.ts).
 * The LLM_ prefix is per Meta's docs (keys are created at dev.meta.ai, API keys tab); the length floor is the
 * same sanity floor the other hosted providers use, so a bare "LLM_" paste cannot pass as a key.
 */
export const META_KEY_FORMAT: KeyFormatRule = { prefix: 'LLM_', minLength: 21 }

function isConfigured(apiKey: string): boolean {
  return keyFormatProblem(cleanApiKey(apiKey), META_KEY_FORMAT) === null
}

function missingKeyError(): Error {
  return new Error('Meta Model API key missing — add your Meta Model API key in Settings (Meta keys start with LLM_ and are created at dev.meta.ai, API keys tab).')
}

function badKeyFormatError(): Error {
  return new Error('Invalid Meta Model API key format. Expected a key starting with LLM_ — check the Meta Model API key in Settings.')
}

type MetaMessage = { role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string; reasoning_content?: string }

export function toMetaMessages(systemPrompt: string, messages: AIMessage[]): MetaMessage[] {
  const result: MetaMessage[] = [
    { role: 'system', content: systemPrompt },
  ]

  for (const msg of messages) {
    // The chat API rejects empty assistant messages (the OpenAI-compatible shape Moonshot
    // documents). Skip messages with no content and no tool calls — these come from
    // failed/empty responses.
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
        // Pass a prior turn's reasoning back if the API returned it, as the other hosted
        // reasoning provider's loop requires; harmless when the API ignores the field.
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
      // Text only: the verified doc facts for Wonder on Chat Completions do not cover vision
      // input parts, so a picture is never silently dressed up as a format the API may reject.
      result.push({
        role: msg.role,
        content: msg.content,
      })
    }
  }

  return result
}

function toMetaTools(tools: NonNullable<AIRequest['tools']>) {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }))
}

async function metaError(response: Response): Promise<string> {
  const raw = await response.text().catch(() => '')
  if (!raw) return `Meta ${response.status}`

  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } | string; message?: string }
    const detail = typeof parsed.error === 'string'
      ? parsed.error
      : parsed.error?.message ?? parsed.message
    return detail ? `Meta ${response.status}: ${detail}` : `Meta ${response.status}`
  } catch {
    return `Meta ${response.status}: ${raw.slice(0, 300)}`
  }
}

type MetaStreamEvent = {
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

async function readMetaStream(
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
    const event = JSON.parse(raw) as MetaStreamEvent
    if (event.error) {
      const detail = typeof event.error === 'string' ? event.error : event.error.message
      throw new Error(detail || 'Meta stream error')
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

export const metaProvider: AIProvider = {
  id: 'muse',
  label: 'Muse · Meta',
  requiresKey: true,
  models: META_MODELS,

  isConfigured,

  supportsTools(): boolean {
    return true // Chat Completions carries native function calling, tool roles included (dev.meta.ai).
  },

  async send(request: AIRequest, apiKey: string): Promise<AIResponse> {
    const key = cleanApiKey(apiKey)
    if (!key) throw missingKeyError()
    if (!isConfigured(key)) throw badKeyFormatError()
    const model = request.model || DEFAULT_META_MODEL

    const body: Record<string, unknown> = {
      model,
      messages: toMetaMessages(request.systemPrompt, request.messages),
      max_tokens: request.maxTokens ?? META_DEFAULT_MAX_TOKENS,
      stream: !!request.onToken,
    }

    if (request.tools?.length && this.supportsTools(model)) {
      body.tools = toMetaTools(request.tools)
      body.tool_choice = 'auto'
    }

    const response = await fetch(META_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: request.signal,
    })

    if (!response.ok) {
      throw new Error(await metaError(response))
    }

    if (request.onToken) {
      // Streaming response
      const streamed = await readMetaStream(response, request.onToken)
      return { text: streamed.text, provider: 'muse', model, toolCalls: streamed.toolCalls, stopReason: streamed.stopReason || 'stop', reasoningContent: streamed.reasoningContent }
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
      provider: 'muse',
      model,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      stopReason,
      reasoningContent: message?.reasoning_content || undefined,
    }
  },

  async test(apiKey: string): Promise<void> {
    const key = cleanApiKey(apiKey)
    if (!key) throw missingKeyError()
    if (!isConfigured(key)) throw badKeyFormatError()

    // The verified doc facts list the Chat Completions and Responses endpoints, not a /models
    // probe, so the key test exercises the documented endpoint with the real model at a
    // negligible token budget — the same shape Anthropic's key test uses.
    const response = await fetch(META_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: DEFAULT_META_MODEL,
        max_tokens: 32,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    })

    if (!response.ok) {
      throw new Error(await metaError(response))
    }
  },
}
