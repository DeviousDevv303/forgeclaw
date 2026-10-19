// ForgeClaw — DeepSeek 16B GitHub Actions is the canonical reasoning runtime.
import type { AIRequest, AIResponse, AIError } from './types'
import { classifyError } from './types'
import { anthropicProvider } from './providers/anthropicProvider'
import { moonshotProvider } from './providers/moonshotProvider'
import { localInferenceProvider, DEFAULT_LOCAL_MODEL } from './providers/localInferenceProvider'
import { corpusProvider } from './providers/corpusProvider'
import { tasteProvider } from './providers/tasteProvider'
import { extractImagePrompt, inferImageStyle, isImageGenerationRequest } from '../imageRequest'
import { DEFAULT_PROVIDER } from '../providerDefaults'
import { buildDeepSeekTaskPayload, extractOriginalDeepSeekTask } from './deepseekContext'
import { stripReasoningArtifacts } from './responseFilter'
import { withResponseLanguage } from '../responseLanguage'

/** True for providers that run DeepSeek 16B via GitHub Actions. */
export function isDeepSeekProvider(providerId: string): boolean {
  return providerId === 'corpus' || providerId === 'deepseek';
}

export const providers = { moonshot: moonshotProvider, corpus: corpusProvider, deepseek: corpusProvider, anthropic: anthropicProvider, local: localInferenceProvider, nexus: corpusProvider, taste: tasteProvider } as const
export type ProviderId = keyof typeof providers
export interface ProviderChoice { providerId: ProviderId; model: string; level: 1 | 2 | 3 | 4 }
export const LOCAL_PROVIDER_TIMEOUT_MS = 4_000

export async function detectBestProvider(apiKey = '', preferredModel = DEFAULT_LOCAL_MODEL): Promise<ProviderChoice> {
  void apiKey
  // Local is an explicit operator-selected runtime. Availability is checked by
  // the provider heartbeat and send path; do not perform a dead probe here.
  return { providerId: 'local', model: preferredModel, level: 2 }
}
export async function getBestProvider(apiKey: string, preferred: ProviderId = DEFAULT_PROVIDER, preferredModel = ''): Promise<ProviderChoice> {
  if (preferred === 'nexus') preferred = 'deepseek'
  if (preferred !== 'local') return { providerId: preferred, model: preferredModel || providers[preferred].models[0]?.id || 'deepseek-16b', level: 1 }
  return detectBestProvider(apiKey, preferredModel || DEFAULT_LOCAL_MODEL)
}
async function sendLocalWithTimeout(request: AIRequest, apiKey: string): Promise<AIResponse> {
  const controller = new AbortController(); const parentSignal = request.signal
  const onParentAbort = () => controller.abort(); parentSignal?.addEventListener('abort', onParentAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), LOCAL_PROVIDER_TIMEOUT_MS)
  try { return await localInferenceProvider.send({ ...request, signal: controller.signal }, apiKey) }
  catch (error) { if (parentSignal?.aborted) throw error; if (controller.signal.aborted) throw new Error(`llama.cpp routing timed out after ${LOCAL_PROVIDER_TIMEOUT_MS}ms`); throw error }
  finally { clearTimeout(timer); parentSignal?.removeEventListener('abort', onParentAbort) }
}
function success(response: AIResponse): { success: true; response: AIResponse } { return { success: true, response } }
function currentTurnMessages(request: AIRequest) { let latestUserIndex = -1; request.messages.forEach((message, index) => { if (message.role === 'user') latestUserIndex = index }); return latestUserIndex >= 0 ? request.messages.slice(latestUserIndex) : request.messages }
function hasToolResult(request: AIRequest, toolName: string): boolean {
  const turn = currentTurnMessages(request); const completed = new Set(turn.filter(m => m.role === 'tool' && typeof m.tool_call_id === 'string').map(m => m.tool_call_id))
  return turn.some(m => m.role === 'assistant' && m.tool_calls?.some(call => call.name === toolName && completed.has(call.id)))
}
function latestCurrentToolResult(request: AIRequest): { name: string; content: string } | undefined {
  const turn = currentTurnMessages(request); const names = new Map<string, string>()
  for (const message of turn) if (message.role === 'assistant') for (const call of message.tool_calls ?? []) names.set(call.id, call.name)
  const result = [...turn].reverse().find(m => m.role === 'tool' && m.tool_call_id); if (!result?.tool_call_id) return undefined
  return { name: names.get(result.tool_call_id) || '', content: result.content }
}
function failedDeepSeekToolResult(request: AIRequest): { content: string } | undefined {
  const turn = currentTurnMessages(request); const names = new Map<string, string>()
  for (const message of turn) if (message.role === 'assistant') for (const call of message.tool_calls ?? []) names.set(call.id, call.name)
  const result = [...turn].reverse().find(m => m.role === 'tool' && m.tool_call_id && names.get(m.tool_call_id) === 'deepseek_reason' && !isSuccessfulDeepSeekToolResult(m.content))
  return result?.role === 'tool' ? { content: result.content } : undefined
}
function isGuardianBlockedResult(content: string) { return /^\s*\[GUARDIAN (?:BLOCKED?|REJECTED)\]/i.test(content) }
function isSuccessfulDeepSeekToolResult(content: string) { return content.startsWith('✓ DeepSeek-16B completed as ') }
function deepSeekCheckpointLabel(content: string) { return content.match(/\bcheckpoint=([^\s;]+)/i)?.[1] || 'checkpoint metadata unavailable' }
function shouldBootstrapRepositoryEvidence(request: AIRequest, providerId: ProviderId): boolean {
  if (!isDeepSeekProvider(providerId) || !request.tools?.some(t => t.name === 'github_repo_state') || hasToolResult(request, 'github_repo_state')) return false
  const text = [...request.messages].reverse().find(m => m.role === 'user')?.content ?? ''
  return /repository evidence comes from github tools|\b(repo|repository|codebase|forgeclaw|source|file|branch|commit|github)\b/i.test(text)
}
/**
 * Simple messages that don't need DeepSeek reasoning — answer directly
 * without hitting GitHub Actions. Covers greetings, acknowledgments,
 * and other low-complexity chat in English and Spanish.
 */
