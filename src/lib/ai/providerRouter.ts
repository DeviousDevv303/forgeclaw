// ForgeClaw - Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Claude-only runtime. Other adapters remain dormant for future re-enable.

import type { AIError, AIRequest, AIResponse } from './types'
import { classifyError } from './types'
import { claudeProvider } from './providers/claudeProvider'

export const ACTIVE_PROVIDER = claudeProvider
export const PROVIDER_ORDER = [claudeProvider.id] as const

export type ProviderRuntimeState =
  | 'ANTHROPIC_ONLINE'
  | 'ANTHROPIC_ERROR'
  | 'NO_PROVIDER_CONFIGURED'

export interface ProviderCredentials {
  anthropicKey: string
}

type RuntimeResult =
  | { success: true; response: AIResponse; state: ProviderRuntimeState }
  | { success: false; error: AIError; state: ProviderRuntimeState }

function noClaudeKeyError(): AIError {
  return {
    class: 'UNKNOWN',
    message: 'Claude: no API key - paste your Claude API key starting with sk-ant-',
    provider: claudeProvider.id,
    retryable: false,
  }
}

function claudeError(err: unknown): AIError {
  const classified = classifyError(err, claudeProvider.id)
  let message = classified.message

  if (classified.class === 'AUTH_FAILURE') {
    message = 'Claude authentication failed. Check your Claude API key in Settings.'
  } else if (classified.class === 'RATE_LIMIT') {
    message = 'Claude rate limit or quota hit.'
  } else if (classified.class === 'NETWORK_FAILURE') {
    message = 'Claude unreachable. Check your connection.'
  } else if (classified.class === 'INSUFFICIENT_FUNDS') {
    message = 'Claude account has insufficient quota. Check Claude API billing.'
  }

  return { ...classified, message }
}

export async function sendViaRouter(
  request: AIRequest,
  credentials: ProviderCredentials,
): Promise<RuntimeResult> {
  if (!claudeProvider.isConfigured(credentials.anthropicKey)) {
    return {
      success: false,
      error: noClaudeKeyError(),
      state: 'NO_PROVIDER_CONFIGURED',
    }
  }

  try {
    const response = await claudeProvider.send(
      { ...request, model: request.model || claudeProvider.models[0].id },
      credentials.anthropicKey,
    )
    return { success: true, response, state: 'ANTHROPIC_ONLINE' }
  } catch (err) {
    return {
      success: false,
      error: claudeError(err),
      state: 'ANTHROPIC_ERROR',
    }
  }
}

export function isProviderConfigured(apiKey: string): boolean {
  return claudeProvider.isConfigured(apiKey)
}

export function providerSupportsTools(_modelId: string): boolean {
  return ACTIVE_PROVIDER.supportsTools(_modelId)
}

export async function testProviderKey(apiKey: string): Promise<void> {
  if (!claudeProvider.isConfigured(apiKey)) {
    throw new Error('Claude: no API key - paste your Claude API key starting with sk-ant-')
  }
  await claudeProvider.test(apiKey)
}

export { claudeProvider }
