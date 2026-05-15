// ─── Provider Registry ────────────────────────────────────────────────────────
// ForgeMind routes cloud calls through this module. The caller (Guardian +
// 5-phase scaffold) stays the same regardless of which provider is active.
// Safety governance lives in ForgeClaw's architecture, not the LLM layer.

export type ProviderId = 'anthropic' | 'deepseek' | 'mistral' | 'groq' | 'kimi'

export interface ModelOption {
  id: string
  label: string
  contextK: number
  note?: string
}

export interface ProviderConfig {
  id: ProviderId
  name: string
  url: string
  models: ModelOption[]
  keyPlaceholder: string
  keyPrefix?: string
}

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    url: 'https://api.anthropic.com/v1/messages',
    models: [
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5',  contextK: 200 },
      { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6', contextK: 200 },
      { id: 'claude-opus-4-7',           label: 'Claude Opus 4.7',   contextK: 200 },
    ],
    keyPlaceholder: 'sk-ant-...',
    keyPrefix: 'sk-ant-',
  },

  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    url: 'https://api.deepseek.com/v1/chat/completions',
    models: [
      { id: 'deepseek-chat',     label: 'DeepSeek V3',                   contextK: 64,  note: 'Top benchmark scores' },
      { id: 'deepseek-reasoner', label: 'DeepSeek R1 (chain-of-thought)', contextK: 64,  note: 'Extended reasoning traces' },
    ],
    keyPlaceholder: 'sk-...',
  },

  mistral: {
    id: 'mistral',
    name: 'Mistral',
    url: 'https://api.mistral.ai/v1/chat/completions',
    models: [
      { id: 'mistral-large-latest',  label: 'Mistral Large',    contextK: 128 },
      { id: 'mistral-medium-latest', label: 'Mistral Medium',   contextK: 128 },
      { id: 'open-mistral-7b',       label: 'Mistral 7B (open)', contextK: 32 },
    ],
    keyPlaceholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  },

  groq: {
    id: 'groq',
    name: 'Groq',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    models: [
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (fast)',  contextK: 128 },
      { id: 'llama-3.1-8b-instant',    label: 'Llama 3.1 8B (instant)', contextK: 128 },
      { id: 'mixtral-8x7b-32768',      label: 'Mixtral 8x7B',           contextK: 32  },
    ],
    keyPlaceholder: 'gsk_...',
    keyPrefix: 'gsk_',
  },

  kimi: {
    id: 'kimi',
    name: 'Kimi',
    url: 'https://api.moonshot.ai/v1/chat/completions',
    models: [
      { id: 'kimi-k2.6',          label: 'Kimi K2.6',                    contextK: 128, note: 'Latest' },
      { id: 'kimi-k2.6-thinking', label: 'Kimi K2.6 Thinking',           contextK: 128, note: 'Reasoning traces' },
      { id: 'kimi-k1-5',          label: 'Kimi k1.5 (reasoning)',        contextK: 128, note: 'Extended reasoning' },
      { id: 'moonshot-v1-128k',   label: 'Moonshot 128K',                contextK: 128 },
      { id: 'moonshot-v1-8k',     label: 'Moonshot 8K (fast)',           contextK: 8   },
    ],
    keyPlaceholder: 'sk-kimi-...',
  },
}

export const PROVIDER_ORDER: ProviderId[] = ['anthropic', 'deepseek', 'mistral', 'groq', 'kimi']

export const DEFAULT_PROVIDER: ProviderId = 'groq'
export const DEFAULT_MODEL: Record<ProviderId, string> = {
  anthropic: 'claude-haiku-4-5-20251001',
  deepseek:  'deepseek-chat',
  mistral:   'mistral-large-latest',
  groq:      'llama-3.3-70b-versatile',
  kimi:      'kimi-k2.6',
}

// ─── Call ─────────────────────────────────────────────────────────────────────

import { toAnthropicTools, toOpenAITools } from './forgeTools'
import type { ToolDef, ToolCall } from './forgeTools'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string | AnthropicContent[]
  tool_call_id?: string   // OpenAI-compat tool result
  tool_calls?: OpenAIToolCall[]
}

// Anthropic multi-part content block
export type AnthropicContent =
  | { type: 'text';        text: string }
  | { type: 'tool_use';    id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }

