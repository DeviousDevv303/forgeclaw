// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Provider Registry ────────────────────────────────────────────────────────
// ForgeMind routes cloud calls through this module.
// Safety governance lives in ForgeClaw's architecture, not the LLM layer.

export type ProviderId = 'anthropic' | 'deepseek' | 'mistral' | 'groq' | 'kimi' | 'kimi_code' | 'ollama' | 'openrouter' | 'openai'

function kimiCodeUrl(): string {
  try {
    return localStorage.getItem('fc_kimi_code_url') || 'https://api.moonshot.cn/v1/chat/completions'
  } catch { return 'https://api.moonshot.cn/v1/chat/completions' }
}

export interface ModelOption {
  id: string
  label: string
  contextK: number
  note?: string
  noTools?: boolean  // true = provider routes this model to endpoints without function-calling support
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
  openai: {
    id: 'openai',
    name: 'OpenAI',
    url: 'https://api.openai.com/v1/chat/completions',
    models: [
      { id: 'gpt-4o',       label: 'GPT-4o',      contextK: 128 },
      { id: 'gpt-4o-mini',  label: 'GPT-4o-mini', contextK: 128 },
      { id: 'gpt-4-turbo',  label: 'GPT-4-turbo', contextK: 128 },
    ],
    keyPlaceholder: 'sk-...',
    keyPrefix: 'sk-',
  },

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
      { id: 'mistral-large-latest',  label: 'Mistral Large',         contextK: 128 },
      { id: 'mistral-small-latest',  label: 'Mistral Small',         contextK: 32  },
      { id: 'open-mistral-nemo',     label: 'Mistral Nemo (open)',   contextK: 128 },
    ],
    keyPlaceholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  },

  groq: {
    id: 'groq',
    name: 'Groq',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    models: [
      { id: 'llama-3.3-70b-versatile',                    label: 'Llama 3.3 70B (fast)',    contextK: 128 },
      { id: 'meta-llama/llama-4-scout-17b-16e-instruct',  label: 'Llama 4 Scout 17B',       contextK: 128, note: 'Llama 4' },
      { id: 'qwen/qwen3-32b',                             label: 'Qwen 3 32B',              contextK: 128 },
      { id: 'llama-3.1-8b-instant',                       label: 'Llama 3.1 8B (instant)',  contextK: 128 },
    ],
    keyPlaceholder: 'gsk_...',
    keyPrefix: 'gsk_',
  },

  kimi: {
    id: 'kimi',
    name: 'Kimi',
    url: 'https://api.moonshot.cn/v1/chat/completions',
    models: [
      { id: 'kimi-k2.6',          label: 'Kimi K2.6',                    contextK: 128, note: 'Latest' },
      { id: 'kimi-k2.6-thinking', label: 'Kimi K2.6 Thinking',           contextK: 128, note: 'Reasoning traces' },
      { id: 'kimi-k1-5',          label: 'Kimi k1.5 (reasoning)',        contextK: 128, note: 'Extended reasoning' },
      { id: 'moonshot-v1-128k',   label: 'Moonshot 128K',                contextK: 128 },
      { id: 'moonshot-v1-8k',     label: 'Moonshot 8K (fast)',           contextK: 8   },
    ],
    keyPlaceholder: 'sk-kimi-...',
  },

  kimi_code: {
    id: 'kimi_code',
    name: 'Kimi Code',
    url: 'https://api.moonshot.cn/v1/chat/completions',
    models: [
      { id: 'moonshot-v1-8k',     label: 'Moonshot 8K (fast)',            contextK: 8   },
      { id: 'moonshot-v1-32k',    label: 'Moonshot 32K',                  contextK: 32  },
      { id: 'moonshot-v1-128k',   label: 'Moonshot 128K',                 contextK: 128 },
      { id: 'kimi-k2.6',          label: 'Kimi K2.6 (Code)',              contextK: 128, note: 'Flagship' },
      { id: 'kimi-k2.6-thinking', label: 'Kimi K2.6 Thinking',           contextK: 128, note: 'Reasoning' },
    ],
    keyPlaceholder: 'sk-kimi-... (from kimi.com/code/console)',
  },

  ollama: {
    id: 'ollama',
    name: 'Ollama',
    url: 'http://localhost:11434/v1/chat/completions',
    models: [
      { id: 'gemma4:latest',     label: 'Gemma 4 (latest)',       contextK: 128 },
      { id: 'gemma4:4b',         label: 'Gemma 4 4B',             contextK: 128 },
      { id: 'llama3.2:3b',       label: 'Llama 3.2 3B (fast)',    contextK: 128 },
      { id: 'llama3.1:8b',       label: 'Llama 3.1 8B',           contextK: 128 },
      { id: 'qwen2.5:7b',        label: 'Qwen 2.5 7B',            contextK: 128 },
      { id: 'qwen2.5:1.8b',      label: 'Qwen 2.5 1.8B (tiny)',   contextK: 32  },
      { id: 'mistral:7b',        label: 'Mistral 7B (local)',      contextK: 32  },
      { id: 'phi3.5:3.8b',       label: 'Phi 3.5 3.8B',           contextK: 128 },
      { id: 'gemma2:2b',         label: 'Gemma 2 2B',             contextK: 8   },
      { id: 'deepseek-r1:7b',    label: 'DeepSeek R1 7B',         contextK: 64  },
      { id: 'codellama:7b',      label: 'CodeLlama 7B',           contextK: 16  },
    ],
    keyPlaceholder: '(no key needed)',
  },

  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    models: [
      { id: 'deepseek/deepseek-v4-flash:free',                              label: 'DeepSeek V4 Flash (free)',       contextK: 1024, note: 'Large context', noTools: true },
      { id: 'google/gemma-4-26b-a4b-it:free',                               label: 'Gemma 4 26B A4B (free)',        contextK: 262,  noTools: true },
      { id: 'google/gemma-4-31b-it:free',                                    label: 'Gemma 4 31B (free)',            contextK: 262,  noTools: true },
      { id: 'qwen/qwen3-coder:free',                                         label: 'Qwen3 Coder 480B (free)',       contextK: 1024, note: 'Coding', noTools: true },
      { id: 'meta-llama/llama-3.3-70b-instruct:free',                        label: 'Llama 3.3 70B (free)',          contextK: 131,  noTools: true },
      { id: 'nousresearch/hermes-3-llama-3.1-405b:free',                     label: 'Hermes 3 405B (free)',          contextK: 131,  noTools: true },
      { id: 'cognitivecomputations/dolphin-mistral-24b-venice-edition:free', label: 'Venice Uncensored 24B (free)',  contextK: 32,   noTools: true },
      { id: 'openai/gpt-oss-120b:free',                                      label: 'GPT OSS 120B (free)',           contextK: 131,  noTools: true },
      { id: 'qwen/qwen3-next-80b-a3b-instruct:free',                         label: 'Qwen3 Next 80B (free)',         contextK: 262,  noTools: true },
    ],
    keyPlaceholder: 'sk-or-...',
    keyPrefix: 'sk-or-',
  },
}

