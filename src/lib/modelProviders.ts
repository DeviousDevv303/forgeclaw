// ─── Provider Registry ────────────────────────────────────────────────────────
// ForgeMind routes cloud calls through this module. The caller (Guardian +
// 5-phase scaffold) stays the same regardless of which provider is active.
// Safety governance lives in ForgeClaw's architecture, not the LLM layer.

export type ProviderId = 'anthropic' | 'deepseek' | 'mistral' | 'groq'

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
}

export const PROVIDER_ORDER: ProviderId[] = ['anthropic', 'deepseek', 'mistral', 'groq']

export const DEFAULT_PROVIDER: ProviderId = 'anthropic'
export const DEFAULT_MODEL: Record<ProviderId, string> = {
  anthropic: 'claude-haiku-4-5-20251001',
  deepseek:  'deepseek-chat',
  mistral:   'mistral-large-latest',
  groq:      'llama-3.3-70b-versatile',
}

// ─── Call ─────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface CallResult {
  text: string
  provider: ProviderId
  model: string
}

export async function callProvider(
  providerId: ProviderId,
  model: string,
  systemPrompt: string,
  messages: ChatMessage[],
  apiKey: string,
): Promise<CallResult> {
  const cfg = PROVIDERS[providerId]

  // ── Anthropic (proprietary message format) ───────────────────────────────
  if (providerId === 'anthropic') {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model, max_tokens: 2048, system: systemPrompt, messages }),
    })
    if (!res.ok) {
      const e = await res.json().catch(() => ({})) as { error?: { message?: string } }
      throw new Error(e.error?.message || `Anthropic ${res.status}`)
    }
    const d = await res.json() as { content: Array<{ text: string }> }
    return { text: d.content[0]?.text ?? '', provider: providerId, model }
  }

  // ── OpenAI-compatible: DeepSeek / Mistral / Groq ─────────────────────────
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
    }),
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(e.error?.message || `${cfg.name} ${res.status}`)
  }
  const d = await res.json() as { choices: Array<{ message: { content: string } }> }
  return { text: d.choices[0]?.message?.content ?? '', provider: providerId, model }
}

// Quick key validation — pings the provider with a 1-token request
export async function testProviderKey(
  providerId: ProviderId,
  model: string,
  apiKey: string,
): Promise<void> {
  await callProvider(providerId, model, 'You are a test assistant.', [{ role: 'user', content: 'ping' }], apiKey)
}