const SIMPLE_MESSAGE_RE = /^(hi+|hey+|hello+|hola+|buenos?\s*d[ií]as|buenas?\s*(tardes|noches)|thanks?|gracias|thank\s*you|ok|okay|vale|bien|cool|nice|lol|jaja+|ad[ií]os|bye+|chao|sí|si|no|yeah?|yep|nope|\.+|\?+|!+)$/i;

function isSimpleMessage(request: AIRequest): boolean {
  const text = [...request.messages].reverse().find(m => m.role === 'user')?.content ?? '';
  // The App appends its runtime envelope to every user message; judge only what the person typed.
  const trimmed = extractOriginalDeepSeekTask(text).trim();
  // Short (< 30 chars) and matches simple pattern, or very short (< 10 chars)
  return trimmed.length < 10 || (trimmed.length < 30 && SIMPLE_MESSAGE_RE.test(trimmed));
}

function shouldBootstrapDeepSeekReasoning(request: AIRequest, providerId: ProviderId): boolean {
  if (!isDeepSeekProvider(providerId) || !request.tools?.some(t => t.name === 'deepseek_reason')) return false
  if (failedDeepSeekToolResult(request)) return false
  // Simple messages bypass GitHub Actions entirely
  if (isSimpleMessage(request)) return false
  const latest = latestCurrentToolResult(request)
  return !latest || latest.name !== 'deepseek_reason'
}
function buildDeepSeekToolInput(request: AIRequest): { task: string; context?: string } {
  const turn = currentTurnMessages(request); const task = [...turn].reverse().find(m => m.role === 'user')?.content || ''; const names = new Map<string, string>()
  for (const message of turn) if (message.role === 'assistant') for (const call of message.tool_calls ?? []) names.set(call.id, call.name)
  const verified = turn.filter(m => m.role === 'tool' && m.tool_call_id && !/^\s*(?:\[TOOL ERROR\]|\[GUARDIAN (?:BLOCKED?|REJECTED)\])/i.test(m.content)).map(m => `${names.get(m.tool_call_id!) || 'tool'} result:\n${m.content}`).join('\n\n')
  // The workflow never sees request.systemPrompt, so the selected UI language rides in the task.
  const payload = buildDeepSeekTaskPayload(task, verified)
  return { ...payload, task: withResponseLanguage(payload.task, request.responseLanguage) }
}

