// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Local Inference Provider Adapter ─────────────────────────────────────────
// OpenAI-compatible transport for a local llama.cpp server.
// The runtime is replaceable: ForgeClaw depends on this HTTP contract, not on
// llama.cpp internals. Start llama-server with a GGUF model and expose /v1.

import type { AIProvider, AIRequest, AIResponse, AIToolCall, AIMessage } from '../types'
import { checkNexusKnowledge } from '../../corpus'

export const DEFAULT_LOCAL_ENDPOINT = 'http://127.0.0.1:8080/v1'
export const DEFAULT_LOCAL_MODEL = 'local-model'

export const LOCAL_MODELS = [
  {
    id: DEFAULT_LOCAL_MODEL,
    label: 'Local GGUF (llama.cpp)',
    contextK: 8,
    note: 'Use a quantized 1.5B–3B model; server selects the loaded GGUF',
  },
]

type LocalMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  image_url?: string
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

type LocalResponse = {
  choices?: Array<{
    message?: {
      content?: string | null
      tool_calls?: Array<{
        id: string
        type?: 'function'
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string
  }>
  error?: { message?: string } | string
}

function endpoint(apiKey: string): string {
  const configured = apiKey.trim() || import.meta.env.VITE_LOCAL_INFERENCE_URL || DEFAULT_LOCAL_ENDPOINT
  return configured.replace(/\/+$/, '')
}

function toMessages(systemPrompt: string, messages: AIMessage[]): LocalMessage[] {
  return [
    { role: 'system', content: systemPrompt },
    ...messages.map((message): LocalMessage => {
      if (message.role === 'tool') {
        return { role: 'tool', content: message.content, tool_call_id: message.tool_call_id }
      }
      if (message.role === 'assistant') {
        return {
          role: 'assistant',
          content: message.content || null,
          tool_calls: message.tool_calls?.map(call => ({
            id: call.id,
            type: 'function' as const,
            function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) },
          })),
        }
      }
      return { role: 'user', content: message.content, image_url: message.image_url }
    }),
  ]
}

/**
 * DeepSeek-primary mode: NEXUS is a knowledge layer and never the reasoning
 * engine. It may only return an approved answer already present in the corpus.
 */
export function shouldUseLocalModel(messages: AIMessage[]): boolean {
  void messages
  return false
}

export function routeLocalTask(messages: AIMessage[]): 'local' | 'deepseek' {
  return shouldUseLocalModel(messages) ? 'local' : 'deepseek'
}

function toTools(tools: NonNullable<AIRequest['tools']>) {
  return tools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
}

async function responseError(response: Response): Promise<string> {
  const raw = await response.text().catch(() => '')
  if (!raw) return `Local inference ${response.status}`
  try {
    const parsed = JSON.parse(raw) as LocalResponse
    const detail = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message
    return detail ? `Local inference ${response.status}: ${detail}` : `Local inference ${response.status}`
  } catch {
    return `Local inference ${response.status}: ${raw.slice(0, 300)}`
  }
}

async function readStream(response: Response, onToken: (token: string) => void): Promise<string> {
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
        const event = JSON.parse(raw) as { choices?: Array<{ delta?: { content?: string } }> }
        const token = event.choices?.[0]?.delta?.content
        if (token) { text += token; onToken(token) }
      }
    }
  } finally {
    reader.releaseLock()
  }
  return text
}

function normalizeToolCall(call: AIToolCall): AIToolCall {
  const name = call.name === 'generateimage' ? 'generate_image' : call.name === 'deepseekreason' ? 'deepseek_reason' : call.name
  const input = { ...call.input }
  if (name === 'deepseek_reason' && input.nexus_learn === undefined) {
    if (input.nexuslearn !== undefined) input.nexus_learn = input.nexuslearn
    else if (input.nexusLearn !== undefined) input.nexus_learn = input.nexusLearn
  }
  return { ...call, name, input }
}

