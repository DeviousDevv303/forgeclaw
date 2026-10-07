// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
import type { AIMessage, AIRequest } from './ai/types'
import { ANTHROPIC_MODELS, DEFAULT_ANTHROPIC_MODEL, anthropicProvider } from './ai/providers/anthropicProvider'
import { DEFAULT_MOONSHOT_MODEL, moonshotProvider, MOONSHOT_MODELS } from './ai/providers/moonshotProvider'
import { DEFAULT_LOCAL_ENDPOINT, DEFAULT_LOCAL_MODEL, localInferenceProvider } from './ai/providers/localInferenceProvider'
import { corpusProvider } from './ai/providers/corpusProvider'
import type { ToolCall, ToolDef } from './forgeTools'
import type { ProviderId } from './providerDefaults'
export { DEFAULT_PROVIDER, resolveInitialProvider } from './providerDefaults'
export type { ProviderId } from './providerDefaults'
export interface ModelOption { id: string; label: string; contextK: number; note?: string; noTools?: boolean }
export interface ProviderConfig { id: ProviderId; name: string; url: string; models: ModelOption[]; keyPlaceholder: string; keyPrefix?: string }
export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  corpus: { id: 'corpus', name: 'DeepSeek 16B (GitHub Actions)', url: 'https://github.com/DeviousDevv303/forgeclaw/actions/workflows/deepseek-16b.yml', models: corpusProvider.models.map(model => ({ ...model })), keyPlaceholder: 'No API key required; DeepSeek workflow uses GitHub authorization' },
  moonshot: { id: 'moonshot', name: 'Moonshot (Kimi)', url: 'https://api.moonshot.cn/v1/chat/completions', models: MOONSHOT_MODELS, keyPlaceholder: 'sk-...', keyPrefix: 'sk-' },
  anthropic: { id: 'anthropic', name: 'Anthropic (Claude)', url: 'https://api.anthropic.com/v1/messages', models: ANTHROPIC_MODELS, keyPlaceholder: 'sk-ant-...', keyPrefix: 'sk-ant-' },
  local: { id: 'local', name: 'Local Inference (llama.cpp)', url: `${DEFAULT_LOCAL_ENDPOINT}/chat/completions`, models: localInferenceProvider.models.map(model => ({ ...model })), keyPlaceholder: DEFAULT_LOCAL_ENDPOINT },
  nexus: { id: 'nexus', name: 'DeepSeek 16B (legacy saved-session alias)', url: 'https://github.com/DeviousDevv303/forgeclaw/actions/workflows/deepseek-16b.yml', models: corpusProvider.models.map(model => ({ ...model })), keyPlaceholder: 'Use the DeepSeek workflow token' },
}
export const PROVIDER_ORDER: ProviderId[] = ['moonshot', 'corpus', 'local', 'anthropic']
export const DEFAULT_MODEL: Record<ProviderId, string> = { corpus: 'deepseek-16b', moonshot: DEFAULT_MOONSHOT_MODEL, anthropic: DEFAULT_ANTHROPIC_MODEL, local: DEFAULT_LOCAL_MODEL, nexus: 'deepseek-16b' }
export type ChatMessage = AIMessage
export interface CallResult { text: string; provider: ProviderId; model: string; toolCalls?: ToolCall[]; stopReason?: string }
export interface CallOptions { tools?: ToolDef[]; onToken?: (token: string) => void; signal?: AbortSignal; maxTokens?: number }
export async function callProvider(providerId: ProviderId, model: string, systemPrompt: string, messages: ChatMessage[], apiKey: string, options: CallOptions = {}): Promise<CallResult> {
  const request: AIRequest = { systemPrompt, messages, model, maxTokens: options.maxTokens, tools: options.tools, onToken: options.onToken, signal: options.signal }
  if (providerId === 'corpus' || providerId === 'nexus') { const response = await corpusProvider.send({ ...request, model: model || 'deepseek-16b' }, apiKey); return { text: response.text, provider: 'corpus', model: response.model, toolCalls: response.toolCalls, stopReason: response.stopReason } }
  if (providerId === 'moonshot') { const response = await moonshotProvider.send({ ...request, model: model || DEFAULT_MOONSHOT_MODEL }, apiKey); return { text: response.text, provider: 'moonshot', model: response.model, toolCalls: response.toolCalls, stopReason: response.stopReason } }
  if (providerId === 'anthropic') { const response = await anthropicProvider.send({ ...request, model: model || DEFAULT_ANTHROPIC_MODEL }, apiKey); return { text: response.text, provider: 'anthropic', model: response.model, toolCalls: response.toolCalls, stopReason: response.stopReason } }
  const response = await localInferenceProvider.send({ ...request, model: model || DEFAULT_LOCAL_MODEL }, apiKey)
  return { text: response.text, provider: 'local', model: response.model, toolCalls: response.toolCalls, stopReason: response.stopReason }
}
export function modelSupportsTools(providerId: ProviderId, modelId: string): boolean {
  if (providerId === 'corpus' || providerId === 'nexus') return corpusProvider.supportsTools(modelId)
  if (providerId === 'moonshot') return moonshotProvider.supportsTools(modelId)
  if (providerId === 'anthropic') return anthropicProvider.supportsTools(modelId)
  return localInferenceProvider.supportsTools(modelId)
}
export async function testProviderKey(providerId: ProviderId, _model: string, apiKey: string): Promise<void> {
  if (providerId === 'corpus' || providerId === 'nexus') { await corpusProvider.test(apiKey); return }
  if (providerId === 'moonshot') { await moonshotProvider.test(apiKey); return }
  if (providerId === 'anthropic') { await anthropicProvider.test(apiKey); return }
  await localInferenceProvider.test(apiKey)
}
