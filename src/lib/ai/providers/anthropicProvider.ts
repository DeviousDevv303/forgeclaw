// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Anthropic Provider Adapter ───────────────────────────────────────────────
// Direct browser-compatible Messages API transport. The API key remains in
// browser localStorage, matching ForgeClaw's existing provider-key model.

import { isSendableImage, parseImageDataUrl } from '../../imageInput'
import type { AIMessage, AIProvider, AIRequest, AIResponse, AIToolCall } from '../types'
import { keyFormatProblem, type KeyFormatRule } from '../keyFormat'

const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
/** Room for a whole-file github_write_file argument; at 4096 a page of HTML hit the limit mid-call. */
export const ANTHROPIC_DEFAULT_MAX_TOKENS = 16384

// Current Messages API model IDs (checked against Anthropic's published model strings on
// 2026-10-16). The earlier 3.5 Haiku / 3.7 Sonnet / Sonnet 4 entries were older aliases that
// may no longer resolve; a stale saved choice is migrated by resolveAnthropicModel().
export const ANTHROPIC_MODELS = [
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', contextK: 200, note: 'Fast, economical' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', contextK: 200, note: 'Balanced reasoning' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', contextK: 200, note: 'Strongest reasoning, highest cost' },
]

export const DEFAULT_ANTHROPIC_MODEL = ANTHROPIC_MODELS[0].id

/** A saved model ID that is not in the current list (e.g. a retired alias) falls back to the default. */
export function resolveAnthropicModel(stored: string | null | undefined): string {
  return ANTHROPIC_MODELS.some(m => m.id === stored) ? (stored as string) : DEFAULT_ANTHROPIC_MODEL
}

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } | { type: 'url'; url: string } }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }

type AnthropicMessage = {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

type AnthropicResponse = {
  content?: AnthropicContentBlock[]
  stop_reason?: string
  error?: { type?: string; message?: string }
}

function cleanApiKey(apiKey: string): string {
  return apiKey.trim()
}

/** The key format send() enforces; the Diagnostics panel words its reason from the same rule (keyFormat.ts). */
export const ANTHROPIC_KEY_FORMAT: KeyFormatRule = { prefix: 'sk-ant-', minLength: 21 }

function isConfigured(apiKey: string): boolean {
  return keyFormatProblem(cleanApiKey(apiKey), ANTHROPIC_KEY_FORMAT) === null
}

/**
 * The Messages API rejects an empty text block, needs every tool_result for one assistant turn in the
 * very next user message, and starts with a user turn. The tool loop produces one 'tool' message per
 * result and the 6-message history window can start on an assistant reply, so normalize here.
 */
export function toAnthropicMessages(messages: AIMessage[]): AnthropicMessage[] {
  const result: Array<{ role: 'user' | 'assistant'; content: AnthropicContentBlock[] }> = []
  for (const message of messages) {
    const blocks: AnthropicContentBlock[] = []
    let role: 'user' | 'assistant'
    if (message.role === 'tool') {
      role = 'user'
      blocks.push({ type: 'tool_result', tool_use_id: message.tool_call_id || '', content: message.content || '(empty result)' })
    } else {
      role = message.role === 'assistant' ? 'assistant' : 'user'
      // Pictures go only in user turns, before the text that asks about them.
      if (role === 'user' && isSendableImage(message.image_url)) {
        const inline = parseImageDataUrl(message.image_url)
        blocks.push({ type: 'image', source: inline ? { type: 'base64', media_type: inline.mediaType, data: inline.data } : { type: 'url', url: message.image_url } })
      }
      if (message.content?.trim()) blocks.push({ type: 'text', text: message.content })
      if (message.role === 'assistant') {
        blocks.push(...(message.tool_calls ?? []).map(call => ({
          type: 'tool_use' as const,
          id: call.id,
          name: call.name,
          input: call.input ?? {},
        })))
      }
    }
    if (!blocks.length) continue
    const previous = result[result.length - 1]
    if (previous?.role === role) previous.content.push(...blocks)
    else result.push({ role, content: blocks })
  }
  while (result[0]?.role === 'assistant') result.shift()
  // Plain single-text turns keep the simple string form.
  return result.map(m => m.content.length === 1 && m.content[0].type === 'text' ? { role: m.role, content: m.content[0].text } : m)
}

function toAnthropicTools(tools: NonNullable<AIRequest['tools']>) {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }))
}