export async function sendViaRouter(request: AIRequest, apiKey: string, providerId: ProviderId = DEFAULT_PROVIDER): Promise<{ success: true; response: AIResponse } | { success: false; error: AIError }> {
  const choice = await getBestProvider(apiKey, providerId, request.model || ''); const selected = choice.providerId; const provider = providers[selected]
  const lastUser = [...request.messages].reverse().find(m => m.role === 'user')
  if (lastUser && isImageGenerationRequest(lastUser.content)) return success({ text: '', provider: selected, model: choice.model, toolCalls: [{ id: `direct-image-${Date.now()}`, name: 'generate_image', input: { prompt: extractImagePrompt(lastUser.content), style: inferImageStyle(extractImagePrompt(lastUser.content)), width: 512, height: 512 } }], stopReason: 'direct-image-intent' })
  const prior = latestCurrentToolResult(request)
  // Simple greetings get a direct response — no GitHub Actions needed
  if (isDeepSeekProvider(selected) && isSimpleMessage(request)) {
    const lang = request.responseLanguage || 'en';
    const greeting = lang.startsWith('es')
      ? '¡Hola! ¿En qué te puedo ayudar?'
      : 'Hey! What can I help you with?';
    return success({ text: greeting, provider: selected, model: choice.model, stopReason: 'simple-greeting' });
  }
  if (isDeepSeekProvider(selected) && prior?.name === 'deepseek_reason' && isGuardianBlockedResult(prior.content)) return { success: false, error: classifyError(new Error(`Guardian blocked the DeepSeek reasoning step. ${prior.content.slice(0, 300)}`), selected) }
  // Repository facts must be established before DeepSeek receives a coding or
  // repository-oriented task. Previously this check ran first, so a request
  // exposing both tools could dispatch DeepSeek without a verified HEAD result;
  // the model then produced plausible-looking but unsupported commit answers.
  if (shouldBootstrapRepositoryEvidence(request, selected)) return success({ text: '', provider: selected, model: choice.model, toolCalls: [{ id: `bootstrap-repo-state-${Date.now()}`, name: 'github_repo_state', input: {} }], stopReason: 'deterministic-repository-evidence' })
  if (shouldBootstrapDeepSeekReasoning(request, selected)) return success({ text: '', provider: selected, model: choice.model, toolCalls: [{ id: `bootstrap-deepseek-${Date.now()}`, name: 'deepseek_reason', input: buildDeepSeekToolInput(request) }], stopReason: 'deterministic-deepseek-reasoning' })
  if (!(await provider.isConfigured(apiKey))) return { success: false, error: { class: 'AUTH_FAILURE', message: `${provider.label} API key or endpoint required.`, provider: selected, retryable: false } }
  try {
    const failed = failedDeepSeekToolResult(request)
    if (isDeepSeekProvider(selected) && failed) return { success: false, error: classifyError(new Error(failed.content.replace(/^\s*\[TOOL ERROR\]\s*/i, '').trim().slice(0, 500)), selected) }
    const latest = latestCurrentToolResult(request)
    if (isDeepSeekProvider(selected) && latest?.name === 'deepseek_reason' && isSuccessfulDeepSeekToolResult(latest.content)) {
      const raw = latest.content.split('\n\n').slice(1).join('\n\n').trim()
      const answer = stripReasoningArtifacts(raw)
      // If filtering removed everything, the model echoed prompt fragments instead of answering
      if (!answer) {
        return { success: false, error: classifyError(new Error('DeepSeek generated an empty or garbled response. Please try rephrasing your question.'), selected) }
      }
      if (answer) return success({ text: answer, provider: 'deepseek', model: `DeepSeek 16B Actions (${deepSeekCheckpointLabel(latest.content)})`, stopReason: 'deepseek-synthesis-complete' })
    }
    if (isDeepSeekProvider(selected)) return { success: false, error: classifyError(new Error('deepseek-not-dispatched: the request reached the DeepSeek provider without the deepseek_reason tool, so no workflow was dispatched and GitHub Actions was never contacted.'), selected) }
    return success(selected === 'local' ? await sendLocalWithTimeout(request, apiKey) : await provider.send(request, apiKey))
  } catch (error) { return { success: false, error: classifyError(error, selected) } }
}
export async function isProviderConfigured(apiKey = '', providerId: ProviderId = DEFAULT_PROVIDER): Promise<boolean> { return await providers[providerId].isConfigured(apiKey) }
export function providerSupportsTools(modelId: string, providerId: ProviderId = DEFAULT_PROVIDER): boolean { return providers[providerId]?.supportsTools(modelId) ?? false }
export async function testProviderKey(apiKey = '', providerId: ProviderId = DEFAULT_PROVIDER, workspaceId?: string): Promise<void> { await providers[providerId].test(apiKey, workspaceId) }
export { moonshotProvider, corpusProvider, anthropicProvider, localInferenceProvider, tasteProvider }
