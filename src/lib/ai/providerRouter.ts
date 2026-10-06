// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Provider Router ────────────────────────────────────────────────────────
// The default duo is CORPUS/NEXUS with DeepSeek as primary reasoner.
// Side effects stay ForgeTools-dispatched; Qwen WebGPU is secondary synthesis/fallback.

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
  isWebGpuDeviceLossError,
  sanitizeNexusWebGpuDiagnostic,
} from './providers/nexusWebGpuProvider'
import { injectToolSchemaWithinBudget } from './manualToolMode'
import { MAX_NEXUS_CONTEXT_TOKENS } from './nexusContext'
import { extractImagePrompt, inferImageStyle, isImageGenerationRequest } from '../imageRequest'
import { DEFAULT_PROVIDER } from '../providerDefaults'
import { buildDeepSeekTaskPayload, extractOriginalDeepSeekTask } from './deepseekContext'
import { CODING_READONLY_TOOL_NAMES } from '../managedAgent'

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

// NEXUS/WebGPU secondary synthesis (including first-time model load) is
// browser-local and can stall indefinitely — a failed primary reasoner must
// still reach a terminal UI state instead of leaving the user on "Processing…".
// Bounded generously so a legitimately slow generation still completes.
export const SECONDARY_SYNTHESIS_TIMEOUT_MS = 8 * 60 * 1000

type Provider = (typeof providers)[ProviderId]

/** Send through a local/WebGPU provider that must never run unbounded. */
async function sendSecondaryWithTimeout(
  provider: Provider,
  request: AIRequest,
  apiKey: string,
  label: string,
): Promise<AIResponse> {
  if (request.signal?.aborted) throw new DOMException('Generation aborted', 'AbortError')
  const controller = new AbortController()
  const parentSignal = request.signal
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let onParentAbort: (() => void) | undefined

  // WebLLM can spend minutes inside engine initialization / shader compilation
  // without observing an AbortSignal. Aborting alone therefore did not bound
  // this await and allowed the chat UI to remain on "Processing…" forever.
  // Race the provider promise against a real deadline and parent cancellation;
  // the signal is still aborted so providers that support cancellation stop too.
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      controller.abort()
      reject(new Error(`${label} timed out after ${Math.round(SECONDARY_SYNTHESIS_TIMEOUT_MS / 60000)}m`))
    }, SECONDARY_SYNTHESIS_TIMEOUT_MS)
  })
  const cancelled = new Promise<never>((_, reject) => {
    onParentAbort = () => {
      controller.abort()
      reject(new DOMException('Generation aborted', 'AbortError'))
    }
    parentSignal?.addEventListener('abort', onParentAbort, { once: true })
  })

  try {
    return await Promise.race([
      provider.send({ ...request, signal: controller.signal }, apiKey),
      deadline,
      cancelled,
    ])
  } catch (error) {
    if (parentSignal?.aborted) throw error
    if (timedOut) {
      throw new Error(`${label} timed out after ${Math.round(SECONDARY_SYNTHESIS_TIMEOUT_MS / 60000)}m`)
    }
    throw error
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    if (onParentAbort) parentSignal?.removeEventListener('abort', onParentAbort)
  }
}

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

/** Explicit Local Inference detection may use NEXUS as a fallback; it never changes the default. */
export async function detectBestProvider(apiKey = '', preferredModel = DEFAULT_LOCAL_MODEL): Promise<ProviderChoice> {
  if (await localEndpointAvailable(apiKey)) return { providerId: 'local', model: preferredModel, level: 2 }
  if (isNexusWebGpuAvailable()) return { providerId: 'nexus', model: DEFAULT_NEXUS_WEBGPU_MODEL, level: 3 }
  return { providerId: 'local', model: preferredModel, level: 2 }
}

