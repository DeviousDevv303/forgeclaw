// ForgeClaw - Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

import type { AIMessage, AIProvider, AIRequest, AIToolCall } from '../types'

export const CLAUDE_MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', contextK: 200 },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', contextK: 200 },
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', contextK: 200 },
]

type ClaudeContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }

type ClaudeMessage = {
  role: 'user' | 'assistant'
  content: string | ClaudeContentBlock[]
}

type ClaudeStreamEvent = {
  type?: string
  index?: number
  content_block?: {
    type?: string
    id?: string
    name?: string
    input?: Record<string, unknown>
  }
  delta?: {
    type?: string
    text?: string
    partial_json?: string
    stop_reason?: string
  }
  error?: { message?: string }
}

function toClaudeTools(tools: NonNullable<AIRequest['tools']>) {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }))
}

function toClaudeMessages(messages: AIMessage[]): ClaudeMessage[] {
  return messages.map(m => {
    if (m.role === 'tool') {
      return {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: m.tool_call_id || 'unknown_tool_call',
          content: m.content,
        }],
      }
    }

    if (m.role === 'assistant' && m.tool_calls?.length) {
      const content: ClaudeContentBlock[] = []
      if (m.content) content.push({ type: 'text', text: m.content })
      for (const call of m.tool_calls) {
        content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input })
      }
      return { role: 'assistant', content }
    }

    return { role: m.role, content: m.content }
  })
}

function claudeError(status: number, raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { error?: { type?: string; message?: string } }
    const type = parsed.error?.type
    const message = parsed.error?.message || `Claude ${status}`
    return type ? `Claude ${status} ${type}: ${message}` : `Claude ${status}: ${message}`
  } catch {
    return raw ? `Claude ${status}: ${raw.slice(0, 200)}` : `Claude ${status}`
  }
}

function parseToolInput(raw: string): Record<string, unknown> {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}

export const claudeProvider: AIProvider = {
  id: 'claude',
  label: 'Claude',
  requiresKey: true,
  models: CLAUDE_MODELS,

  isConfigured(apiKey: string) {
    return typeof apiKey === 'string' && apiKey.startsWith('sk-ant-') && apiKey.length > 20
  },

  supportsTools() {
    return true
  },

  async send(request, apiKey) {
    const { systemPrompt, messages, model, maxTokens = 4096, tools, onToken } = request
    const streaming = !!onToken
    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: toClaudeMessages(messages),
      stream: streaming,
    }

    if (tools?.length) body.tools = toClaudeTools(tools)

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const raw = await res.text().catch(() => '')
      throw new Error(claudeError(res.status, raw))
    }

    if (streaming && res.body) {
      let fullText = ''
      let stopReason: string | undefined
      const toolCallBuffers: Record<number, { id: string; name: string; input: string }> = {}
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            let event: ClaudeStreamEvent
            try { event = JSON.parse(line.slice(6)) as ClaudeStreamEvent } catch { continue }
            if (event.error?.message) throw new Error(event.error.message)

            if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
              const index = event.index ?? Object.keys(toolCallBuffers).length
              const initialInput = event.content_block.input || {}
              toolCallBuffers[index] = {
                id: event.content_block.id || `toolu_${index}`,
                name: event.content_block.name || '',
                input: Object.keys(initialInput).length ? JSON.stringify(initialInput) : '',
              }
            } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
              fullText += event.delta.text
              onToken(event.delta.text)
            } else if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
              const index = event.index ?? Object.keys(toolCallBuffers).length - 1
              if (!toolCallBuffers[index]) {
                toolCallBuffers[index] = { id: `toolu_${index}`, name: '', input: '' }
              }
              toolCallBuffers[index].input += event.delta.partial_json || ''
            } else if (event.type === 'message_delta' && event.delta?.stop_reason) {
              stopReason = event.delta.stop_reason
            }
          }
        }
      } finally {
        reader.releaseLock()
      }

      const toolCalls: AIToolCall[] | undefined = Object.values(toolCallBuffers).length
        ? Object.values(toolCallBuffers).map(call => ({
            id: call.id,
            name: call.name,
            input: parseToolInput(call.input),
          }))
        : undefined

      return {
        text: fullText,
        provider: 'claude',
        model,
        toolCalls,
        stopReason,
      }
    }

    type ClaudeResponse = {
      stop_reason?: string
      content?: Array<
        | { type: 'text'; text: string }
        | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
      >
    }

    const data = await res.json() as ClaudeResponse
    if (!Array.isArray(data.content)) throw new Error('Claude bad_response: missing content array')

    const text = data.content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map(block => block.text)
      .join('')

    const toolCalls: AIToolCall[] = data.content
      .filter((block): block is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } => block.type === 'tool_use')
      .map(block => ({ id: block.id, name: block.name, input: block.input }))

    return {
      text,
      provider: 'claude',
      model,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      stopReason: data.stop_reason,
    }
  },

  async test(apiKey) {
    await this.send(
      {
        systemPrompt: 'You are a test assistant.',
        messages: [{ role: 'user', content: 'ping' }],
        model: CLAUDE_MODELS[0].id,
        maxTokens: 1,
      },
      apiKey,
    )
  },
}
