// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Provider Router ───────────────────────────────────────────────────────────
// OpenRouter primary (cloud), Ollama secondary (local). Multi-provider architecture ready.

import type { AIRequest, AIResponse, AIError } from './types'
import { classifyError } from './types'
import { claudeProvider } from './providers/claudeProvider'
import { ollamaProvider } from './providers/ollamaProvider'
import { openrouterProvider } from './providers/openrouterProvider'

// ─── Registry ─────────────────────────────────────────────────────────────────

export const ACTIVE_PROVIDER = openrouterProvider
export const CLOUD_PROVIDER = openrouterProvider

export const PROVIDER_CONFIG = {
  primary: openrouterProvider,
  cloud: openrouterProvider,
  fallback: ollamaProvider,
} as const

// ─── Router ───────────────────────────────────────────────────────────────────

export async function sendViaRouter(
  request: AIRequest,
  apiKey: string,
): Promise<{ success: true; response: AIResponse } | { success: false; error: AIError }> {
  // 1. Try OpenRouter first (cloud, key needed)
  if (openrouterProvider.isConfigured(apiKey)) {
    try {
      const response = await openrouterProvider.send(request, apiKey)
      return { success: true, response }
    } catch (orErr) {
      // OpenRouter failed — try Ollama as fallback
      try {
        const response = await ollamaProvider.send(request, apiKey)
        return { success: true, response }
      } catch (ollamaErr) {
        const classified = classifyError(orErr, openrouterProvider.id)
        return { success: false, error: classified }
      }
    }
  }

  // 2. Try Ollama if OpenRouter not configured
  try {
    const response = await ollamaProvider.send(request, apiKey)
    return { success: true, response }
  } catch (ollamaErr) {
    const classified = classifyError(ollamaErr, ollamaProvider.id)
    return {
      success: false,
      error: {
        ...classified,
        message: 'OpenRouter not configured (sk-or-...) and Ollama not running.',
      },
    }
  }
}

// ─── Convenience ────────────────────────────────────────────────────────────

export function isProviderConfigured(apiKey: string = ''): boolean {
  return openrouterProvider.isConfigured(apiKey) || ollamaProvider.isConfigured('')
}

export function providerSupportsTools(_modelId: string): boolean {
  return openrouterProvider.supportsTools(_modelId)
}

export async function testProviderKey(apiKey: string = ''): Promise<void> {
  if (apiKey && openrouterProvider.isConfigured(apiKey)) {
    await openrouterProvider.test(apiKey)
  } else {
    await ollamaProvider.test('')
  }
}

export { claudeProvider, ollamaProvider, openrouterProvider }