/** Explicit provider choices are honored; only an explicit Local Inference choice uses endpoint detection. */
export async function getBestProvider(apiKey: string, preferred: ProviderId = DEFAULT_PROVIDER, preferredModel = ''): Promise<ProviderChoice> {
  if (preferred !== 'local') {
    const model = preferredModel || providers[preferred].models[0]?.id || DEFAULT_NEXUS_WEBGPU_MODEL
    return { providerId: preferred, model, level: 1 }
  }
  return detectBestProvider(apiKey, preferredModel || DEFAULT_LOCAL_MODEL)
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

function currentTurnMessages(request: AIRequest) {
  let latestUserIndex = -1
  request.messages.forEach((message, index) => { if (message.role === 'user') latestUserIndex = index })
  return latestUserIndex >= 0 ? request.messages.slice(latestUserIndex) : request.messages
}

function hasToolResult(request: AIRequest, toolName: string): boolean {
  const turn = currentTurnMessages(request)
  const completedCallIds = new Set(turn
    .filter(message => message.role === 'tool' && typeof message.tool_call_id === 'string')
    .map(message => message.tool_call_id))
  return turn.some(message =>
    message.role === 'assistant' &&
    message.tool_calls?.some(call => call.name === toolName && completedCallIds.has(call.id)),
  )
}

function latestCurrentToolResult(request: AIRequest): { name: string; content: string } | undefined {
  const turn = currentTurnMessages(request)
  const callNamesById = new Map<string, string>()
  for (const message of turn) {
    if (message.role === 'assistant') for (const call of message.tool_calls ?? []) callNamesById.set(call.id, call.name)
  }
  const result = [...turn].reverse().find(message => message.role === 'tool' && message.tool_call_id)
  if (!result?.tool_call_id) return undefined
  return { name: callNamesById.get(result.tool_call_id) || '', content: result.content }
}

// Repository inspection results are already grounded, deterministic answers.
// A direct tool-only turn should surface that exact evidence instead of asking
// DeepSeek to embellish it. Keep task-state persistence out of this factual set;
// it is classified read-only for capability budgeting but is not a read result.
const DIRECT_FACT_READ_TOOL_NAMES = new Set(CODING_READONLY_TOOL_NAMES.filter(name => name !== 'coding_task_update'))

function hasDeepSeekCall(request: AIRequest): boolean {
  return currentTurnMessages(request).some(message =>
    message.role === 'assistant' && message.tool_calls?.some(call => call.name === 'deepseek_reason'),
  )
}

function latestSuccessfulDirectFactResult(request: AIRequest): { name: string; content: string } | undefined {
  const turn = currentTurnMessages(request)
  const callNamesById = new Map<string, string>()
  for (const message of turn) {
    if (message.role === 'assistant') for (const call of message.tool_calls ?? []) callNamesById.set(call.id, call.name)
  }
  const result = [...turn].reverse().find(message => message.role === 'tool' && message.tool_call_id)
  if (result?.role !== 'tool' || !result.tool_call_id) return undefined
  const name = callNamesById.get(result.tool_call_id) || ''
  const content = result.content.trim()
  if (!DIRECT_FACT_READ_TOOL_NAMES.has(name) || !content) return undefined
  if (/^\[(?:TOOL ERROR|GUARDIAN BLOCKED?|GUARDIAN REJECTED)\]/i.test(content)) return undefined
  // github_verify_commit can return an ordinary text failure instead of a
  // [TOOL ERROR], so only its positive verification response is evidence.
  if (name === 'github_verify_commit' && !content.startsWith('✓ VERIFIED —')) return undefined
  return { name, content: result.content }
}

function failedDeepSeekToolResult(request: AIRequest): { name: string; content: string } | undefined {
  const turn = currentTurnMessages(request)
  const callNamesById = new Map<string, string>()
  for (const message of turn) {
    if (message.role === 'assistant') for (const call of message.tool_calls ?? []) callNamesById.set(call.id, call.name)
  }
  const result = [...turn].reverse().find(message => {
    if (message.role !== 'tool' || !message.tool_call_id || callNamesById.get(message.tool_call_id) !== 'deepseek_reason') return false
    return !isSuccessfulDeepSeekToolResult(message.content)
  })
  return result?.role === 'tool' ? { name: 'deepseek_reason', content: result.content } : undefined
}

function secondarySynthesisAttempt(model: string, error: unknown) {
  const rawMessage = error instanceof Error ? error.message : String(error)
  const taggedStage = rawMessage.match(/NEXUS_WEBGPU_FAILURE stage=([a-z-]+)/)?.[1]
  const stage = taggedStage || (/timed out/i.test(rawMessage) ? 'timeout' : 'unknown')
  return { model, stage, message: sanitizeNexusWebGpuDiagnostic(error) }
}

function shouldSkipLegacyAfterPrimaryFailure(attempt: { stage: string; message: string }): boolean {
  // The legacy checkpoint shares the same browser adapter/runtime. Do not launch
  // a second download/engine while the first timed-out load may still be running.
  if (['timeout', 'webgpu-detection', 'webgpu-capability', 'webllm-import'].includes(attempt.stage)) {
    return true
  }
  // A dead GPU device/instance cannot serve the legacy model either. Fail fast
  // instead of stalling through a second doomed load + 8-minute timeout.
  if (isWebGpuDeviceLossError(attempt.message)) {
    return true
  }
  return false
}

const CLEAN_DEEPSEEK_FALLBACK_SYSTEM_PROMPT = [
  "You are ForgeClaw's local NEXUS/Qwen fallback. The primary reasoning service did not return a usable result.",
  'Answer only the original user request in the single user message below. You have no tools and no repository, workflow, or external-action evidence.',
  'Never claim that DeepSeek, a tool, a workflow, or an external action succeeded. Do not mention or reproduce internal error messages.',
  'For factual or scientific topics, distinguish established evidence from hypothesis, metaphor, or creative framing.',
  "Honor ForgeClaw's motive of Love by respecting dignity and emotional autonomy; do not exploit vulnerabilities or claim to know the user's innermost triggers.",
  'If necessary evidence is absent, state plainly what cannot be verified rather than guessing.',
].join(' ')

function isGuardianBlockedResult(content: string): boolean {
  return /^\s*\[GUARDIAN (?:BLOCKED?|REJECTED)\]/i.test(content)
}

function isSuccessfulDeepSeekToolResult(content: string): boolean {
  return content.startsWith('✓ DeepSeek-16B completed as ')
}

function deepSeekCheckpointLabel(content: string): string {
  return content.match(/\bcheckpoint=([^\s;]+)/i)?.[1] || 'checkpoint metadata unavailable'
}

function primaryReasoningFailure(content: string) {
  const message = sanitizeNexusWebGpuDiagnostic(content.replace(/^\s*\[TOOL ERROR\]\s*/i, '').trim())
  const stage = message.match(/\b(deepseek-[a-z-]+)(?=\s|:)/i)?.[1] || (/github read timed out/i.test(message) ? 'github-read-unclassified' : 'unknown')
  return { status: 'failed' as const, stage, message: message.slice(0, 500) }
}

function cleanOriginalTaskRequest(
  request: AIRequest,
  model: string,
  primaryFailure?: { stage: string; message: string },
): AIRequest | null {
  const originalUserMessage = [...currentTurnMessages(request)].reverse().find(message => message.role === 'user')
  const task = extractOriginalDeepSeekTask(originalUserMessage?.content ?? '')
  if (!task) return null
  // Tell the fallback model what went wrong so it avoids repeating the pattern
  // (e.g. repetitive loops, transport timeout). Additive only; the base prompt
  // is unchanged when no failure context is available.
  const systemPrompt = primaryFailure
    ? `${CLEAN_DEEPSEEK_FALLBACK_SYSTEM_PROMPT} Primary reasoner failed at stage "${primaryFailure.stage}": ${primaryFailure.message.slice(0, 200)}. Do not repeat this failure pattern.`
    : CLEAN_DEEPSEEK_FALLBACK_SYSTEM_PROMPT
  return {
    model,
    systemPrompt,
    messages: [{ role: 'user', content: task }],
    maxTokens: Math.min(request.maxTokens ?? 512, 768),
    signal: request.signal,
  }
}

async function sendCleanFallbackAfterDeepSeekFailure(
  request: AIRequest,
  apiKey: string,
  primaryFailure: ReturnType<typeof primaryReasoningFailure>,
): Promise<AIResponse> {
  const cleanRequest = cleanOriginalTaskRequest(request, DEFAULT_NEXUS_WEBGPU_MODEL, primaryFailure)
  if (!cleanRequest) throw new Error(`DeepSeek primary failed at ${primaryFailure.stage}; the original user request was unavailable for a clean fallback.`)

  let preferredError: unknown
  let preferredAttempt: ReturnType<typeof secondarySynthesisAttempt> | undefined
  try {
    const response = await sendSecondaryWithTimeout(nexusProvider, cleanRequest, apiKey, 'Clean-request Qwen fallback')
    return { ...response, stopReason: 'clean-fallback-no-tools', diagnostics: { primaryReasoning: primaryFailure } }
  } catch (error) {
    if (request.signal?.aborted) throw error
    preferredError = error
    preferredAttempt = secondarySynthesisAttempt(DEFAULT_NEXUS_WEBGPU_MODEL, error)
    if (shouldSkipLegacyAfterPrimaryFailure(preferredAttempt)) {
      throw new Error(`DeepSeek primary failed at ${primaryFailure.stage}: ${primaryFailure.message}; clean Qwen fallback failed at ${preferredAttempt.stage}: ${preferredAttempt.message}`)
    }
  }

  const legacyRequest = cleanOriginalTaskRequest(request, LEGACY_NEXUS_WEBGPU_MODEL, primaryFailure)
  if (!legacyRequest) throw preferredError
  try {
    const response = await sendSecondaryWithTimeout(nexusProvider, legacyRequest, apiKey, 'Clean-request Qwen legacy fallback')
    return {
      ...response,
      stopReason: 'clean-fallback-no-tools',
      diagnostics: {
        primaryReasoning: primaryFailure,
        secondarySynthesis: { status: 'fallback-model-used', attempts: [preferredAttempt!] },
      },
    }
  } catch (legacyError) {
    if (request.signal?.aborted) throw legacyError
    const legacyAttempt = secondarySynthesisAttempt(LEGACY_NEXUS_WEBGPU_MODEL, legacyError)
    throw new Error(`DeepSeek primary failed at ${primaryFailure.stage}: ${primaryFailure.message}; clean Qwen fallback failed at ${preferredAttempt!.stage}: ${preferredAttempt!.message}; Qwen 1.5B clean fallback failed at ${legacyAttempt.stage}: ${legacyAttempt.message}`)
  }
}

function shouldBootstrapRepositoryEvidence(request: AIRequest, providerId: ProviderId): boolean {
  if (providerId !== 'nexus' && providerId !== 'corpus') return false
  if (!request.tools?.some(tool => tool.name === 'github_repo_state')) return false
  if (hasToolResult(request, 'github_repo_state')) return false
  const latestUser = [...request.messages].reverse().find(message => message.role === 'user')
  const text = latestUser?.content ?? ''
  return /repository evidence comes from github tools|\b(repo|repository|codebase|forgeclaw|source|file|branch|commit|github)\b/i.test(text)
}

function shouldBootstrapDeepSeekReasoning(request: AIRequest, providerId: ProviderId): boolean {
  if (providerId !== 'nexus' && providerId !== 'corpus') return false
  if (!request.tools?.some(tool => tool.name === 'deepseek_reason')) return false
  if (failedDeepSeekToolResult(request)) return false
  const latestToolResult = latestCurrentToolResult(request)
  if (latestToolResult) return latestToolResult.name !== 'deepseek_reason'

  // In the default CORPUS/NEXUS duo, DeepSeek is the primary reasoning engine
  // even for ordinary prompts. Qwen WebGPU remains the local synthesis/backup.
  return true
}

function buildDeepSeekToolInput(request: AIRequest): { task: string; context?: string } {
  const turn = currentTurnMessages(request)
  const rawTask = [...turn].reverse().find(message => message.role === 'user')?.content || ''
  const callNamesById = new Map<string, string>()
  for (const message of turn) {
    if (message.role === 'assistant') for (const call of message.tool_calls ?? []) callNamesById.set(call.id, call.name)
  }
  const verifiedToolResults = turn
    .filter(message => message.role === 'tool' && message.tool_call_id && !/^\s*(?:\[TOOL ERROR\]|\[GUARDIAN (?:BLOCKED?|REJECTED)\])/i.test(message.content))
    .map(message => `${callNamesById.get(message.tool_call_id!) || 'tool'} result:\n${message.content}`)
    .join('\n\n')
  return buildDeepSeekTaskPayload(rawTask, verifiedToolResults)
}

// ─── Router ───────────────────────────────────────────────────────────────

export async function sendViaRouter(
  request: AIRequest,
  apiKey: string,
  providerId: ProviderId = DEFAULT_PROVIDER,
): Promise<{ success: true; response: AIResponse } | { success: false; error: AIError }> {
  const choice = await getBestProvider(apiKey, providerId, request.model || '')
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

  // Image generation is an explicit external side effect. Do not ask a small
  // local/WebGPU model to decide whether to emit a tool call: malformed prose
  // or token soup must never be rendered as a successful image response.
  const lastUserMessage = [...request.messages].reverse().find(message => message.role === 'user')
  // This check must not depend on request.tools: the WebGPU/manual fallback
  // intentionally strips tools before calling the model, which was the exact
  // path that previously rendered malformed token soup to the user.
  if (lastUserMessage && isImageGenerationRequest(lastUserMessage.content)) {
    const prompt = extractImagePrompt(lastUserMessage.content)
    return success({
      text: '',
      provider: selectedProviderId,
      model: choice.model,
      toolCalls: [{
        id: `direct-image-${Date.now()}`,
        name: 'generate_image',
        input: { prompt, style: inferImageStyle(prompt), width: 512, height: 512 },
      }],
      stopReason: 'direct-image-intent',
    })
  }

  const priorDeepSeekResult = latestCurrentToolResult(request)
  if ((selectedProviderId === 'nexus' || selectedProviderId === 'corpus') && priorDeepSeekResult?.name === 'deepseek_reason' && isGuardianBlockedResult(priorDeepSeekResult.content)) {
    const error = classifyError(new Error(`Guardian blocked the DeepSeek reasoning step; no local model fallback was started. ${priorDeepSeekResult.content.slice(0, 300)}`), selectedProviderId)
    return { success: false, error }
  }

  // When a read-only factual tool was the direct action in this turn, its
  // successful result is the answer. Do not send it to DeepSeek for unsolicited
  // narration or claims that are absent from the evidence. If DeepSeek itself
  // initiated a read mid-reasoning, preserve that established continuation.
  const directFactResult = latestSuccessfulDirectFactResult(request)
  if ((selectedProviderId === 'nexus' || selectedProviderId === 'corpus') && directFactResult && !hasDeepSeekCall(request)) {
    return success({
      text: directFactResult.content,
      provider: selectedProviderId,
      model: choice.model,
      stopReason: 'direct-readonly-tool-result',
    })
  }

  // DeepSeek is the primary reasoner. After its real result, a repository task
  // can obtain live GitHub evidence, then invoke a continuation with successful
  // tool results only. Qwen remains secondary synthesis/fallback.
  if (shouldBootstrapDeepSeekReasoning(request, selectedProviderId)) {
    return success({
      text: '',
      provider: selectedProviderId,
      model: choice.model,
      toolCalls: [{
        id: `bootstrap-deepseek-${Date.now()}`,
        name: 'deepseek_reason',
        input: buildDeepSeekToolInput(request),
      }],
      stopReason: 'deterministic-deepseek-reasoning',
    })
  }

  // Safe, read-only repository evidence follows primary reasoning in the
  // default duo. If primary reasoning failed, this can still collect the
  // explicitly requested evidence before a clean, tool-free Qwen fallback.
  if (shouldBootstrapRepositoryEvidence(request, selectedProviderId)) {
    return success({
      text: '',
      provider: selectedProviderId,
      model: choice.model,
      toolCalls: [{ id: `bootstrap-repo-state-${Date.now()}`, name: 'github_repo_state', input: {} }],
      stopReason: 'deterministic-repository-evidence',
    })
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
    const failedPrimary = failedDeepSeekToolResult(request)
    if ((selectedProviderId === 'nexus' || selectedProviderId === 'corpus') && failedPrimary) {
      const primaryFailure = primaryReasoningFailure(failedPrimary.content)
      return success(await sendCleanFallbackAfterDeepSeekFailure(request, apiKey, primaryFailure))
    }

    if (selectedProviderId === 'nexus' || selectedProviderId === 'corpus') {
      try {
        return success(await sendSecondaryWithTimeout(provider, requestForWebGpuFallback(request, choice.model), apiKey, 'WebGPU secondary synthesis'))
      } catch (primaryError) {
        if (request.signal?.aborted) throw primaryError
        const primaryAttempt = secondarySynthesisAttempt(choice.model, primaryError)
        const workflowResult = latestCurrentToolResult(request)
        if (shouldSkipLegacyAfterPrimaryFailure(primaryAttempt)) {
          if (workflowResult?.name === 'deepseek_reason' && isSuccessfulDeepSeekToolResult(workflowResult.content)) {
            return success({
              text: workflowResult.content,
              provider: 'deepseek',
              model: `DeepSeek Actions (${deepSeekCheckpointLabel(workflowResult.content)})`,
              stopReason: 'webgpu-secondary-unavailable',
              diagnostics: { secondarySynthesis: { status: 'unavailable', attempts: [primaryAttempt] } },
            })
          }
          throw primaryError
        }
        try {
          const response = await sendSecondaryWithTimeout(provider, requestForWebGpuFallback(request, LEGACY_NEXUS_WEBGPU_MODEL), apiKey, 'WebGPU legacy secondary synthesis')
          return success({
            ...response,
            diagnostics: {
              ...response.diagnostics,
              secondarySynthesis: { status: 'fallback-model-used', attempts: [primaryAttempt] },
            },
          })
        } catch (fallbackError) {
          const fallbackAttempt = secondarySynthesisAttempt(LEGACY_NEXUS_WEBGPU_MODEL, fallbackError)
          if (workflowResult?.name === 'deepseek_reason' && isSuccessfulDeepSeekToolResult(workflowResult.content)) {
            return success({
              text: workflowResult.content,
              provider: 'deepseek',
              model: `DeepSeek Actions (${deepSeekCheckpointLabel(workflowResult.content)})`,
              stopReason: 'webgpu-secondary-unavailable',
              diagnostics: { secondarySynthesis: { status: 'unavailable', attempts: [primaryAttempt, fallbackAttempt] } },
            })
          }
          throw new Error(`WebGPU 3B failed (${primaryAttempt.message}); 1.5B failed (${fallbackAttempt.message})`)
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
        return success(await sendSecondaryWithTimeout(nexusProvider, requestForWebGpuFallback(request, DEFAULT_NEXUS_WEBGPU_MODEL), apiKey, 'WebGPU secondary synthesis'))
      } catch (webGpuError) {
        if (request.signal?.aborted) throw webGpuError
        try {
          return success(await sendSecondaryWithTimeout(nexusProvider, requestForWebGpuFallback(request, LEGACY_NEXUS_WEBGPU_MODEL), apiKey, 'WebGPU legacy secondary synthesis'))
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

export function isProviderConfigured(apiKey: string = '', providerId: ProviderId = DEFAULT_PROVIDER): boolean {
  return providers[providerId].isConfigured(apiKey)
}

export function providerSupportsTools(modelId: string, providerId: ProviderId = DEFAULT_PROVIDER): boolean {
  const provider = providers[providerId]
  if (!provider) return false
  return provider.supportsTools(modelId)
}

export async function testProviderKey(apiKey: string = '', providerId: ProviderId = DEFAULT_PROVIDER, workspaceId?: string): Promise<void> {
  await providers[providerId].test(apiKey, workspaceId)
}

export { corpusProvider, anthropicProvider, localInferenceProvider, nexusProvider }
