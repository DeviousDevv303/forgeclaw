// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Moonshot (Kimi) Provider Adapter ───────────────────────────────────────
// OpenAI-compatible API via https://api.moonshot.ai/v1
// Supports native tool calling.
// PROD NOTE: When hosted with ForgeMind engine, calls can route through /api/moonshot
// to keep the API key server-side. See engine/server.ts.
// For GitHub Pages (static hosting, no backend), always use the direct API URL
// since the key is stored in browser localStorage anyway.

import { isSendableImage } from '../../imageInput'
import type { AIProvider, AIRequest, AIResponse, AIToolCall, AIMessage } from '../types'
import { keyFormatProblem, type KeyFormatRule } from '../keyFormat'

// Always use direct API URL in the browser — the proxy path (/api/moonshot)
// only works when the ForgeMind engine backend is running, which isn't the
// case for GitHub Pages deployments.
const MOONSHOT_BASE_URL = 'https://api.moonshot.ai/v1';

// Model IDs checked against Moonshot's docs on 2026-10-20 (platform.kimi.ai). kimi-k2.5, the
// moonshot-v1 series and the kimi-k2-thinking IDs are retired and return 404.
export const MOONSHOT_MODELS = [
  { id: 'kimi-k2.6', label: 'Kimi K2.6', contextK: 256, note: 'General reasoning model' },
  { id: 'kimi-k2.7-code', label: 'Kimi K2.7 Code', contextK: 256, note: 'Coding-focused model' },
  { id: 'kimi-k2.7-code-highspeed', label: 'Kimi K2.7 Code Highspeed', contextK: 256, note: 'Coding, faster output' },
  { id: 'kimi-k3', label: 'Kimi K3', contextK: 1024, note: 'Flagship, highest cost' },
]

export const DEFAULT_MOONSHOT_MODEL = MOONSHOT_MODELS[1].id // K2.7 Code: the owner's model

/**
 * Kimi models always think, and reasoning tokens count toward max_tokens. Moonshot recommends
 * max_tokens >= 16000 for tool use; at the old 4096 the reasoning could use the whole budget and
 * leave an empty answer or a tool call cut off mid-arguments.
 */
export const MOONSHOT_DEFAULT_MAX_TOKENS = 16384

/** A saved model ID that is not in the current list (e.g. a retired one) falls back to the default. */
export function resolveMoonshotModel(stored: string | null | undefined): string {
  return MOONSHOT_MODELS.some(m => m.id === stored) ? (stored as string) : DEFAULT_MOONSHOT_MODEL
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
export const MOONSHOT_KEY_FORMAT: KeyFormatRule = { prefix: 'sk-', minLength: 21 }

function isConfigured(apiKey: string): boolean {
  return keyFormatProblem(cleanApiKey(apiKey), MOONSHOT_KEY_FORMAT) === null
}

type MoonshotContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
type MoonshotMessage = { role: string; content: string | MoonshotContentPart[]; tool_calls?: unknown[]; tool_call_id?: string; reasoning_content?: string }

export function toMoonshotMessages(systemPrompt: string, messages: AIMessage[]): MoonshotMessage[] {
  const result: MoonshotMessage[] = [
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
        // Moonshot: pass the assistant message back as returned, reasoning included, in tool-call loops.
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
    } else if (msg.role === 'user' && isSendableImage(msg.image_url)) {
      // Kimi's vision input: the picture travels in the message as an image_url part.
      result.push({
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: msg.image_url } }, { type: 'text', text: msg.content }],
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

async function readMoonshotStream(
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
    const event = JSON.parse(raw) as MoonshotStreamEvent
    if (event.error) {
      const detail = typeof event.error === 'string' ? event.error : event.error.message
      throw new Error(detail || 'Moonshot stream error')
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
      max_tokens: request.maxTokens ?? MOONSHOT_DEFAULT_MAX_TOKENS,
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
      return { text: streamed.text, provider: 'moonshot', model, toolCalls: streamed.toolCalls, stopReason: streamed.stopReason || 'stop', reasoningContent: streamed.reasoningContent }
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
      provider: 'moonshot',
      model,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      stopReason,
      reasoningContent: message?.reasoning_content || undefined,
    }
  },
  
  async test(apiKey: string): Promise<void> {
    const key = cleanApiKey(apiKey)
    if (!isConfigured(key)) {
      throw new Error('Invalid Moonshot API key format. Expected sk-...')
    }
    
    // GET /models checks the key without spending tokens (a 1-token completion still bills a
    // thinking model) and says whether the selectable models are enabled for this key.
    const response = await fetch(`${MOONSHOT_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${key}` },
    })

    if (!response.ok) {
      throw new Error(await moonshotError(response))
    }
    const data = await response.json().catch(() => null) as { data?: Array<{ id?: string }> } | null
    const available = new Set((data?.data ?? []).map(m => m.id))
    if (available.size && !MOONSHOT_MODELS.some(m => available.has(m.id))) {
      throw new Error(`Moonshot key works, but none of ForgeClaw's Kimi models are enabled for it. Available: ${[...available].slice(0, 8).join(', ')}`)
    }
  },
}
