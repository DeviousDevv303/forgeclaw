// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── OpenRouter-Only Provider Bridge ────────────────────────────────────────

import type { AIMessage } from './ai/types'
import { DEFAULT_OPENROUTER_MODEL, openrouterProvider, resolveOpenRouterModel } from './ai/providers/openrouterProvider'
import { DEFAULT_MOONSHOT_MODEL, moonshotProvider } from './ai/providers/moonshotProvider'
import type { ToolCall, ToolDef } from './forgeTools'

export type ProviderId = 'openrouter' | 'moonshot'

export interface ModelOption {
  id: string
  label: string
  contextK: number
  note?: string
  noTools?: boolean
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
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    models: openrouterProvider.models.map(model => ({
      ...model,
      noTools: !openrouterProvider.supportsTools(model.id),
    })),
    keyPlaceholder: 'sk-or-...',
    keyPrefix: 'sk-or-',
  },
  moonshot: {
    id: 'moonshot',
    name: 'Moonshot',
    url: 'https://api.moonshot.cn/v1/chat/completions',
    models: moonshotProvider.models.map(model => ({
      ...model,
      noTools: !moonshotProvider.supportsTools(model.id),
    })),
    keyPlaceholder: 'sk-...',
    keyPrefix: 'sk-',
  },
}

export const PROVIDER_ORDER: ProviderId[] = ['openrouter', 'moonshot']
export const DEFAULT_PROVIDER: ProviderId = 'openrouter'
export const DEFAULT_MODEL: Record<ProviderId, string> = {
  openrouter: DEFAULT_OPENROUTER_MODEL,
  moonshot: DEFAULT_MOONSHOT_MODEL,
}

export type ChatMessage = AIMessage

export interface CallResult {
  text: string
  provider: ProviderId
  model: string
  toolCalls?: ToolCall[]
  stopReason?: string
}

export interface CallOptions {
  tools?: ToolDef[]
  onToken?: (token: string) => void
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
  if (providerId !== 'openrouter') {
    throw new Error(`Unsupported provider: ${providerId}`)
  }

  const resolvedModel = resolveOpenRouterModel(model)
  const response = await openrouterProvider.send({
    systemPrompt,
    messages,
    model: resolvedModel,
    maxTokens: options.maxTokens,
    tools: options.tools,
    onToken: options.onToken,
  }, apiKey)

  return {
    text: response.text,
    provider: 'openrouter',
    model: response.model,
    toolCalls: response.toolCalls,
    stopReason: response.stopReason,
  }
}

export function modelSupportsTools(providerId: ProviderId, modelId: string): boolean {
  return providerId === 'openrouter' && openrouterProvider.supportsTools(resolveOpenRouterModel(modelId))
}

export async function testProviderKey(
  providerId: ProviderId,
  _model: string,
  apiKey: string,
): Promise<void> {
  if (providerId !== 'openrouter') {
    throw new Error(`Unsupported provider: ${providerId}`)
  }
  await openrouterProvider.test(apiKey)
}
