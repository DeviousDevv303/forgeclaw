// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Provider Router ────────────────────────────────────────────────────────
// The default duo is CORPUS/NEXUS with DeepSeek as primary reasoner.
// Side effects stay ForgeTools-dispatched; Qwen WebGPU is secondary synthesis/fallback.

import type { AIRequest, AIResponse, AIError } from './types'
import type { ToolDef } from '../forgeTools'
import { classifyError } from './types'
import { anthropicProvider } from './providers/anthropicProvider'
import { localInferenceProvider, DEFAULT_LOCAL_ENDPOINT, DEFAULT_LOCAL_MODEL } from './providers/localInferenceProvider'
import { corpusProvider } from './providers/corpusProvider'
import { nexusProvider } from './providers/nexusProvider'
import {
  DEFAULT_NEXUS_WEBGPU_MODEL,
  LEGACY_NEXUS_WEBGPU_MODEL,
  isNexusWebGpuAvailable,
} from './providers/nexusWebGpuProvider'
import { injectToolSchemaWithinBudget } from './manualToolMode'
import { MAX_NEXUS_CONTEXT_TOKENS } from './nexusContext'
import { extractImagePrompt, inferImageStyle, isImageGenerationRequest } from '../imageRequest'
import { DEFAULT_PROVIDER } from '../providerDefaults'

// ─── Registry ───────────────────────────────────────────────────────────────

export const providers = {
  corpus: corpusProvider,
  anthropic: anthropicProvider,
  local: localInferenceProvider,
  nexus: nexusProvider,
} as const

export type ProviderId = keyof typeof providers

export interface ProviderChoice {
  providerId: ProviderId
  model: string
  level: 1 | 2 | 3 | 4
}

export const LOCAL_PROVIDER_TIMEOUT_MS = 4_000

async function localEndpointAvailable(apiKey: string): Promise<boolean> {
  const base = (apiKey.trim() || DEFAULT_LOCAL_ENDPOINT).replace(/\/+$/, '')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 650)
  try {
    const response = await fetch(`${base}/models`, { signal: controller.signal, cache: 'no-store' })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** Explicit Local Inference detection may use NEXUS as a fallback; it never changes the default. */
export async function detectBestProvider(apiKey = '', preferredModel = DEFAULT_LOCAL_MODEL): Promise<ProviderChoice> {
  if (await localEndpointAvailable(apiKey)) return { providerId: 'local', model: preferredModel, level: 2 }
  if (isNexusWebGpuAvailable()) return { providerId: 'nexus', model: DEFAULT_NEXUS_WEBGPU_MODEL, level: 3 }
  return { providerId: 'local', model: preferredModel, level: 2 }
}

/** Explicit provider choices are honored; only an explicit Local Inference choice uses endpoint detection. */
export async function getBestProvider(apiKey: string, preferred: ProviderId = DEFAULT_PROVIDER, preferredModel = ''): Promise<ProviderChoice> {
  if (preferred !== 'local') {
    const model = preferredModel || providers[preferred].models[0]?.id || DEFAULT_NEXUS_WEBGPU_MODEL
    return { providerId: preferred, model, level: 1 }
  }
  return detectBestProvider(apiKey, preferredModel || DEFAULT_LOCAL_MODEL)
}

function requestForWebGpuFallback(request: AIRequest, model: string): AIRequest {
  const fallbackPrompt = request.systemPrompt.replace(
    'Native tool calling is available. Use tools when they are needed to complete the objective.',
    'This fallback has no native function-calling; follow the manual tool protocol exactly.',
  )
  const systemPrompt = request.tools?.length
    ? injectToolSchemaWithinBudget(fallbackPrompt, request.tools as unknown as ToolDef[], MAX_NEXUS_CONTEXT_TOKENS - 1024).systemPrompt
    : fallbackPrompt
  return { ...request, model, systemPrompt, tools: undefined, onToken: undefined }
}

async function sendLocalWithTimeout(request: AIRequest, apiKey: string): Promise<AIResponse> {
  const controller = new AbortController()
  const parentSignal = request.signal
  const onParentAbort = () => controller.abort()
  parentSignal?.addEventListener('abort', onParentAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), LOCAL_PROVIDER_TIMEOUT_MS)
  try {
    return await localInferenceProvider.send({ ...request, signal: controller.signal }, apiKey)
  } catch (error) {
    if (parentSignal?.aborted) throw error
    if (controller.signal.aborted) throw new Error(`llama.cpp routing timed out after ${LOCAL_PROVIDER_TIMEOUT_MS}ms`)
    throw error
  } finally {
    clearTimeout(timer)
    parentSignal?.removeEventListener('abort', onParentAbort)
  }
}

