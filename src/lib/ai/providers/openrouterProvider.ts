// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── OpenRouter Provider Adapter ────────────────────────────────────────────
// One key, hundreds of models: OpenRouter's OpenAI-compatible API at https://openrouter.ai/api/v1
// (docs checked 2026-10-26). The owner asked for it back in the UI on 2026-10-26 ("Open router never
// made it to the UI as a provider need that please"); the earlier adapter was removed on 2026-09-21
// (ab07138). The key stays in browser localStorage, like every other provider key here.
//
// Checked against the live API on 2026-10-26: the chat endpoint answers browser calls (CORS allows any
// origin, and the Authorization header passes the preflight), GET /key checks a key without spending
// anything, and GET /models lists every model with the parameters it supports, no key needed.
// No attribution headers (HTTP-Referer, X-OpenRouter-Title) are sent: they list the app on OpenRouter's
// public rankings, which is the owner's call to make, not a default.

import { isSendableImage } from '../../imageInput'
import type { AIProvider, AIRequest, AIResponse, AIToolCall, AIMessage } from '../types'
import { keyFormatProblem, type KeyFormatRule } from '../keyFormat'

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
export const OPENROUTER_CHAT_URL = `${OPENROUTER_BASE_URL}/chat/completions`

// A starting list, checked against GET /models on 2026-10-26: every one supports tool calling. Prices are
// per million tokens on that date and change; the Settings list loads the live catalogue with current prices.
export const OPENROUTER_MODELS = [
  { id: 'anthropic/claude-haiku-5.5', label: 'Claude Haiku 5.5', contextK: 1000, note: 'Low cost: $0.10 in / $0.50 out' },
  { id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', contextK: 1048, note: 'Low cost: $0.02 in / $1.00 out' },
  { id: 'moonshotai/kimi-k3', label: 'Kimi K3', contextK: 1048, note: '$0.15 in / $20.00 out' },
  { id: 'anthropic/claude-sonnet-5.5', label: 'Claude Sonnet 5.5', contextK: 1000, note: '$2.00 in / $10.00 out' },
  { id: 'openai/gpt-6.1-sol', label: 'GPT-6.1 Sol', contextK: 1050, note: '$2.00 in / $10.00 out' },
  { id: 'google/gemini-4-argon', label: 'Gemini 4 Argon', contextK: 1048, note: '$2.00 in / $10.00 out' },
  { id: 'openrouter/free', label: 'Free router', contextK: 200, note: 'Free: a different free model may answer each request' },
  { id: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B (free)', contextK: 262, note: 'Free' },
]

export const DEFAULT_OPENROUTER_MODEL = OPENROUTER_MODELS[0].id

/** An OpenRouter model ID: `vendor/model`, optionally with a `:variant` such as `:free`. */
const MODEL_ID_RE = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i

export function isOpenRouterModelId(id: string): boolean {
  return id.length <= 120 && MODEL_ID_RE.test(id)
}

/** OpenRouter carries far more models than any list here, so any well-formed ID is kept; anything else falls back to the default. */
export function resolveOpenRouterModel(stored: string | null | undefined): string {
  const id = (stored ?? '').trim()
  return isOpenRouterModelId(id) ? id : DEFAULT_OPENROUTER_MODEL
}

/** Reasoning models count reasoning toward max_tokens, the same trap the other hosted providers guard against. */
export const OPENROUTER_DEFAULT_MAX_TOKENS = 16384

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

/** The key format send() enforces; the Diagnostics panel words its reason from the same rule (keyFormat.ts). OpenRouter keys start sk-or-. */
export const OPENROUTER_KEY_FORMAT: KeyFormatRule = { prefix: 'sk-or-', minLength: 21 }

function isConfigured(apiKey: string): boolean {
  return keyFormatProblem(cleanApiKey(apiKey), OPENROUTER_KEY_FORMAT) === null
}

function missingKeyError(): Error {
  return new Error('OpenRouter API key missing — create one at openrouter.ai/keys and paste it in Settings (sk-or-...).')
}

function badKeyFormatError(): Error {
  return new Error('Invalid OpenRouter API key format. Expected a key starting with sk-or- (openrouter.ai/keys).')
}

type ReasoningDetail = Record<string, unknown>
type OpenRouterContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
type OpenRouterMessage = {
  role: string
  content: string | OpenRouterContentPart[]
  tool_calls?: unknown[]
  tool_call_id?: string
  reasoning?: string
  reasoning_details?: ReasoningDetail[]
}

export function toOpenRouterMessages(systemPrompt: string, messages: AIMessage[]): OpenRouterMessage[] {
  const result: OpenRouterMessage[] = [{ role: 'system', content: systemPrompt }]
  for (const msg of messages) {
    // Skip messages with no content and no tool calls (failed or empty turns); several providers reject them.
    const hasContent = msg.content && msg.content.trim().length > 0
    const hasToolCalls = msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0
    if (!hasContent && !hasToolCalls) continue
    if (msg.role === 'tool') {
      result.push({ role: 'tool', content: msg.content, tool_call_id: msg.tool_call_id || '' })
    } else if (msg.role === 'assistant' && msg.tool_calls) {
      result.push({
        role: 'assistant',
        content: msg.content || '',
        // OpenRouter: a model paused for a tool result needs its reasoning back. The blocks as returned (signatures and
        // encrypted parts included) when there are any; otherwise the plain text, which OpenRouter also accepts.
        ...(msg.reasoning_details?.length ? { reasoning_details: msg.reasoning_details as ReasoningDetail[] }
          : msg.reasoning_content ? { reasoning: msg.reasoning_content } : {}),
        tool_calls: msg.tool_calls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.input || {}) },
        })),
      })
    } else if (msg.role === 'user' && isSendableImage(msg.image_url)) {
      // OpenAI-style image part; OpenRouter routes it to a vision-capable endpoint or says it cannot.
      result.push({ role: 'user', content: [{ type: 'image_url', image_url: { url: msg.image_url } }, { type: 'text', text: msg.content }] })
    } else {
      result.push({ role: msg.role, content: msg.content })
    }
  }
  return result
}

