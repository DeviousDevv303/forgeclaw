// ForgeClaw — Qwen/Qwen3-8B via GitHub Actions (provider id 'qwen') is the canonical reasoning runtime.
import { ATTACHED_IMAGE } from '../imageInput'
import { VISION_MODEL_LABEL } from '../visionInput'
import type { AIRequest, AIResponse, AIError } from './types'
import { classifyError } from './types'
import { anthropicProvider } from './providers/anthropicProvider'
import { moonshotProvider } from './providers/moonshotProvider'
import { metaProvider } from './providers/metaProvider'
import { openrouterProvider } from './providers/openrouterProvider'
import { localInferenceProvider, DEFAULT_LOCAL_MODEL } from './providers/localInferenceProvider'
import { corpusProvider } from './providers/corpusProvider'
import { extractImagePrompt, inferImageStyle, isImageGenerationRequest } from '../imageRequest'
import { DEFAULT_PROVIDER } from '../providerDefaults'
import { buildQwenTaskPayload, extractOriginalQwenTask, formatQwenConversation } from './qwenContext'
import { stripReasoningArtifacts } from './responseFilter'
import { withResponseLanguage } from '../responseLanguage'
import { currentDateNote, needsCurrentInfo } from '../currentInfo'
import { nexusGuidanceForQwen } from '../nexusGuidance'
import { extractRewrittenFile, readFileBody, sculptTarget, sculptTask } from './qwenSculpt'
import { qwenRunLabel } from '../qwenCheckpoints'
import { extractSiteHtml, isSiteDeployRequest, parseCreatedRepo, parsePublishedCommit, siteGenerationTask, siteRepoName } from './qwenSite'

/** True for providers that run Qwen/Qwen3-8B via GitHub Actions (provider ids 'corpus'/'qwen'; legacy 'deepseek'). */
export function isQwenProvider(providerId: string): boolean {
  return providerId === 'corpus' || providerId === 'qwen' || providerId === 'deepseek';  // 'deepseek' = the legacy id in saved sessions and stored records
}

export const providers = { moonshot: moonshotProvider, corpus: corpusProvider, qwen: corpusProvider, anthropic: anthropicProvider, muse: metaProvider, openrouter: openrouterProvider, local: localInferenceProvider, nexus: corpusProvider } as const
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
  if (preferred === 'nexus') preferred = 'qwen'
  if (preferred !== 'local') return { providerId: preferred, model: preferredModel || providers[preferred].models[0]?.id || 'qwen3-8b', level: 1 }
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
function failedQwenToolResult(request: AIRequest): { content: string } | undefined {
  const turn = currentTurnMessages(request); const names = new Map<string, string>()
  for (const message of turn) if (message.role === 'assistant') for (const call of message.tool_calls ?? []) names.set(call.id, call.name)
  const result = [...turn].reverse().find(m => m.role === 'tool' && m.tool_call_id && names.get(m.tool_call_id) === 'qwen_reason' && !isSuccessfulQwenToolResult(m.content))
  return result?.role === 'tool' ? { content: result.content } : undefined
}
function isGuardianBlockedResult(content: string) { return /^\s*\[GUARDIAN (?:BLOCKED?|REJECTED)\]/i.test(content) }
/** When the workflow cut the prompt to fit the model window, the chat says so (the Stages line carries the facts). */
function promptTrimNote(content: string): string {
  const header = content.split('\n\n')[0] ?? ''
  if (!/\bprompt-trimmed=true\b/.test(header)) return ''
  const guidance = /\bnexus-guidance=(\w+)/.exec(header)?.[1]
  const tail = guidance === 'kept' ? ' Your NEXUS guidance was kept.' : guidance === 'cut' ? ' Your NEXUS guidance was also cut.' : ''
  return `Note: the model's window could not hold everything supplied, so part of the context was cut.${tail}`
}
function isSuccessfulQwenToolResult(content: string) { return content.startsWith('✓ Qwen/Qwen3-8B completed as ') }
function qwenCheckpointLabel(content: string) { return content.match(/\bcheckpoint=([^\s;]+)/i)?.[1] || 'checkpoint metadata unavailable' }
function shouldBootstrapRepositoryEvidence(request: AIRequest, providerId: ProviderId): boolean {
  if (!isQwenProvider(providerId) || !request.tools?.some(t => t.name === 'github_repo_state') || hasToolResult(request, 'github_repo_state')) return false
  const text = [...request.messages].reverse().find(m => m.role === 'user')?.content ?? ''
  return /repository evidence comes from github tools|\b(repo|repository|codebase|forgeclaw|source|file|branch|commit|github)\b/i.test(text)
}
/**
 * Simple messages that don't need Qwen reasoning — answer directly
 * without hitting GitHub Actions. Covers greetings, acknowledgments,
 * and other low-complexity chat in English and Spanish.
 */
