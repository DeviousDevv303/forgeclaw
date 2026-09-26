// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Provider Router ────────────────────────────────────────────────────────
// Multi-provider runtime: Corpus/NEXUS Local + Anthropic + Moonshot (Kimi) + Local
// Tool authority restored: requests pass through with tools/system prompt intact.
// NEXUS/Corpus WebGPU report supportsTools=false; App uses manual tool mode.

import type { AIRequest, AIResponse, AIError } from './types'
import { classifyError } from './types'
import { anthropicProvider } from './providers/anthropicProvider'
import { moonshotProvider } from './providers/moonshotProvider'
import { localInferenceProvider } from './providers/localInferenceProvider'
import { corpusProvider } from './providers/corpusProvider'
import { nexusProvider } from './providers/nexusProvider'

// ─── Registry ───────────────────────────────────────────────────────────────

export const providers = {
  corpus: corpusProvider,
  anthropic: anthropicProvider,
  moonshot: moonshotProvider,
  local: localInferenceProvider,
  nexus: nexusProvider,
} as const

export type ProviderId = keyof typeof providers

// ─── Router ───────────────────────────────────────────────────────────────

export async function sendViaRouter(
  request: AIRequest,
  apiKey: string,
  providerId: ProviderId = 'local',
): Promise<{ success: true; response: AIResponse } | { success: false; error: AIError }> {
  const provider = providers[providerId]

  if (!provider) {
    return {
      success: false,
      error: {
        class: 'UNKNOWN' as const,
        message: `Unknown provider: ${providerId}`,
        provider: providerId,
        retryable: false,
      },
    }
  }

  if (!provider.isConfigured(apiKey)) {
    return {
      success: false,
      error: {
        class: 'AUTH_FAILURE' as const,
        message: `${provider.label} API key or endpoint required.`,
        provider: providerId,
        retryable: false,
      },
    }
  }

  try {
    // Pass the request as-is. Providers that lack native tool support
    // (NEXUS/Corpus WebGPU) ignore tools and rely on manual tool mode in App.
    const response = await provider.send(request, apiKey)
    return { success: true, response }
  } catch (err) {
    const classified = classifyError(err, providerId)
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

export { corpusProvider, anthropicProvider, moonshotProvider, localInferenceProvider, nexusProvider }