function toOpenRouterTools(tools: NonNullable<AIRequest['tools']>) {
  return tools.map(t => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.parameters } }))
}

async function openRouterError(response: Response): Promise<string> {
  const raw = await response.text().catch(() => '')
  let detail = ''
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } | string; message?: string }
    detail = (typeof parsed.error === 'string' ? parsed.error : parsed.error?.message ?? parsed.message) || ''
  } catch {
    detail = raw.slice(0, 300)
  }
  // What the owner can do about it, for the statuses OpenRouter documents.
  const hint = response.status === 402 ? ' (no credits left: add credits at openrouter.ai/credits, or pick a free model)'
    : /no endpoints found that support tool use/i.test(detail) ? ' (this model cannot call tools; pick one marked for tools in Settings)'
    : ''
  return `OpenRouter ${response.status}${detail ? `: ${detail}` : ''}${hint}`
}

/**
 * Streamed reasoning blocks, put back together. OpenRouter: "The complete reasoning sequence is built by concatenating
 * all chunks in order." Consecutive chunks of the same block (same type and index) are joined into that block, so the
 * next request gets whole blocks, in their original order, the shape a non-streamed response carries.
 */
export function mergeReasoningDetails(chunks: ReasoningDetail[]): ReasoningDetail[] {
  const merged: ReasoningDetail[] = []
  for (const chunk of chunks) {
    const last = merged[merged.length - 1]
    if (last && last.type === chunk.type && last.index === chunk.index) {
      for (const field of ['text', 'summary', 'data']) {
        if (typeof chunk[field] === 'string') last[field] = `${typeof last[field] === 'string' ? last[field] : ''}${chunk[field]}`
      }
      for (const [field, value] of Object.entries(chunk)) if (!['text', 'summary', 'data'].includes(field) && value !== null && value !== undefined) last[field] = value
    } else {
      merged.push({ ...chunk })
    }
  }
  return merged
}

type OpenRouterStreamEvent = {
  choices?: Array<{
    delta?: {
      content?: string | null
      reasoning?: string | null
      reasoning_content?: string | null
      reasoning_details?: ReasoningDetail[]
      tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>
    }
    finish_reason?: string | null
  }>
  error?: { message?: string } | string
}

interface Collected { text: string; toolCalls?: AIToolCall[]; stopReason?: string; reasoningContent?: string; reasoningDetails?: ReasoningDetail[] }