const SIMPLE_MESSAGE_RE = /^(hi+|hey+|hello+|hola+|buenos?\s*d[ií]as|buenas?\s*(tardes|noches)|thanks?|gracias|thank\s*you|ok|okay|vale|bien|cool|nice|lol|jaja+|ad[ií]os|bye+|chao|sí|si|no|yeah?|yep|nope|\.+|\?+|!+)$/i;

/** After an exchange only pleasantries are simple; "no", "si", "yep", "ok" and a bare "?" answer the assistant and need the model. */
const PLEASANTRY_RE = /^(hi+|hey+|hello+|hola+|buenos?\s*d[ií]as|buenas?\s*(tardes|noches)|thanks?|gracias|thank\s*you|cool|nice|lol|jaja+|ad[ií]os|bye+|chao)$/i;

function isSimpleMessage(request: AIRequest): boolean {
  const text = [...request.messages].reverse().find(m => m.role === 'user')?.content ?? '';
  // The App appends its runtime envelope to every user message; judge only what the person typed.
  const trimmed = extractOriginalQwenTask(text).trim();
  // Short (< 30 chars) and matches simple pattern, or very short (< 10 chars)
  // A very short message is only a greeting when it opens the conversation: after an exchange, "why?" or "and that one?" is a
  // follow-up that needs the model and the thread, and used to get the canned greeting back.
  const latestUser = request.messages.map(m => m.role).lastIndexOf('user')
  const hasEarlierTurns = request.messages.slice(0, Math.max(latestUser, 0)).some(m => m.role === 'user' || m.role === 'assistant')
  return hasEarlierTurns ? trimmed.length < 30 && PLEASANTRY_RE.test(trimmed) : trimmed.length < 10 || (trimmed.length < 30 && SIMPLE_MESSAGE_RE.test(trimmed));
}

/** Questions that need gathered sources, not model memory. */
const RESEARCH_INTENT_RE = /\b(?:deep research|research|investigate|look into|find (?:me )?sources|literature review|what (?:do|does) (?:the )?(?:studies|evidence|research) say|compare (?:the )?(?:best|top|leading))\b/i

function latestUserTask(request: AIRequest): string {
  return extractOriginalQwenTask([...request.messages].reverse().find(m => m.role === 'user')?.content ?? '').trim()
}

/** Qwen has no tool loop of its own, so the router gathers research evidence before it reasons. */
export function isResearchRequest(text: string): boolean {
  return RESEARCH_INTENT_RE.test(text)
}

function shouldBootstrapResearch(request: AIRequest, providerId: ProviderId): boolean {
  if (!isQwenProvider(providerId) || !request.tools?.some(t => t.name === 'deep_research') || hasToolResult(request, 'deep_research')) return false
  const text = latestUserTask(request)
  // "What's the latest in X" needs sources too: the model's own knowledge stops at its training cutoff.
  return isResearchRequest(text) || needsCurrentInfo(text)
}

/** The research step's result for this turn, if it ran. */
function researchToolResult(request: AIRequest): { content: string } | undefined {
  const turn = currentTurnMessages(request); const names = new Map<string, string>()
  for (const message of turn) if (message.role === 'assistant') for (const call of message.tool_calls ?? []) names.set(call.id, call.name)
  const result = turn.find(m => m.role === 'tool' && m.tool_call_id && names.get(m.tool_call_id) === 'deep_research')
  return result ? { content: result.content } : undefined
}

/** Latest result of a named tool in this turn. */
function toolResultFor(request: AIRequest, toolName: string): string | undefined {
  const turn = currentTurnMessages(request); const names = new Map<string, string>()
  for (const message of turn) if (message.role === 'assistant') for (const call of message.tool_calls ?? []) names.set(call.id, call.name)
  return [...turn].reverse().find(m => m.role === 'tool' && m.tool_call_id && names.get(m.tool_call_id) === toolName)?.content
}

