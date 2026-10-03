// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Provider Router ────────────────────────────────────────────────────────
// Local-first provider routing: llama.cpp → WebGPU 3B → WebGPU 1.5B.
// The explicit /deepseek command bypasses this router in App.tsx.

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

/** Direct command is level 1 and bypasses this router; ordinary local mode starts at level 2. */
export async function getBestProvider(apiKey: string, preferred: ProviderId = 'local', preferredModel = DEFAULT_LOCAL_MODEL): Promise<ProviderChoice> {
  if (preferred !== 'local') return { providerId: preferred, model: preferredModel, level: 1 }
  if (await localEndpointAvailable(apiKey)) return { providerId: 'local', model: preferredModel, level: 2 }
  if (isNexusWebGpuAvailable()) return { providerId: 'nexus', model: DEFAULT_NEXUS_WEBGPU_MODEL, level: 3 }
  // Keep the explicit configured local endpoint as the honest final error path when WebGPU is unavailable.
  return { providerId: 'local', model: preferredModel, level: 2 }
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

// ─── Router ───────────────────────────────────────────────────────────────

export async function sendViaRouter(
  request: AIRequest,
  apiKey: string,
  providerId: ProviderId = 'local',
): Promise<{ success: true; response: AIResponse } | { success: false; error: AIError }> {
  const choice = await getBestProvider(apiKey, providerId, request.model || DEFAULT_LOCAL_MODEL)
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

export function isProviderConfigured(apiKey: string = '', providerId: ProviderId = 'local'): boolean {
  return providers[providerId].isConfigured(apiKey)
}

export function providerSupportsTools(modelId: string, providerId: ProviderId = 'local'): boolean {
  const provider = providers[providerId]
  if (!provider) return false
  return provider.supportsTools(modelId)
}

export async function testProviderKey(apiKey: string = '', providerId: ProviderId = 'local', workspaceId?: string): Promise<void> {
  await providers[providerId].test(apiKey, workspaceId)
}

export { corpusProvider, anthropicProvider, localInferenceProvider, nexusProvider }
