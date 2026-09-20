// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Anthropic Provider Adapter ───────────────────────────────────────────────
// Direct browser-compatible Messages API transport. The API key remains in
// browser localStorage, matching ForgeClaw's existing provider-key model.

import type { AIMessage, AIProvider, AIRequest, AIResponse, AIToolCall } from '../types'

const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

export const ANTHROPIC_MODELS = [
  { id: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku', contextK: 200, note: 'Fast, economical' },
  { id: 'claude-3-7-sonnet-latest', label: 'Claude 3.7 Sonnet', contextK: 200, note: 'Balanced reasoning' },
  { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', contextK: 200, note: 'Latest Sonnet' },
]

export const DEFAULT_ANTHROPIC_MODEL = ANTHROPIC_MODELS[0].id

type AnthropicContentBlock =
  | { type: 'text'; text: string }
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

function isConfigured(apiKey: string): boolean {
  const key = cleanApiKey(apiKey)
  return key.startsWith('sk-ant-') && key.length > 20
}

function toAnthropicMessages(messages: AIMessage[]): AnthropicMessage[] {
  return messages.map((message): AnthropicMessage => {
    if (message.role === 'tool') {
      return {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: message.tool_call_id || '', content: message.content }],
      }
    }

    if (message.role === 'assistant' && message.tool_calls?.length) {
      const blocks: AnthropicContentBlock[] = []
      if (message.content) blocks.push({ type: 'text', text: message.content })
      blocks.push(...message.tool_calls.map(call => ({
        type: 'tool_use' as const,
        id: call.id,
        name: call.name,
        input: call.input ?? {},
      })))
      return { role: 'assistant', content: blocks }
    }

    return { role: message.role === 'assistant' ? 'assistant' : 'user', content: message.content }
  })
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
      max_tokens: request.maxTokens ?? 4096,
      system: request.systemPrompt,
      messages: toAnthropicMessages(request.messages),
      stream: !!request.onToken,
    }
    if (request.tools?.length) body.tools = toAnthropicTools(request.tools)

    const response = await fetch(ANTHROPIC_BASE_URL, {
      method: 'POST',
      headers: headers(apiKey, request.workspaceId),
      body: JSON.stringify(body),
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
      .map(block => ({ id: block.id, name: block.name, input: block.input ?? {} }))

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
