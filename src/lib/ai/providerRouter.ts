// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Provider Router ────────────────────────────────────────────────────────
// Multi-provider runtime: Corpus/NEXUS Local + Anthropic + Moonshot (Kimi) + Local

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

// TEMPORARY BYPASS: we are deliberately disabling the autonomous execution/tool stack
// for normal chat while we debug the runaway token/input issue. This keeps the UI in
// a normal Q&A mode and prevents the live execution loop from expanding context before
// the visible answer is rendered.
const NORMAL_CHAT_SYSTEM_PROMPT = `You are ForgeClaw.
Answer the user's latest message directly and naturally.
Do not plan, execute tools, call sub-agents, or emit OBJECTIVE/PLAN/EXECUTION/STATUS headers.
Keep the answer concise and useful.
After the answer, append a brief UI trace:
[FM:TRACE]Direct response; no tools or autonomous execution used.[FM:TRACE_END]`

function normalChatRequest(request: AIRequest): AIRequest {
  const latestUserMessage = [...request.messages].reverse().find(message => message.role === 'user')

  return {
    ...request,
    messages: latestUserMessage ? [latestUserMessage] : request.messages.slice(-1),
    systemPrompt: NORMAL_CHAT_SYSTEM_PROMPT,
    tools: undefined,
  }
}

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
    const response = await provider.send(normalChatRequest(request), apiKey)
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

export function providerSupportsTools(_modelId: string, _providerId: ProviderId = 'local'): boolean {
  // TEMPORARY BYPASS: keep all normal chat requests in plain Q&A mode while the
  // live execution issue is being fixed. We do not want the model to enter the agent loop.
  return false
}

export async function testProviderKey(apiKey: string = '', providerId: ProviderId = 'local', workspaceId?: string): Promise<void> {
  await providers[providerId].test(apiKey, workspaceId)
}

export { corpusProvider, anthropicProvider, moonshotProvider, localInferenceProvider, nexusProvider }