async function readOpenRouterStream(response: Response, onToken: (token: string) => void): Promise<Collected> {
  const reader = response.body?.getReader()
  if (!reader) return { text: '' }
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let reasoning = ''
  const details: ReasoningDetail[] = []
  const streamedCalls = new Map<number, { id: string; name: string; arguments: string }>()
  let stopReason: string | undefined

  const consumeLine = (line: string) => {
    // Only data lines carry events; SSE comment lines (keep-alives) are skipped.
    if (!line.startsWith('data: ')) return
    const raw = line.slice(6).trim()
    if (!raw || raw === '[DONE]') return
    const event = JSON.parse(raw) as OpenRouterStreamEvent
    if (event.error) {
      const detail = typeof event.error === 'string' ? event.error : event.error.message
      throw new Error(`OpenRouter stream error: ${detail || 'unknown'}`)
    }
    const choice = event.choices?.[0]
    const delta = choice?.delta
    if (choice?.finish_reason) stopReason = choice.finish_reason
    // Reasoning is kept for the next request, never streamed into the visible answer.
    const thought = delta?.reasoning ?? delta?.reasoning_content
    if (thought) reasoning += thought
    if (Array.isArray(delta?.reasoning_details)) details.push(...delta.reasoning_details)
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
  return {
    text, toolCalls: toolCalls.length ? toolCalls : undefined, stopReason, reasoningContent: reasoning || undefined,
    reasoningDetails: details.length ? mergeReasoningDetails(details) : undefined,
  }
}

const usd = (perToken: string | undefined): number | null => {
  const n = Number(perToken)
  return Number.isFinite(n) ? n * 1_000_000 : null
}

/** A catalogue entry as Settings shows it: what it costs per million tokens, or that the price follows the routed model. */
function priceNote(pricing: { prompt?: string; completion?: string } | undefined): string {
  const input = usd(pricing?.prompt), output = usd(pricing?.completion)
  if (input === null || output === null || input < 0 || output < 0) return 'price follows the model it routes to'
  if (input === 0 && output === 0) return 'Free'
  return `$${input.toFixed(2)} in / $${output.toFixed(2)} out`
}

/**
 * The live catalogue: every model that supports tool calling (ForgeClaw's tools need it), with its current price.
 * GET /models needs no key and costs nothing. Throws on any failure; the caller keeps the starting list.
 */
export async function fetchOpenRouterModels(signal?: AbortSignal): Promise<Array<{ id: string; label: string; contextK: number; note: string }>> {
  const response = await fetch(`${OPENROUTER_BASE_URL}/models`, { signal })
  if (!response.ok) throw new Error(await openRouterError(response))
  const data = await response.json() as { data?: Array<{ id?: string; name?: string; context_length?: number; supported_parameters?: string[]; pricing?: { prompt?: string; completion?: string } }> }
  return (data.data ?? [])
    .filter(m => typeof m.id === 'string' && isOpenRouterModelId(m.id) && (m.supported_parameters ?? []).includes('tools'))
    .map(m => ({ id: m.id as string, label: m.name || (m.id as string), contextK: Math.round((m.context_length ?? 0) / 1000), note: priceNote(m.pricing) }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

export const openrouterProvider: AIProvider = {
  id: 'openrouter',
  label: 'OpenRouter',
  requiresKey: true,
  models: OPENROUTER_MODELS,

  isConfigured,

  supportsTools(): boolean {
    // Tools are sent for every model: OpenRouter routes only to endpoints that support them, and a model with none
    // answers with an error that names the problem (see openRouterError) rather than ignoring the tools.
    return true
  },

  async send(request: AIRequest, apiKey: string): Promise<AIResponse> {
    const key = cleanApiKey(apiKey)
    if (!key) throw missingKeyError()
    if (!isConfigured(key)) throw badKeyFormatError()
    // A typo in the model field is named, never swapped for the default behind the owner's back.
    const model = (request.model || DEFAULT_OPENROUTER_MODEL).trim()
    if (!isOpenRouterModelId(model)) throw new Error(`"${model.slice(0, 80)}" is not an OpenRouter model ID (vendor/model, e.g. ${DEFAULT_OPENROUTER_MODEL}): fix it in Settings.`)

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

    const response = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: request.signal,
    })
    if (!response.ok) throw new Error(await openRouterError(response))

    if (request.onToken) {
      const streamed = await readOpenRouterStream(response, request.onToken)
      return { ...streamed, provider: 'openrouter', model, stopReason: streamed.stopReason || 'stop' }
    }

    const data = await response.json() as {
      model?: string
      choices?: Array<{
        message?: {
          content?: string | null
          reasoning?: string | null
          reasoning_content?: string | null
          reasoning_details?: ReasoningDetail[]
          tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
        }
        finish_reason?: string
      }>
      error?: { message?: string }
    }
    if (data.error?.message) throw new Error(`OpenRouter: ${data.error.message}`)

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
      reasoningContent: message?.reasoning || message?.reasoning_content || undefined,
      reasoningDetails: message?.reasoning_details?.length ? message.reasoning_details : undefined,
    }
  },

  async test(apiKey: string): Promise<void> {
    const key = cleanApiKey(apiKey)
    if (!key) throw missingKeyError()
    if (!isConfigured(key)) throw badKeyFormatError()
    // GET /key checks the key and reads its limits without spending a token.
    const response = await fetch(`${OPENROUTER_BASE_URL}/key`, { headers: { Authorization: `Bearer ${key}` } })
    if (!response.ok) throw new Error(await openRouterError(response))
    const data = await response.json().catch(() => null) as { data?: { limit_remaining?: number | null } } | null
    const remaining = data?.data?.limit_remaining
    if (typeof remaining === 'number' && remaining <= 0) {
      throw new Error('OpenRouter key works, but its credit limit is used up: raise the limit at openrouter.ai/keys, add credits, or pick a free model.')
    }
  },
}