async function anthropicError(response: Response): Promise<string> {
  const raw = await response.text().catch(() => '')
  if (!raw) return `Anthropic ${response.status}`
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string }; message?: string }
    const detail = parsed.error?.message ?? parsed.message
    return detail ? `Anthropic ${response.status}: ${detail}` : `Anthropic ${response.status}`
  } catch {
    return `Anthropic ${response.status}: ${raw.slice(0, 300)}`
  }
}

function headers(apiKey: string, workspaceId?: string): HeadersInit {
  const result: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': cleanApiKey(apiKey),
    'anthropic-version': ANTHROPIC_VERSION,
    // Anthropic requires this opt-in for direct browser requests.
    'anthropic-dangerous-direct-browser-access': 'true',
  }
  if (workspaceId?.trim()) result['anthropic-workspace-id'] = workspaceId.trim()
  return result
}

async function readStream(response: Response, onToken: (token: string) => void): Promise<{ text: string; stopReason?: string }> {
  const reader = response.body?.getReader()
  if (!reader) return { text: '' }
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let stopReason: string | undefined

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
        if (!raw) continue
        const event = JSON.parse(raw) as {
          type?: string
          delta?: { type?: string; text?: string; stop_reason?: string }
          error?: { message?: string }
        }
        if (event.error?.message) throw new Error(`Anthropic stream: ${event.error.message}`)
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
          text += event.delta.text
          onToken(event.delta.text)
        }
        if (event.type === 'message_delta') stopReason = event.delta?.stop_reason
      }
    }
  } finally {
    reader.releaseLock()
  }

  return { text, stopReason }
}

export const anthropicProvider: AIProvider = {
  id: 'anthropic',
  label: 'Anthropic (Claude)',
  requiresKey: true,
  models: ANTHROPIC_MODELS,
  isConfigured,
  supportsTools(): boolean {
    return true
  },

  async send(request: AIRequest, apiKey: string): Promise<AIResponse> {
    const model = request.model || DEFAULT_ANTHROPIC_MODEL
    const body: Record<string, unknown> = {
      model,
      max_tokens: request.maxTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS,
      system: request.systemPrompt,
      messages: toAnthropicMessages(request.messages),
      stream: !!request.onToken,
    }
    if (request.tools?.length) body.tools = toAnthropicTools(request.tools)

    const response = await fetch(ANTHROPIC_BASE_URL, {
      method: 'POST',
      headers: headers(apiKey, request.workspaceId),
      body: JSON.stringify(body),
      signal: request.signal,
    })
    if (!response.ok) throw new Error(await anthropicError(response))

    if (request.onToken) {
      const streamed = await readStream(response, request.onToken)
      return { text: streamed.text, provider: 'anthropic', model, stopReason: streamed.stopReason }
    }

    const data = await response.json() as AnthropicResponse
    if (data.error?.message) throw new Error(`Anthropic: ${data.error.message}`)
    const blocks = data.content ?? []
    const text = blocks.filter((block): block is { type: 'text'; text: string } => block.type === 'text').map(block => block.text).join('')
    const toolCalls: AIToolCall[] = blocks
      .filter((block): block is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } => block.type === 'tool_use')
      .map(block => ({
        id: block.id,
        name: block.name,
        input: block.input ?? {},
        // A tool_use cut off at max_tokens carries incomplete input; it must not run.
        ...(data.stop_reason === 'max_tokens' ? { parseError: 'the response hit the output token limit before the tool arguments were complete' } : {}),
      }))

    return {
      text,
      provider: 'anthropic',
      model,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      stopReason: data.stop_reason,
    }
  },

  async test(apiKey: string, workspaceId?: string): Promise<void> {
    if (!isConfigured(apiKey)) throw new Error('Invalid Anthropic API key format. Expected sk-ant-...')
    const response = await fetch(ANTHROPIC_BASE_URL, {
      method: 'POST',
      headers: headers(apiKey, workspaceId),
      body: JSON.stringify({
        model: DEFAULT_ANTHROPIC_MODEL,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    })
    if (!response.ok) throw new Error(await anthropicError(response))
  },
}
