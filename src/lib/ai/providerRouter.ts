// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Provider Router ───────────────────────────────────────────────────────────
// Multi-provider runtime: OpenRouter + Moonshot (Kimi)

import type { AIRequest, AIResponse, AIError } from './types'
import { classifyError } from './types'
import { openrouterProvider } from './providers/openrouterProvider'
import { moonshotProvider } from './providers/moonshotProvider'

// ─── Registry ─────────────────────────────────────────────────────────────────

export const providers = {
  openrouter: openrouterProvider,
  moonshot: moonshotProvider,
} as const

export type ProviderId = keyof typeof providers

export const ACTIVE_PROVIDER = providers.openrouter
export const CLOUD_PROVIDER = providers.openrouter

export const PROVIDER_CONFIG = {
  primary: providers.openrouter,
  cloud: providers.openrouter,
} as const

// ─── Router ───────────────────────────────────────────────────────────────────

export async function sendViaRouter(
  request: AIRequest,
  apiKey: string,
  providerId: ProviderId = 'openrouter',
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
        message: `${provider.label} API key required.`,
        provider: providerId,
        retryable: false,
      },
    }
  }
  
  try {
    const response = await provider.send(request, apiKey)
    return { success: true, response }
  } catch (err) {
    const classified = classifyError(err, providerId)
    return { success: false, error: classified }
  }
}

// ─── Convenience ────────────────────────────────────────────────────────────

export function isProviderConfigured(apiKey: string = '', providerId: ProviderId = 'openrouter'): boolean {
  return providers[providerId].isConfigured(apiKey)
}

export function providerSupportsTools(modelId: string, providerId: ProviderId = 'openrouter'): boolean {
  return providers[providerId].supportsTools(modelId)
}

export async function testProviderKey(apiKey: string = '', providerId: ProviderId = 'openrouter'): Promise<void> {
  await providers[providerId].test(apiKey)
}

export { openrouterProvider, moonshotProvider }
