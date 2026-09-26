// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Provider Bridge ──────────────────────────────────────────────────────────

import type { AIMessage, AIRequest } from './ai/types'
import { DEFAULT_OPENROUTER_MODEL, openrouterProvider, resolveOpenRouterModel } from './ai/providers/openrouterProvider'
import { ANTHROPIC_MODELS, DEFAULT_ANTHROPIC_MODEL, anthropicProvider } from './ai/providers/anthropicProvider'
import { DEFAULT_MOONSHOT_MODEL, moonshotProvider } from './ai/providers/moonshotProvider'
import { DEFAULT_LOCAL_ENDPOINT, DEFAULT_LOCAL_MODEL, localInferenceProvider } from './ai/providers/localInferenceProvider'
import { DEFAULT_NEXUS_WEBGPU_MODEL, nexusWebGpuProvider } from './ai/providers/nexusWebGpuProvider'
import type { ToolCall, ToolDef } from './forgeTools'

export type ProviderId = 'openrouter' | 'anthropic' | 'moonshot' | 'local' | 'nexus'

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
    models: openrouterProvider.models.map(model => ({ ...model, noTools: !openrouterProvider.supportsTools(model.id) })),
    keyPlaceholder: 'sk-or-...',
    keyPrefix: 'sk-or-',
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    url: 'https://api.anthropic.com/v1/messages',
    models: ANTHROPIC_MODELS,
    keyPlaceholder: 'sk-ant-...',
    keyPrefix: 'sk-ant-',
  },
  moonshot: {
    id: 'moonshot',
    name: 'Moonshot',
    url: 'https://api.moonshot.cn/v1/chat/completions',
    models: moonshotProvider.models.map(model => ({ ...model, noTools: !moonshotProvider.supportsTools(model.id) })),
    keyPlaceholder: 'sk-...',
    keyPrefix: 'sk-',
  },
  local: {
    id: 'local',
    name: 'Local Inference (llama.cpp)',
    url: `${DEFAULT_LOCAL_ENDPOINT}/chat/completions`,
    models: localInferenceProvider.models.map(model => ({ ...model })),
    keyPlaceholder: DEFAULT_LOCAL_ENDPOINT,
  },
  nexus: {
    id: 'nexus',
    name: 'NEXUS/CORPUS (Browser WebGPU)',
    url: 'browser://webgpu',
    models: nexusWebGpuProvider.models.map(model => ({ ...model })),
    keyPlaceholder: 'Browser WebGPU — no endpoint',
  },
}

export const PROVIDER_ORDER: ProviderId[] = ['local', 'nexus', 'openrouter', 'anthropic', 'moonshot']
export const DEFAULT_PROVIDER: ProviderId = 'local'
export const DEFAULT_MODEL: Record<ProviderId, string> = {
  openrouter: DEFAULT_OPENROUTER_MODEL,
  anthropic: DEFAULT_ANTHROPIC_MODEL,
  moonshot: DEFAULT_MOONSHOT_MODEL,
  local: DEFAULT_LOCAL_MODEL,
  nexus: DEFAULT_NEXUS_WEBGPU_MODEL,
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
  const request: AIRequest = {
    systemPrompt,
    messages,
    model,
    maxTokens: options.maxTokens,
    tools: options.tools,
    onToken: options.onToken,
  }

  if (providerId === 'anthropic') {
    const response = await anthropicProvider.send({ ...request, model: model || DEFAULT_ANTHROPIC_MODEL }, apiKey)
    return { text: response.text, provider: 'anthropic', model: response.model, toolCalls: response.toolCalls, stopReason: response.stopReason }
  }
  if (providerId === 'moonshot') {
    const response = await moonshotProvider.send({ ...request, model: model || DEFAULT_MOONSHOT_MODEL }, apiKey)
    return { text: response.text, provider: 'moonshot', model: response.model, toolCalls: response.toolCalls, stopReason: response.stopReason }
  }
  if (providerId === 'local') {
    const response = await localInferenceProvider.send({ ...request, model: model || DEFAULT_LOCAL_MODEL }, apiKey)
    return { text: response.text, provider: 'local', model: response.model, toolCalls: response.toolCalls, stopReason: response.stopReason }
  }
  if (providerId === 'nexus') {
    const response = await nexusWebGpuProvider.send({ ...request, model: model || DEFAULT_NEXUS_WEBGPU_MODEL }, apiKey)
    return { text: response.text, provider: 'nexus', model: response.model, toolCalls: response.toolCalls, stopReason: response.stopReason }
  }

  const response = await openrouterProvider.send({ ...request, model: resolveOpenRouterModel(model) }, apiKey)
  return { text: response.text, provider: 'openrouter', model: response.model, toolCalls: response.toolCalls, stopReason: response.stopReason }
}

export function modelSupportsTools(providerId: ProviderId, modelId: string): boolean {
  if (providerId === 'anthropic') return anthropicProvider.supportsTools(modelId)
  if (providerId === 'moonshot') return moonshotProvider.supportsTools(modelId)
  if (providerId === 'local') return localInferenceProvider.supportsTools(modelId)
  if (providerId === 'nexus') return nexusWebGpuProvider.supportsTools(modelId)
  return openrouterProvider.supportsTools(resolveOpenRouterModel(modelId))
}

export async function testProviderKey(providerId: ProviderId, _model: string, apiKey: string): Promise<void> {
  if (providerId === 'anthropic') {
    await anthropicProvider.test(apiKey)
    return
  }
  if (providerId === 'moonshot') {
    await moonshotProvider.test(apiKey)
    return
  }
  if (providerId === 'local') {
    await localInferenceProvider.test(apiKey)
    return
  }
  if (providerId === 'nexus') {
    await nexusWebGpuProvider.test(apiKey)
    return
  }
  await openrouterProvider.test(apiKey)
}