export const localInferenceProvider: AIProvider = {
  id: 'local',
  label: 'Local Inference (llama.cpp)',
  requiresKey: false,
  models: LOCAL_MODELS,

  isConfigured(apiKey: string): boolean {
    const value = apiKey.trim() || import.meta.env.VITE_LOCAL_INFERENCE_URL || DEFAULT_LOCAL_ENDPOINT
    return /^https?:\/\//i.test(value)
  },

  supportsTools(): boolean {
    return true
  },

  async send(request: AIRequest, apiKey: string): Promise<AIResponse> {
    const model = request.model || DEFAULT_LOCAL_MODEL
    const lastUserMessage = [...request.messages].reverse().find(message => message.role === 'user')
    const learned = lastUserMessage && !lastUserMessage.image_url ? checkNexusKnowledge(lastUserMessage.content) : null
    if (learned) {
      return { text: learned.content, provider: 'nexus-memory', model: 'nexus-memory', stopReason: 'knowledge-hit' }
    }
    const hasImages = request.messages.some(message => Boolean(message.image_url) || /data:image\//i.test(message.content))
    const body: Record<string, unknown> = {
      model,
      messages: toMessages(request.systemPrompt, request.messages),
      max_tokens: request.maxTokens ?? 2048,
      stream: !!request.onToken,
      temperature: 0.1,  // Low temperature for deterministic output
    }
    
    // If task involves writing files, constrain output to only tool call JSON
    const lastUserMsg = request.messages[request.messages.length - 1]
    if (!hasImages && lastUserMsg?.role === 'user' && /write|create|commit|branch/i.test(lastUserMsg.content || '')) {
      // Force JSON mode if supported
      body.response_format = { type: 'json_object' }
      body.temperature = 0.0  // Maximum determinism
    }
    if (request.tools?.length) {
      body.tools = toTools(request.tools)
      const hasToolResult = request.messages.some(message => message.role === 'tool')
      const hasDeepSeekTool = request.tools.some(tool => tool.name === 'deepseek_reason')
      const hasImageTool = request.tools.some(tool => tool.name === 'analyze_image')
      body.tool_choice = !hasToolResult && hasImages && hasImageTool
        ? { type: 'function', function: { name: 'analyze_image' } }
        : !hasToolResult && hasDeepSeekTool
          ? { type: 'function', function: { name: 'deepseek_reason' } }
          : 'auto'
      const lastMessage = (body.messages as LocalMessage[])[(body.messages as LocalMessage[]).length - 1]
      if (routeLocalTask(request.messages) === 'deepseek' && lastMessage?.role === 'user' && typeof lastMessage.content === 'string' && request.tools.some(tool => tool.name === 'deepseek_reason')) {
        lastMessage.content += '\n\nThis is a complex task. Delegate primary reasoning to the deepseek_reason tool, then use its result to formulate the final response.'
      }
      // Force tool call format for small local models that don't reliably emit tool_calls
      const messages = body.messages as Array<{ role: string; content: string }>
      const lastMsg = messages[messages.length - 1]
      if (lastMsg?.role === 'user' && typeof lastMsg.content === 'string') {
        lastMsg.content += `\n\nIf you need to use a tool, you MUST respond with ONLY this exact JSON format (no other text, no explanation):\n{"tool_calls":[{"id":"call_1","type":"function","function":{"name":"TOOL_NAME","arguments":"{\\"param\\":\\"value\\"}"}}]}\n\nReplace TOOL_NAME with the actual tool name and fill in the parameters.`
      }
    }

    const response = await fetch(`${endpoint(apiKey)}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: request.signal,
    })
    if (!response.ok) throw new Error(await responseError(response))

    if (request.onToken) {
      const streamedText = await readStream(response, request.onToken)
      const streamedToolCalls = extractToolCallsFromText(streamedText)
      return {
        text: streamedText,
        provider: 'local',
        model,
        toolCalls: streamedToolCalls.length ? streamedToolCalls : undefined,
        stopReason: 'stop',
      }
    }

    const data = await response.json() as LocalResponse
    if (data.error) throw new Error(typeof data.error === 'string' ? data.error : data.error.message || 'Local inference error')
    const choice = data.choices?.[0]
    const message = choice?.message
    
    // Parse native tool_calls from model
    let toolCalls: AIToolCall[] = (message?.tool_calls ?? []).map(call => ({
      id: call.id,
      name: call.function?.name || '',
      input: (() => {
        try { return JSON.parse(call.function?.arguments || '{}') as Record<string, unknown> } catch { return {} }
      })(),
    })).filter(call => call.id && call.name).map(normalizeToolCall)
    
    // FALLBACK: Extract tool calls from text if model didn't emit native tool_calls
    if (!toolCalls.length && message?.content) {
      toolCalls = extractToolCallsFromText(message.content)
    }

    return {
      text: message?.content ?? '',
      provider: 'local',
      model,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      stopReason: choice?.finish_reason,
    }
  },

  async test(apiKey: string): Promise<void> {
    const response = await fetch(`${endpoint(apiKey)}/models`)
    if (!response.ok) throw new Error(await responseError(response))
  },
}


function extractToolCallsFromText(text: string): AIToolCall[] {
  const patterns = [
    /\{"tool[_]?calls":\s*\[(.*?)\]\}/s,
    /\{"name":\s*"(\w+)",\s*"arguments":\s*(\{.*?\})\}/s,
    /(\w+)\s*\((\{.*?\})\)/s,
  ]
  
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      try {
        const parsed = JSON.parse(match[0])
        const parsedToolCalls = parsed.tool_calls || parsed.toolcalls
        if (parsedToolCalls) {
          return parsedToolCalls.map((tc: { id?: string; function?: { name?: string; arguments?: string }; name?: string; arguments?: string | Record<string, unknown> }) => ({
            id: tc.id || 'call_' + Date.now(),
            name: tc.function?.name === 'generateimage' ? 'generate_image' : tc.function?.name || (tc.name === 'generateimage' ? 'generate_image' : tc.name),
            input: (() => {
              try {
                const args = tc.function?.arguments || tc.arguments || '{}'
                return typeof args === 'string' ? JSON.parse(args) : args
              } catch { return {} }
            })(),
          })).filter((tc: { name?: string }) => tc.name).map(normalizeToolCall)
        } else if (parsed.name) {
          return [normalizeToolCall({
            id: 'call_' + Date.now(),
            name: parsed.name,
            input: (() => {
              try {
                const args = parsed.arguments || '{}'
                return typeof args === 'string' ? JSON.parse(args) : args
              } catch { return {} }
            })(),
          })]
        }
      } catch {
        continue
      }
    }
  }
  return []
}