export const PROVIDER_ORDER: ProviderId[] = ['openrouter', 'openai', 'groq', 'anthropic', 'deepseek', 'mistral', 'kimi', 'kimi_code', 'ollama']

export const DEFAULT_PROVIDER: ProviderId = 'openrouter'
export const DEFAULT_MODEL: Record<ProviderId, string> = {
  openai:      'gpt-4o',
  anthropic:   'claude-haiku-4-5-20251001',
  deepseek:    'deepseek-chat',
  mistral:     'mistral-large-latest',
  groq:        'llama-3.3-70b-versatile',
  kimi:        'kimi-k2.6',
  kimi_code:   'moonshot-v1-8k',
  ollama:      'llama3.2:3b',
  openrouter:  'deepseek/deepseek-v4-flash:free',
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
  const cfg = { ...PROVIDERS[providerId] }
  if (providerId === 'kimi_code') cfg.url = kimiCodeUrl()
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

  // ── OpenAI-compatible: DeepSeek / Mistral / Groq / Kimi / Ollama ────────
  const oaiMessages = [{ role: 'system', content: systemPrompt }, ...messages]
  const body: Record<string, unknown> = { model, max_tokens: maxTokens, messages: oaiMessages, stream: streaming }
  if (tools?.length && modelSupportsTools(providerId, model)) body.tools = toOpenAITools(tools)

  const oaiHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
  // Ollama runs locally — no auth header needed
  if (providerId !== 'ollama') oaiHeaders['Authorization'] = `Bearer ${apiKey}`
  // OpenRouter requires app identification headers; free-tier providers reject requests without them
  if (providerId === 'openrouter') {
    oaiHeaders['HTTP-Referer'] = 'https://deviousdevv303.github.io/forgeclaw'
    oaiHeaders['X-Title'] = 'ForgeClaw'
  }

  // OpenRouter free-tier endpoints are flaky — retry transient provider errors
  const maxAttempts = providerId === 'openrouter' ? 3 : 1
  let res!: Response
  let lastErrMsg = `${cfg.name} error`

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, attempt * 1500))
    res = await fetch(cfg.url, { method: 'POST', headers: oaiHeaders, body: JSON.stringify(body) })
    if (res.ok) break
    const raw = await res.text().catch(() => '')
    try {
      const e = JSON.parse(raw) as { error?: { message?: string } | string; message?: string }
      const detail = typeof e.error === 'string' ? e.error : e.error?.message ?? e.message
      lastErrMsg = detail || `${cfg.name} ${res.status}`
    } catch { lastErrMsg = raw ? raw.slice(0, 200) : `${cfg.name} ${res.status}` }
    const isTransient = /provider returned error|upstream|overload/i.test(lastErrMsg) || res.status === 502 || res.status === 503
    if (!isTransient || attempt === maxAttempts - 1) throw new Error(lastErrMsg)
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
          let evt: { choices?: Array<{ delta?: { content?: string } }>; error?: { message?: string } }
          try { evt = JSON.parse(line.slice(6)) } catch { continue }
          if (evt.error?.message) throw new Error(evt.error.message)  // provider error mid-stream
          const token = evt.choices?.[0]?.delta?.content
          if (token) { fullText += token; onToken(token) }
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

// Returns false for models that don't support function-calling (e.g. OpenRouter free-tier)
export function modelSupportsTools(providerId: ProviderId, modelId: string): boolean {
  return !(PROVIDERS[providerId]?.models.find(m => m.id === modelId)?.noTools ?? false)
}

// Quick key validation — pings the provider with a 1-token request
export async function testProviderKey(
  providerId: ProviderId,
  model: string,
  apiKey: string,
): Promise<void> {
  await callProvider(providerId, model, 'You are a test assistant.', [{ role: 'user', content: 'ping' }], apiKey)
}