const isFailure = (content: string) => /^\s*\[(?:TOOL ERROR|GUARDIAN)/i.test(content)

/**
 * Qwen picture chain: analyze_image (Qwen2-VL on Actions) -> its answer. The text model never sees
 * the picture, so it is not asked to answer about one; before this, it summarized the repository instead.
 */
function nextImageStep(request: AIRequest, model: string, selected: ProviderId): { success: true; response: AIResponse } | { success: false; error: AIError } | undefined {
  if (!request.tools?.some(t => t.name === 'analyze_image')) return undefined
  if (!currentTurnMessages(request).find(m => m.role === 'user')?.image_url) return undefined
  const analysis = toolResultFor(request, 'analyze_image')
  if (!analysis) return success({ text: '', provider: selected, model, toolCalls: [{ id: `image-analyze-${Date.now()}`, name: 'analyze_image', input: { image_url: ATTACHED_IMAGE, prompt: latestUserTask(request).slice(0, 2000) } }], stopReason: 'deterministic-image-analysis' })
  if (isFailure(analysis)) return { success: false, error: classifyError(new Error(`The picture could not be analyzed. ${analysis.replace(/^\s*\[TOOL ERROR\]\s*/i, '').slice(0, 400)}`), selected) }
  const [header, ...body] = analysis.split('\n')
  const source = header.replace(/^✓ Image analysis by /, '')
  return success({ text: `${body.join('\n').trim()}\n\n(Looked at by ${source})`, provider: selected, model: VISION_MODEL_LABEL, stopReason: 'qwen-image-complete' })
}

/**
 * Qwen website chain: generate -> create repo -> publish -> wait for Pages -> report. Each step is
 * chosen from this turn's real tool results, so a reload or retry resumes at the first missing step.
 */
function nextSiteStep(request: AIRequest, model: string, selected: ProviderId): { success: true; response: AIResponse } | { success: false; error: AIError } | undefined {
  const text = latestUserTask(request)
  if (!request.tools?.some(t => t.name === 'qwen_reason') || !isSiteDeployRequest(text)) return undefined
  const call = (name: string, input: Record<string, unknown>, step: string) => success({ text: '', provider: selected, model, toolCalls: [{ id: `site-${step}-${Date.now()}`, name, input }], stopReason: `deterministic-site-${step}` })
  const fail = (message: string) => ({ success: false as const, error: classifyError(new Error(message), selected) })

  const generated = toolResultFor(request, 'qwen_reason')
  if (!generated) return call('qwen_reason', { task: siteGenerationTask(text), profile: 'site', nexus_learn: true, ...chainGuidance(text) }, 'generate')
  if (isFailure(generated) || !isSuccessfulQwenToolResult(generated)) return fail(`Qwen/Qwen3-8B could not generate the site, so nothing was published. ${generated.slice(0, 300)}`)
  const html = extractSiteHtml(generated.split('\n\n').slice(1).join('\n\n'))
  if (!html) return fail('Qwen/Qwen3-8B returned an incomplete or repetitive page (no complete <html>...</html> document), so nothing was published. Try a shorter request, or use Kimi or Claude for larger sites.')

  const created = toolResultFor(request, 'github_create_repo')
  if (!created) return call('github_create_repo', { name: siteRepoName(text), description: `Website generated by ForgeClaw (Qwen/Qwen3-8B): ${text.slice(0, 120)}` }, 'repo')
  const target = isFailure(created) ? null : parseCreatedRepo(created)
  if (!target) return fail(`The site was generated but its repository could not be created, so nothing was published. ${created.slice(0, 300)}`)

  const published = toolResultFor(request, 'github_publish_site')
  if (!published) return call('github_publish_site', { owner: target.owner, repo: target.repo, files: [{ path: 'index.html', content: html }], message: `Publish ${target.repo} (generated by Qwen/Qwen3-8B)` }, 'publish')
  const commit = isFailure(published) ? null : parsePublishedCommit(published)
  if (!commit) return fail(`Publishing to ${target.owner}/${target.repo} failed. ${published.slice(0, 300)}`)

  const status = toolResultFor(request, 'github_pages_status')
  if (!status) return call('github_pages_status', { owner: target.owner, repo: target.repo, commit, wait_seconds: 240 }, 'verify')
  const url = /site: (https:\/\/\S+)/.exec(status)?.[1] ?? /site: (https:\/\/\S+)/.exec(published)?.[1] ?? `https://${target.owner.toLowerCase()}.github.io/${target.repo}/`
  const built = /: built\b/.test(status) && !isFailure(status)
  const answer = built
    ? `Your site is live: ${url}\n\nRepository: https://github.com/${target.owner}/${target.repo} (commit ${commit.slice(0, 7)}, built by GitHub Pages). Generated by Qwen/Qwen3-8B as a single index.html.`
    : `Your site was published to https://github.com/${target.owner}/${target.repo} (commit ${commit.slice(0, 7)}), but the GitHub Pages build is not confirmed yet:\n${status.split('\n')[0]}\nIt should appear at ${url} once the build finishes.`
  return success({ text: answer, provider: selected, model: 'Qwen/Qwen3-8B site chain', stopReason: built ? 'qwen-site-complete' : 'qwen-site-unverified' })
}

/**
 * Qwen self-sculpt chain: read -> rewrite -> sculpt_self (build-validated PR) -> report. Chosen from
 * this turn's real tool results, so a retry resumes at the first missing step.
 */
function nextSculptStep(request: AIRequest, model: string, selected: ProviderId): { success: true; response: AIResponse } | { success: false; error: AIError } | undefined {
  const text = latestUserTask(request)
  const path = sculptTarget(text)
  if (!path || !request.tools?.some(t => t.name === 'qwen_reason')) return undefined
  const call = (name: string, input: Record<string, unknown>, step: string) => success({ text: '', provider: selected, model, toolCalls: [{ id: `sculpt-${step}-${Date.now()}`, name, input }], stopReason: `deterministic-sculpt-${step}` })
  const fail = (message: string) => ({ success: false as const, error: classifyError(new Error(message), selected) })

  const read = toolResultFor(request, 'github_read_file')
  if (!read) return call('github_read_file', { path }, 'read')
  const file = readFileBody(read)
  if ('error' in file) return fail(`Self-sculpt of ${path} stopped before any change: ${file.error}`)

  const rewritten = toolResultFor(request, 'qwen_reason')
  if (!rewritten) return call('qwen_reason', { task: sculptTask(text, path, file.content), profile: 'code', nexus_learn: true, ...chainGuidance(text) }, 'rewrite')
  if (isFailure(rewritten) || !isSuccessfulQwenToolResult(rewritten)) return fail(`Qwen/Qwen3-8B could not rewrite ${path}, so nothing was proposed. ${rewritten.slice(0, 300)}`)
  const next = extractRewrittenFile(rewritten.split('\n\n').slice(1).join('\n\n'), file.content)
  if ('error' in next) return fail(`${next.error}, so nothing was proposed for ${path}.`)

  const proposed = toolResultFor(request, 'sculpt_self')
  if (!proposed) return call('sculpt_self', { file_path: path, content: next.content, reason: `Qwen/Qwen3-8B self-sculpt: ${text.replace(/\s+/g, ' ').slice(0, 200)}` }, 'propose')
  if (isFailure(proposed)) return fail(`The self-sculpt proposal for ${path} did not go through. ${proposed.replace(/^\s*\[TOOL ERROR\]\s*/i, '').slice(0, 400)}`)
  return success({ text: proposed.replace(/^✓\s*/, ''), provider: selected, model: 'Qwen/Qwen3-8B self-sculpt chain', stopReason: 'qwen-sculpt-complete' })
}

/**
 * NEXUS guidance for the fixed chains, which build their own task and so skip buildQwenTaskPayload. The cap is small
 * because the window is 8K tokens and the sculpt task carries a whole source file.
 */
const CHAIN_GUIDANCE_CHARS = 600
function chainGuidance(task: string): { context?: string } {
  const text = nexusGuidanceForQwen(task, { maxChars: CHAIN_GUIDANCE_CHARS }).text
  return text ? { context: text } : {}
}

function shouldBootstrapQwenReasoning(request: AIRequest, providerId: ProviderId): boolean {
  if (!isQwenProvider(providerId) || !request.tools?.some(t => t.name === 'qwen_reason')) return false
  if (failedQwenToolResult(request)) return false
  // Simple messages bypass GitHub Actions entirely
  if (isSimpleMessage(request)) return false
  const latest = latestCurrentToolResult(request)
  return !latest || latest.name !== 'qwen_reason'
}
function buildQwenToolInput(request: AIRequest): { task: string; context?: string } {
  const turn = currentTurnMessages(request); const task = [...turn].reverse().find(m => m.role === 'user')?.content || ''; const names = new Map<string, string>()
  for (const message of turn) if (message.role === 'assistant') for (const call of message.tool_calls ?? []) names.set(call.id, call.name)
  const verified = turn.filter(m => m.role === 'tool' && m.tool_call_id && !/^\s*(?:\[TOOL ERROR\]|\[GUARDIAN (?:BLOCKED?|REJECTED)\])/i.test(m.content)).map(m => `${names.get(m.tool_call_id!) || 'tool'} result:\n${m.content}`).join('\n\n')
  // The workflow never sees request.systemPrompt, so the selected UI language rides in the task.
  // Earlier turns (everything before this turn's user message) ride in the context; the workflow never sees request.messages.
  const turnStart = request.messages.length - turn.length
  const payload = buildQwenTaskPayload(task, verified, formatQwenConversation(request.messages.slice(0, turnStart)))
  // The date rides in the task too, so the model knows how old its own knowledge is.
  return { ...payload, task: `${withResponseLanguage(payload.task, request.responseLanguage)}\n\n${currentDateNote()}` }
}

export async function sendViaRouter(request: AIRequest, apiKey: string, providerId: ProviderId = DEFAULT_PROVIDER): Promise<{ success: true; response: AIResponse } | { success: false; error: AIError }> {
  const choice = await getBestProvider(apiKey, providerId, request.model || ''); const selected = choice.providerId; const provider = providers[selected]
  const lastUser = [...request.messages].reverse().find(m => m.role === 'user')
  if (lastUser && isImageGenerationRequest(lastUser.content)) return success({ text: '', provider: selected, model: choice.model, toolCalls: [{ id: `direct-image-${Date.now()}`, name: 'generate_image', input: { prompt: extractImagePrompt(lastUser.content), style: inferImageStyle(extractImagePrompt(lastUser.content)), width: 512, height: 512 } }], stopReason: 'direct-image-intent' })
  const prior = latestCurrentToolResult(request)
  // A picture comes first: greetings, repository evidence and research would all answer without it.
  const imageStep = isQwenProvider(selected) ? nextImageStep(request, choice.model, selected) : undefined
  if (imageStep) return imageStep
  // Simple greetings get a direct response — no GitHub Actions needed
  if (isQwenProvider(selected) && isSimpleMessage(request)) {
    const lang = request.responseLanguage || 'en';
    const greeting = lang.startsWith('es')
      ? '¡Hola! ¿En qué te puedo ayudar?'
      : 'Hey! What can I help you with?';
    return success({ text: greeting, provider: selected, model: choice.model, stopReason: 'simple-greeting' });
  }
  if (isQwenProvider(selected) && prior?.name === 'qwen_reason' && isGuardianBlockedResult(prior.content)) return { success: false, error: classifyError(new Error(`Guardian blocked the Qwen/Qwen3-8B reasoning step. ${prior.content.slice(0, 300)}`), selected) }
  // Repository facts must be established before Qwen receives a coding or
  // repository-oriented task. Previously this check ran first, so a request
  // exposing both tools could dispatch Qwen without a verified HEAD result;
  // the model then produced plausible-looking but unsupported commit answers.
  // A website request on Qwen runs the fixed generate -> repo -> publish -> verify chain.
  const siteStep = isQwenProvider(selected) ? nextSiteStep(request, choice.model, selected) : undefined
  if (siteStep) return siteStep
  // "Improve <file>" on Qwen runs the fixed read -> rewrite -> sculpt_self chain.
  const sculptStep = isQwenProvider(selected) ? nextSculptStep(request, choice.model, selected) : undefined
  if (sculptStep) return sculptStep
  // Research before repository evidence: a research question that mentions GitHub needs sources, not HEAD.
  if (shouldBootstrapResearch(request, selected)) {
    const question = latestUserTask(request).slice(0, 1000)
    return success({ text: '', provider: selected, model: choice.model, toolCalls: [{ id: `bootstrap-research-${Date.now()}`, name: 'deep_research', input: { question, max_sources: 6 } }], stopReason: 'deterministic-deep-research' })
  }
  const research = isQwenProvider(selected) ? researchToolResult(request) : undefined
  if (research && /^\s*\[(?:TOOL ERROR|GUARDIAN)/i.test(research.content)) {
    // Without evidence, Qwen would answer a research question from memory and look sourced. Stop instead.
    return { success: false, error: classifyError(new Error(`Deep research gathered no usable sources, so Qwen/Qwen3-8B was not asked to answer from memory. ${research.content.replace(/^\s*\[TOOL ERROR\]\s*/i, '').slice(0, 400)}`), selected) }
  }
  if (!research && shouldBootstrapRepositoryEvidence(request, selected)) return success({ text: '', provider: selected, model: choice.model, toolCalls: [{ id: `bootstrap-repo-state-${Date.now()}`, name: 'github_repo_state', input: {} }], stopReason: 'deterministic-repository-evidence' })
  if (shouldBootstrapQwenReasoning(request, selected)) return success({ text: '', provider: selected, model: choice.model, toolCalls: [{ id: `bootstrap-qwen-${Date.now()}`, name: 'qwen_reason', input: buildQwenToolInput(request) }], stopReason: 'deterministic-qwen-reasoning' })
  if (!(await provider.isConfigured(apiKey))) return { success: false, error: { class: 'AUTH_FAILURE', message: `${provider.label} API key or endpoint required.`, provider: selected, retryable: false } }
  try {
    const failed = failedQwenToolResult(request)
    if (isQwenProvider(selected) && failed) return { success: false, error: classifyError(new Error(failed.content.replace(/^\s*\[TOOL ERROR\]\s*/i, '').trim().slice(0, 500)), selected) }
    const latest = latestCurrentToolResult(request)
    if (isQwenProvider(selected) && latest?.name === 'qwen_reason' && isSuccessfulQwenToolResult(latest.content)) {
      const raw = latest.content.split('\n\n').slice(1).join('\n\n').trim()
      const answer = stripReasoningArtifacts(raw)
      // If filtering removed everything, the model echoed prompt fragments instead of answering
      if (!answer) {
        return { success: false, error: classifyError(new Error('Qwen/Qwen3-8B generated an empty or garbled response. Please try rephrasing your question.'), selected) }
      }
      const trimNote = promptTrimNote(latest.content)
      // D-016: attribute the SELECTED provider id, as every dispatch step above does — hardcoding 'qwen' here
      // made one session's answers flip between 'corpus' and 'qwen' attributions for the same Qwen workflow.
      if (answer) return success({ text: trimNote ? `${answer}\n\n${trimNote}` : answer, provider: selected, model: qwenRunLabel(qwenCheckpointLabel(latest.content)), stopReason: 'qwen-synthesis-complete' })
    }
    if (isQwenProvider(selected)) return { success: false, error: classifyError(new Error('qwen-not-dispatched: the request reached the Qwen/Qwen3-8B provider (provider id \'qwen\') without the qwen_reason tool, so no workflow was dispatched and GitHub Actions was never contacted.'), selected) }
    return success(selected === 'local' ? await sendLocalWithTimeout(request, apiKey) : await provider.send(request, apiKey))
  } catch (error) { return { success: false, error: classifyError(error, selected) } }
}
export async function isProviderConfigured(apiKey = '', providerId: ProviderId = DEFAULT_PROVIDER): Promise<boolean> { return await providers[providerId].isConfigured(apiKey) }
export function providerSupportsTools(modelId: string, providerId: ProviderId = DEFAULT_PROVIDER): boolean { return providers[providerId]?.supportsTools(modelId) ?? false }
export async function testProviderKey(apiKey = '', providerId: ProviderId = DEFAULT_PROVIDER, workspaceId?: string): Promise<void> { await providers[providerId].test(apiKey, workspaceId) }
export { moonshotProvider, corpusProvider, anthropicProvider, metaProvider, openrouterProvider, localInferenceProvider }