// OpenAI-compat tool call shape
export interface OpenAIToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface CallResult {
  text: string
  provider: ProviderId
  model: string
  toolCalls?: ToolCall[]     // populated when LLM wants to call tools
  stopReason?: string
}

export interface CallOptions {
  tools?: ToolDef[]
  onToken?: (token: string) => void  // streaming callback
  maxTokens?: number
}

export async function callProvider(
  providerId: ProviderId,
  model: string,
  systemPrompt: string,
  messages: ChatMessage[],
  apiKey: string,
  options: CallOptions = {},
): Promise<CallResult> {
  const cfg = PROVIDERS[providerId]
  const { tools, onToken, maxTokens = 4096 } = options
  const streaming = !!onToken

  // ── Anthropic ───────────────────────────────────────────────────────────────
  if (providerId === 'anthropic') {
    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
      stream: streaming,
    }
    if (tools?.length) body.tools = toAnthropicTools(tools)

    const res = await fetch(cfg.url, {
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
      const e = await res.json().catch(() => ({})) as { error?: { message?: string } }
      throw new Error(e.error?.message || `Anthropic ${res.status}`)
    }

    if (streaming && res.body) {
      let fullText = ''
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
            try {
              const evt = JSON.parse(line.slice(6)) as { type: string; delta?: { type: string; text?: string } }
              if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta' && evt.delta.text) {
                fullText += evt.delta.text
                onToken(evt.delta.text)
              }
            } catch { /* skip non-JSON lines */ }
          }
        }
      } finally {
        reader.releaseLock()
      }
      return { text: fullText, provider: providerId, model, stopReason: 'end_turn' }
    }

    type AnthropicResponse = {
      stop_reason: string
      content: Array<
        | { type: 'text'; text: string }
        | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
      >
    }
    const d = await res.json() as AnthropicResponse
    const textBlock = d.content.find(b => b.type === 'text') as { type: 'text'; text: string } | undefined
    const toolBlocks = d.content.filter(b => b.type === 'tool_use') as Array<{ type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }>
    const toolCalls: ToolCall[] = toolBlocks.map(b => ({ id: b.id, name: b.name, input: b.input }))
    return { text: textBlock?.text ?? '', provider: providerId, model, toolCalls: toolCalls.length ? toolCalls : undefined, stopReason: d.stop_reason }
  }

  // ── OpenAI-compatible: DeepSeek / Mistral / Groq ─────────────────────────
  const oaiMessages = [{ role: 'system', content: systemPrompt }, ...messages]
  const body: Record<string, unknown> = { model, max_tokens: maxTokens, messages: oaiMessages, stream: streaming }
  if (tools?.length) body.tools = toOpenAITools(tools)

  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(e.error?.message || `${cfg.name} ${res.status}`)
  }

  if (streaming && res.body) {
    let fullText = ''
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
          if (!line.startsWith('data: ') || line.includes('[DONE]')) continue
          try {
            const evt = JSON.parse(line.slice(6)) as { choices?: Array<{ delta?: { content?: string } }> }
            const token = evt.choices?.[0]?.delta?.content
            if (token) { fullText += token; onToken(token) }
          } catch { /* skip */ }
        }
      }
    } finally {
      reader.releaseLock()
    }
    return { text: fullText, provider: providerId, model }
  }

  type OAIResponse = {
    choices: Array<{
      message: { content: string | null; tool_calls?: OpenAIToolCall[] }
      finish_reason: string
    }>
  }
  const d = await res.json() as OAIResponse
  const msg = d.choices[0]?.message
  const rawToolCalls = msg?.tool_calls
  const toolCalls: ToolCall[] | undefined = rawToolCalls?.map(tc => {
    try {
      return { id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments) as Record<string, unknown> }
    } catch {
      return { id: tc.id, name: tc.function.name, input: {} as Record<string, unknown> }
    }
  })
  return {
    text: msg?.content ?? '',
    provider: providerId,
    model,
    toolCalls: toolCalls?.length ? toolCalls : undefined,
    stopReason: d.choices[0]?.finish_reason,
  }
}

// Quick key validation — pings the provider with a 1-token request
export async function testProviderKey(
  providerId: ProviderId,
  model: string,
  apiKey: string,
): Promise<void> {
  await callProvider(providerId, model, 'You are a test assistant.', [{ role: 'user', content: 'ping' }], apiKey)
}