function success(response: AIResponse): { success: true; response: AIResponse } {
  return { success: true, response }
}

function currentTurnMessages(request: AIRequest) {
  let latestUserIndex = -1
  request.messages.forEach((message, index) => { if (message.role === 'user') latestUserIndex = index })
  return latestUserIndex >= 0 ? request.messages.slice(latestUserIndex) : request.messages
}

function hasToolResult(request: AIRequest, toolName: string): boolean {
  const turn = currentTurnMessages(request)
  const completedCallIds = new Set(turn
    .filter(message => message.role === 'tool' && typeof message.tool_call_id === 'string')
    .map(message => message.tool_call_id))
  return turn.some(message =>
    message.role === 'assistant' &&
    message.tool_calls?.some(call => call.name === toolName && completedCallIds.has(call.id)),
  )
}

function latestCurrentToolResult(request: AIRequest): { name: string; content: string } | undefined {
  const turn = currentTurnMessages(request)
  const callNamesById = new Map<string, string>()
  for (const message of turn) {
    if (message.role === 'assistant') for (const call of message.tool_calls ?? []) callNamesById.set(call.id, call.name)
  }
  const result = [...turn].reverse().find(message => message.role === 'tool' && message.tool_call_id)
  if (!result?.tool_call_id) return undefined
  return { name: callNamesById.get(result.tool_call_id) || '', content: result.content }
}

function shouldBootstrapRepositoryEvidence(request: AIRequest, providerId: ProviderId): boolean {
  if (providerId !== 'nexus' && providerId !== 'corpus') return false
  if (!request.tools?.some(tool => tool.name === 'github_repo_state')) return false
  if (hasToolResult(request, 'github_repo_state')) return false
  const latestUser = [...request.messages].reverse().find(message => message.role === 'user')
  const text = latestUser?.content ?? ''
  return /repository evidence comes from github tools|\b(repo|repository|codebase|forgeclaw|source|file|branch|commit|github)\b/i.test(text)
}

function shouldBootstrapDeepSeekReasoning(request: AIRequest, providerId: ProviderId): boolean {
  if (providerId !== 'nexus' && providerId !== 'corpus') return false
  if (!request.tools?.some(tool => tool.name === 'deepseek_reason')) return false
  const latestToolResult = latestCurrentToolResult(request)
  if (latestToolResult) return latestToolResult.name !== 'deepseek_reason'

  // In the default CORPUS/NEXUS duo, DeepSeek is the primary reasoning engine
  // even for ordinary prompts. Qwen WebGPU remains the local synthesis/backup.
  return true
}

function buildDeepSeekToolInput(request: AIRequest): { task: string; context?: string } {
  const turn = currentTurnMessages(request)
  const task = [...turn].reverse().find(message => message.role === 'user')?.content || ''
  const callNamesById = new Map<string, string>()
  for (const message of turn) {
    if (message.role === 'assistant') for (const call of message.tool_calls ?? []) callNamesById.set(call.id, call.name)
  }
  const context = turn
    .filter(message => message.role === 'tool' && message.tool_call_id)
    .map(message => `${callNamesById.get(message.tool_call_id!) || 'tool'} result:\n${message.content}`)
    .join('\n\n')
    .slice(-12000)
  return context ? { task, context } : { task }
}

// ─── Router ───────────────────────────────────────────────────────────────

