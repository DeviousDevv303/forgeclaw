// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Provider Router ───────────────────────────────────────────────────────────
// Ollama primary (local), Claude secondary (cloud). Multi-provider architecture ready.

import type { AIRequest, AIResponse, AIError } from './types'
import { classifyError } from './types'
import { claudeProvider } from './providers/claudeProvider'
import { ollamaProvider } from './providers/ollamaProvider'

// ─── Registry ─────────────────────────────────────────────────────────────────

export const ACTIVE_PROVIDER = ollamaProvider
export const CLOUD_PROVIDER = claudeProvider

export const PROVIDER_CONFIG = {
  primary: ollamaProvider,
  cloud: claudeProvider,
} as const

// ─── Router ───────────────────────────────────────────────────────────────────

export async function sendViaRouter(
  request: AIRequest,
  apiKey: string,
): Promise<{ success: true; response: AIResponse } | { success: false; error: AIError }> {
  // 1. Try Ollama first (local, no key needed)
  try {
    const response = await ollamaProvider.send(request, apiKey)
    return { success: true, response }
  } catch (ollamaErr) {
    // Ollama failed — try Claude if key is configured
    if (claudeProvider.isConfigured(apiKey)) {
      try {
        const response = await claudeProvider.send(request, apiKey)
        return { success: true, response }
      } catch (claudeErr) {
        const classified = classifyError(claudeErr, claudeProvider.id)
        return { success: false, error: classified }
      }
    }
    
    // Neither provider available
    const classified = classifyError(ollamaErr, ollamaProvider.id)
    return {
      success: false,
      error: {
        ...classified,
        message: 'Ollama not running. Start it with: ollama serve',
      },
    }
  }
}

// ─── Convenience ────────────────────────────────────────────────────────────

export function isProviderConfigured(apiKey: string = ''): boolean {
  return ollamaProvider.isConfigured() || (apiKey ? claudeProvider.isConfigured(apiKey) : false)
}

export function providerSupportsTools(_modelId: string): boolean {
  return claudeProvider.supportsTools(_modelId)
}

export async function testProviderKey(apiKey: string = ''): Promise<void> {
  if (apiKey && claudeProvider.isConfigured(apiKey)) {
    await claudeProvider.test(apiKey)
  } else {
    await ollamaProvider.test()
  }
}

export { claudeProvider, ollamaProvider }
