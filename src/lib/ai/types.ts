// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── AI Provider Types ───────────────────────────────────────────────────────

export interface AIRequest {
  systemPrompt: string
  messages: AIMessage[]
  model: string
  maxTokens?: number
  tools?: AIToolDef[]
  onToken?: (token: string) => void
  signal?: AbortSignal
  workspaceId?: string
  /** UI language selected in the header ('en' | 'es' | 'ru' | 'zh'); forwarded to providers without a system-prompt channel. */
  responseLanguage?: string
}

export interface AIMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  image_url?: string
  tool_call_id?: string
  tool_calls?: AIToolCall[]
  /** Kimi thinking output from the turn that made tool_calls; Moonshot needs it sent back in tool-call loops. */
  reasoning_content?: string
  /** OpenRouter reasoning blocks from the turn that made tool_calls, sent back as returned (signatures included). */
  reasoning_details?: unknown[]
}

export interface AIToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface AIToolCall {
  id: string
  name: string
  input: Record<string, unknown>
  /** Set when the model's arguments were not valid JSON or were cut off by the output limit; the call must not run. */
  parseError?: string
}

export interface SecondarySynthesisAttempt {
  model: string
  stage: string
  message: string
}

export interface SecondarySynthesisDiagnostic {
  status: 'fallback-model-used' | 'unavailable'
  attempts: SecondarySynthesisAttempt[]
}

export interface PrimaryReasoningDiagnostic {
  status: 'failed'
  stage: string
  message: string
}

export interface AIResponse {
  text: string
  provider: string
  model: string
  toolCalls?: AIToolCall[]
  stopReason?: string
  /** Provider reasoning text (Kimi reasoning_content). Never shown as the answer. */
  reasoningContent?: string
  /** OpenRouter's structured reasoning blocks, kept only to send back on the next tool-call turn. */
  reasoningDetails?: unknown[]
  diagnostics?: {
    primaryReasoning?: PrimaryReasoningDiagnostic
    secondarySynthesis?: SecondarySynthesisDiagnostic
  }
}

export interface AIProvider {
  id: string
  label: string
  requiresKey: boolean
  models: Array<{ id: string; label: string; contextK: number; note?: string }>
  isConfigured(apiKey: string): boolean | Promise<boolean>
  supportsTools(modelId: string): boolean
  send(request: AIRequest, apiKey: string): Promise<AIResponse>
  test(apiKey: string, workspaceId?: string): Promise<void>
}

export type AIErrorClass =
  | 'AUTH_FAILURE'
  | 'RATE_LIMIT'
  | 'NETWORK_FAILURE'
  | 'CONTENT_POLICY'
  | 'INSUFFICIENT_FUNDS'
  | 'UNKNOWN'

export interface AIError {
  class: AIErrorClass
  message: string
  provider: string
  retryable: boolean
}

export function classifyError(err: unknown, provider: string): AIError {
  const msg = err instanceof Error ? err.message : String(err)
  const lower = msg.toLowerCase()

  if (/invalid.*(auth|api.?key|token)|unauthorized|authentication|401|incorrect api key|bad request.*api key/i.test(lower)) {
    return { class: 'AUTH_FAILURE', message: msg, provider, retryable: false }
  }
  if (/rate.?limit|429|too many requests|quota exceeded/i.test(lower)) {
    return { class: 'RATE_LIMIT', message: msg, provider, retryable: true }
  }
  if (/failed to fetch|networkerror|net::err|timeout|econnrefused|dns/i.test(lower)) {
    return { class: 'NETWORK_FAILURE', message: msg, provider, retryable: true }
  }
  if (/content.?policy|safety|moderation|blocked|content filter|harmful/i.test(lower)) {
    return { class: 'CONTENT_POLICY', message: msg, provider, retryable: false }
  }
  if (/insufficient_quota|billing|payment|out of credits/i.test(lower)) {
    return { class: 'INSUFFICIENT_FUNDS', message: msg, provider, retryable: false }
  }

  return { class: 'UNKNOWN', message: msg, provider, retryable: false }
}