export async function sendViaRouter(
  request: AIRequest,
  apiKey: string,
  providerId: ProviderId = DEFAULT_PROVIDER,
): Promise<{ success: true; response: AIResponse } | { success: false; error: AIError }> {
  const choice = await getBestProvider(apiKey, providerId, request.model || '')
  const selectedProviderId = choice.providerId
  const provider = providers[selectedProviderId]

  if (!provider) {
    return {
      success: false,
      error: {
        class: 'UNKNOWN',
        message: `Unknown provider: ${selectedProviderId}`,
        provider: selectedProviderId,
        retryable: false,
      },
    }
  }

  // Image generation is an explicit external side effect. Do not ask a small
  // local/WebGPU model to decide whether to emit a tool call: malformed prose
  // or token soup must never be rendered as a successful image response.
  const lastUserMessage = [...request.messages].reverse().find(message => message.role === 'user')
  // This check must not depend on request.tools: the WebGPU/manual fallback
  // intentionally strips tools before calling the model, which was the exact
  // path that previously rendered malformed token soup to the user.
  if (lastUserMessage && isImageGenerationRequest(lastUserMessage.content)) {
    const prompt = extractImagePrompt(lastUserMessage.content)
    return success({
      text: '',
      provider: selectedProviderId,
      model: choice.model,
      toolCalls: [{
        id: `direct-image-${Date.now()}`,
        name: 'generate_image',
        input: { prompt, style: inferImageStyle(prompt), width: 512, height: 512 },
      }],
      stopReason: 'direct-image-intent',
    })
  }

  // Repository tasks must establish live evidence before reasoning starts.
  if (shouldBootstrapRepositoryEvidence(request, selectedProviderId)) {
    return success({
      text: '',
      provider: selectedProviderId,
      model: choice.model,
      toolCalls: [{ id: `bootstrap-repo-state-${Date.now()}`, name: 'github_repo_state', input: {} }],
      stopReason: 'deterministic-repository-evidence',
    })
  }

  // Use the existing DeepSeek workflow through executeTool, then let the main
  // NEXUS/CORPUS loop synthesize from its actual result. Repository evidence
  // above always wins as the first tool action when both apply.
  if (shouldBootstrapDeepSeekReasoning(request, selectedProviderId)) {
    return success({
      text: '',
      provider: selectedProviderId,
      model: choice.model,
      toolCalls: [{
        id: `bootstrap-deepseek-${Date.now()}`,
        name: 'deepseek_reason',
        input: buildDeepSeekToolInput(request),
      }],
      stopReason: 'deterministic-deepseek-reasoning',
    })
  }

  if (!provider.isConfigured(apiKey)) {
    return {
      success: false,
      error: {
        class: 'AUTH_FAILURE',
        message: `${provider.label} API key or endpoint required.`,
        provider: selectedProviderId,
        retryable: false,
      },
    }
  }

  try {
    if (selectedProviderId === 'nexus' || selectedProviderId === 'corpus') {
      try {
        return success(await provider.send(requestForWebGpuFallback(request, choice.model), apiKey))
      } catch (primaryError) {
        if (request.signal?.aborted) throw primaryError
        try {
          const response = await provider.send(requestForWebGpuFallback(request, LEGACY_NEXUS_WEBGPU_MODEL), apiKey)
          return success(response)
        } catch (fallbackError) {
          const workflowResult = latestCurrentToolResult(request)
          if (workflowResult?.name === 'deepseek_reason' && !workflowResult.content.startsWith('[TOOL ERROR]')) {
            return success({ text: workflowResult.content, provider: 'deepseek', model: 'deepseek-16b-workflow (6.7B checkpoint)', stopReason: 'webgpu-secondary-unavailable' })
          }
          throw new Error(`WebGPU 3B fallback failed (${primaryError instanceof Error ? primaryError.message : String(primaryError)}); 1.5B fallback failed (${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)})`)
        }
      }
    }

    try {
      const response = selectedProviderId === 'local'
        ? await sendLocalWithTimeout(request, apiKey)
        : await provider.send(request, apiKey)
      return success(response)
    } catch (primaryError) {
      if (selectedProviderId !== 'local' || request.signal?.aborted || !isNexusWebGpuAvailable()) throw primaryError
      try {
        return success(await nexusProvider.send(requestForWebGpuFallback(request, DEFAULT_NEXUS_WEBGPU_MODEL), apiKey))
      } catch (webGpuError) {
        if (request.signal?.aborted) throw webGpuError
        try {
          return success(await nexusProvider.send(requestForWebGpuFallback(request, LEGACY_NEXUS_WEBGPU_MODEL), apiKey))
        } catch (legacyError) {
          throw new Error(`llama.cpp failed (${primaryError instanceof Error ? primaryError.message : String(primaryError)}); WebGPU 3B failed (${webGpuError instanceof Error ? webGpuError.message : String(webGpuError)}); WebGPU 1.5B failed (${legacyError instanceof Error ? legacyError.message : String(legacyError)})`)
        }
      }
    }
  } catch (err) {
    const classified = classifyError(err, selectedProviderId)
    return { success: false, error: classified }
  }
}

// ─── Convenience ──────────────────────────────────────────────────────────

export function isProviderConfigured(apiKey: string = '', providerId: ProviderId = DEFAULT_PROVIDER): boolean {
  return providers[providerId].isConfigured(apiKey)
}

export function providerSupportsTools(modelId: string, providerId: ProviderId = DEFAULT_PROVIDER): boolean {
  const provider = providers[providerId]
  if (!provider) return false
  return provider.supportsTools(modelId)
}

export async function testProviderKey(apiKey: string = '', providerId: ProviderId = DEFAULT_PROVIDER, workspaceId?: string): Promise<void> {
  await providers[providerId].test(apiKey, workspaceId)
}

export { corpusProvider, anthropicProvider, localInferenceProvider, nexusProvider }
