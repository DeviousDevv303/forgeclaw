// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Provider Router ───────────────────────────────────────────────────────────
// Claude primary, multi-provider architecture ready for future expansion.

import type { AIRequest, AIResponse, AIError } from './types'
import { classifyError } from './types'
import { claudeProvider } from './providers/claudeProvider'

// ─── Registry ─────────────────────────────────────────────────────────────────

export const ACTIVE_PROVIDER = claudeProvider

export const PROVIDER_CONFIG = {
  primary: claudeProvider,
} as const

// ─── Router ───────────────────────────────────────────────────────────────────

export async function sendViaRouter(
  request: AIRequest,
  apiKey: string,
): Promise<{ success: true; response: AIResponse } | { success: false; error: AIError }> {
  // 1. Key check
  if (!ACTIVE_PROVIDER.isConfigured(apiKey)) {
    return {
      success: false,
      error: {
        class: 'AUTH_FAILURE',
        message: 'Claude: no API key — paste one in Settings (sk-ant-...)',
        provider: ACTIVE_PROVIDER.id,
        retryable: false,
      },
    }
  }

  // 2. Send
  try {
    const response = await ACTIVE_PROVIDER.send(request, apiKey)
    return { success: true, response }
  } catch (err) {
    const classified = classifyError(err, ACTIVE_PROVIDER.id)

    // Enhance message for user readability
    let message = classified.message
    if (classified.class === 'AUTH_FAILURE') {
      message = `${ACTIVE_PROVIDER.label} authentication failed. Check your API key in Settings.`
    } else if (classified.class === 'RATE_LIMIT') {
      message = `${ACTIVE_PROVIDER.label} rate limit hit. Wait a moment and retry.`
    } else if (classified.class === 'NETWORK_FAILURE') {
      message = `${ACTIVE_PROVIDER.label} unreachable. Check your connection.`
    } else if (classified.class === 'INSUFFICIENT_FUNDS') {
      message = `${ACTIVE_PROVIDER.label} account has insufficient quota. Add billing or switch model.`
    }

    return {
      success: false,
      error: { ...classified, message },
    }
  }
}

// ─── Convenience ────────────────────────────────────────────────────────────

export function isProviderConfigured(apiKey: string): boolean {
  return ACTIVE_PROVIDER.isConfigured(apiKey)
}

export function providerSupportsTools(_modelId: string): boolean {
  return ACTIVE_PROVIDER.supportsTools(_modelId)
}

export async function testProviderKey(apiKey: string): Promise<void> {
  if (!ACTIVE_PROVIDER.isConfigured(apiKey)) {
    throw new Error('API key not configured')
  }
  await ACTIVE_PROVIDER.test(apiKey)
}

export { claudeProvider }
