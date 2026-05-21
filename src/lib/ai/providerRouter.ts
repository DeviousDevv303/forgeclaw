// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Provider Router ───────────────────────────────────────────────────────────
// OpenRouter primary (cloud). Multi-provider architecture ready.

import type { AIRequest, AIResponse, AIError } from './types'
import { classifyError } from './types'
import { openrouterProvider } from './providers/openrouterProvider'

// ─── Registry ─────────────────────────────────────────────────────────────────

export const ACTIVE_PROVIDER = openrouterProvider
export const CLOUD_PROVIDER = openrouterProvider

export const PROVIDER_CONFIG = {
  primary: openrouterProvider,
  cloud: openrouterProvider,
} as const

// ─── Router ───────────────────────────────────────────────────────────────────

export async function sendViaRouter(
  request: AIRequest,
  apiKey: string,
): Promise<{ success: true; response: AIResponse } | { success: false; error: AIError }> {
  // OpenRouter only
  if (openrouterProvider.isConfigured(apiKey)) {
    try {
      const response = await openrouterProvider.send(request, apiKey)
      return { success: true, response }
    } catch (err) {
      const classified = classifyError(err, openrouterProvider.id)
      return { success: false, error: classified }
    }
  }
  
  return {
    success: false,
    error: {
      class: 'AUTH_FAILURE' as const,
      message: 'OpenRouter API key required. Get one at openrouter.ai (sk-or-... format)',
      provider: openrouterProvider.id,
      retryable: false,
    },
  }
}

// ─── Convenience ────────────────────────────────────────────────────────────

export function isProviderConfigured(apiKey: string = ''): boolean {
  return openrouterProvider.isConfigured(apiKey)
}

export function providerSupportsTools(_modelId: string): boolean {
  return openrouterProvider.supportsTools(_modelId)
}

export async function testProviderKey(apiKey: string = ''): Promise<void> {
  await openrouterProvider.test(apiKey)
}

export { openrouterProvider }