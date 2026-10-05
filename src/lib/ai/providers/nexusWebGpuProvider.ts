import type { InitProgressReport, MLCEngineInterface } from '@mlc-ai/web-llm'
import type { AIProvider, AIRequest, AIResponse } from '../types'
import { adaptNexusMessages, limitNexusContext, MAX_NEXUS_CONTEXT_TOKENS } from '../nexusContext'

export const DEFAULT_NEXUS_WEBGPU_MODEL = 'Qwen2.5-3B-Instruct-q4f16_1-MLC'
export const LEGACY_NEXUS_WEBGPU_MODEL = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC'
export const NEXUS_CACHE_VERSION = 'qwen2.5-3b-v3'
export const NEXUS_WEBGPU_MODELS = [
  {
    id: DEFAULT_NEXUS_WEBGPU_MODEL,
    label: 'Qwen2.5 3B Instruct Q4 (Browser WebGPU · secondary)',
    contextK: 8,
    note: 'Browser-local WebLLM/WebGPU; model assets cached in IndexedDB',
  },
]

export type NexusWebGpuStatus = 'idle' | 'initializing' | 'downloading' | 'loading' | 'ready' | 'generating' | 'error'
export type NexusWebGpuStage = 'webgpu-detection' | 'webgpu-capability' | 'webllm-import' | 'model-config' | 'indexeddb-cache' | 'model-initialization' | 'model-download' | 'shader-compilation' | 'chat-completion' | 'generation' | 'response-quality' | 'ready'
export interface NexusWebGpuState {
  status: NexusWebGpuStatus
  progress: number
  text: string
  stage?: NexusWebGpuStage
  model?: string
  attempt?: number
  error?: string
}

interface WebGpuAdapterProbeDevice { destroy(): void }
interface WebGpuAdapterProbe {
  features: ReadonlySet<string>
  requestDevice(options?: { requiredFeatures?: string[] }): Promise<WebGpuAdapterProbeDevice>
}
interface WebGpuApiProbe {
  requestAdapter(options?: { powerPreference?: 'low-power' | 'high-performance' }): Promise<WebGpuAdapterProbe | null>
}

function getWebGpuApi(): WebGpuApiProbe | null {
  return (navigator as Navigator & { gpu?: WebGpuApiProbe }).gpu ?? null
}

let state: NexusWebGpuState = { status: 'idle', progress: 0, text: 'WebGPU not initialized', stage: 'webgpu-detection' }
const enginePromises = new Map<string, Promise<MLCEngineInterface>>()
const listeners = new Set<(next: NexusWebGpuState) => void>()
const CACHE_VERSION_KEY = 'forgeclaw_nexus_cache_version'
// These are the three scopes used by WebLLM's indexeddb cacheBackend.
const WEBLLM_CACHE_SCOPES = ['webllm/model', 'webllm/config', 'webllm/wasm']

export function shouldUpgradeNexusCache(storedVersion: string | null): boolean {
  return storedVersion !== NEXUS_CACHE_VERSION
}

function readNexusCacheVersion(): string | null {
  try { return globalThis.localStorage?.getItem(CACHE_VERSION_KEY) ?? null } catch { return null }
}

function writeNexusCacheVersion(version: string): void {
  try { globalThis.localStorage?.setItem(CACHE_VERSION_KEY, version) } catch { /* storage may be disabled */ }
}

function clearStaleModelEntries(databaseName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { resolve(); return }
    let createdByThisCall = false
    const open = indexedDB.open(databaseName)
    open.onupgradeneeded = event => {
      createdByThisCall = (event as IDBVersionChangeEvent).oldVersion === 0
    }
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      if (createdByThisCall || !db.objectStoreNames.contains('urls')) {
        db.close()
        if (!createdByThisCall) { resolve(); return }
        const deletion = indexedDB.deleteDatabase(databaseName)
        deletion.onsuccess = () => resolve()
        deletion.onerror = () => reject(deletion.error)
        deletion.onblocked = () => reject(new Error(`Cache cleanup blocked for ${databaseName}`))
        return
      }
      const transaction = db.transaction('urls', 'readwrite')
      const request = transaction.objectStore('urls').openCursor()
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return
        const url = typeof cursor.value?.url === 'string' ? cursor.value.url : ''
        if (url.includes(DEFAULT_NEXUS_WEBGPU_MODEL) || url.includes(LEGACY_NEXUS_WEBGPU_MODEL)) cursor.delete()
        cursor.continue()
      }
      transaction.oncomplete = () => { db.close(); resolve() }
      transaction.onerror = () => { db.close(); reject(transaction.error) }
      transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error(`Cache cleanup aborted for ${databaseName}`)) }
    }
  })
}

async function upgradeNexusCacheIfNeeded(): Promise<void> {
  if (!shouldUpgradeNexusCache(readNexusCacheVersion())) return
  if (typeof indexedDB === 'undefined') return
  for (const databaseName of WEBLLM_CACHE_SCOPES) await clearStaleModelEntries(databaseName)
  writeNexusCacheVersion(NEXUS_CACHE_VERSION)
}

function publish(next: NexusWebGpuState): void {
  state = next
  listeners.forEach(listener => listener(state))
}

export function inferNexusWebGpuStage(progressText: string): NexusWebGpuStage {
  const normalized = progressText.toLowerCase()
  if (/shader|compil|pipeline/.test(normalized)) return 'shader-compilation'
  if (/download|fetch|parameter|tokenizer|model file/.test(normalized)) return 'model-download'
  if (/cache|indexeddb/.test(normalized)) return 'indexeddb-cache'
  return 'model-initialization'
}

function progressState(report: InitProgressReport, model: string, attempt: number): NexusWebGpuState {
  const text = report.text || 'Loading browser-local model'
  const normalized = text.toLowerCase()
  const status: NexusWebGpuStatus = normalized.includes('download') || normalized.includes('fetch')
    ? 'downloading'
    : normalized.includes('load') || normalized.includes('initialize') || normalized.includes('cache')
      ? 'loading'
      : 'initializing'
  return { status, progress: Math.max(0, Math.min(1, report.progress ?? 0)), text, stage: inferNexusWebGpuStage(text), model, attempt }
}

export function sanitizeNexusWebGpuDiagnostic(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{8,}\b/gi, '[redacted-token]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/((?:token|authorization|password|secret)\s*[:=]\s*)\S+/gi, '$1[redacted]')
    .replace(/https?:\/\/[^\s"'<>]+/g, value => {
      try {
        const url = new URL(value)
        return `${url.origin}${url.pathname}${url.search ? '?[redacted]' : ''}`
      } catch { return '[redacted URL]' }
    })
    .slice(0, 800)
}

function stageFromError(error: unknown): NexusWebGpuStage | undefined {
  const message = error instanceof Error ? error.message : String(error)
  const match = message.match(/NEXUS_WEBGPU_FAILURE stage=([a-z-]+)/)
  return match?.[1] as NexusWebGpuStage | undefined
}

const OUTPUT_SCRIPT_PATTERNS = [
  /\p{Script=Latin}/u,
  /\p{Script=Cyrillic}/u,
  /\p{Script=Greek}/u,
  /\p{Script=Arabic}/u,
  /\p{Script=Hebrew}/u,
  /\p{Script=Han}/u,
  /\p{Script=Hiragana}/u,
  /\p{Script=Katakana}/u,
  /\p{Script=Hangul}/u,
  /\p{Script=Devanagari}/u,
  /\p{Script=Thai}/u,
]

/** Conservative structural checks: reject obvious corruption, never judge beliefs or opinions. */
export function assessNexusOutputQuality(text: string, userTask = ''): { valid: boolean; reason?: string } {
  const output = text.trim()
  if (!output) return { valid: false, reason: 'empty model output' }
  if (/^\s*(?:\[TOOL ERROR\]|\[GUARDIAN (?:BLOCKED?|REJECTED)\]|NEXUS_WEBGPU_FAILURE\b|GitHub read timed out\b|Processing…)/i.test(output)) {
    return { valid: false, reason: 'tool/runtime status text was returned as answer content' }
  }
  if (/\bas an ai(?: model)?\b.{0,240}\b(?:do not|don't|cannot|can't)\b.{0,160}\b(?:directly interact|access)\b/i.test(output) && /\b(?:forgeclaw|repository|repo|codebase|github)\b/i.test(userTask)) {
    return { valid: false, reason: 'generic inability disclaimer does not answer the supplied repository-specific request' }
  }

  const replacementCount = (output.match(/\uFFFD/g) || []).length
  if (replacementCount >= 3 && replacementCount / output.length > 0.002) {
    return { valid: false, reason: 'unusually high Unicode replacement-character density' }
  }

  // Ignore ordinary whitespace controls; other control bytes in generated prose
  // are a strong signal of a corrupt token stream.
  // eslint-disable-next-line no-control-regex
  const controlCount = (output.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g) || []).length
  if (controlCount >= 3 && controlCount / output.length > 0.002) {
    return { valid: false, reason: 'unexpected control-character density' }
  }

  const words = output.match(/[\p{L}\p{N}_$]+/gu) || []
  const mixedScriptWords = words.filter(word => {
    const letters = word.match(/\p{L}/gu) || []
    if (letters.length < 4) return false
    return OUTPUT_SCRIPT_PATTERNS.filter(pattern => pattern.test(word)).length >= 3
  })
  if (mixedScriptWords.length >= 5 && mixedScriptWords.length / Math.max(words.length, 1) >= 0.2) {
    return { valid: false, reason: 'many individual words mix three or more unrelated writing systems' }
  }

  const identifierLike = words.filter(word =>
    word.length >= 16 && /[A-Za-z]/.test(word) && (/[0-9_]/.test(word) || /[A-Z]/.test(word.slice(1))),
  )
  const sentenceMarks = (output.match(/[.!?。！？؟।]/gu) || []).length
  if (words.length >= 30 && identifierLike.length >= 12 && identifierLike.length / words.length >= 0.45 && sentenceMarks < 2) {
    return { valid: false, reason: 'output is dominated by long identifier-like fragments rather than readable answer text' }
  }

  return { valid: true }
}

function stageFailure(stage: NexusWebGpuStage, model: string, attempt: number, error: unknown): Error {
  const detail = sanitizeNexusWebGpuDiagnostic(error)
  const message = `NEXUS_WEBGPU_FAILURE stage=${stage} model=${model} attempt=${attempt}: ${detail}`
  publish({ status: 'error', progress: state.progress, text: message, stage, model, attempt, error: message })
  return new Error(message)
}

export function getNexusWebGpuState(): NexusWebGpuState {
  return state
}

export function subscribeNexusWebGpu(listener: (next: NexusWebGpuState) => void): () => void {
  listeners.add(listener)
  listener(state)
  return () => { listeners.delete(listener) }
}

export function isNexusWebGpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator && Boolean(navigator.gpu)
}

async function createEngine(model: string, attempt: number): Promise<MLCEngineInterface> {
  let stage: NexusWebGpuStage = 'webgpu-detection'
  try {
    if (!isNexusWebGpuAvailable()) throw new Error('NEXUS WebGPU is unavailable in this browser; navigator.gpu is not exposed')

    stage = 'webllm-import'
    publish({ status: 'initializing', progress: 0, text: 'Loading WebLLM runtime', stage, model, attempt })
    const { CreateMLCEngine, prebuiltAppConfig } = await import('@mlc-ai/web-llm')

    stage = 'model-config'
    const modelConfig = prebuiltAppConfig.model_list.find(entry => entry.model_id === model)
    if (!modelConfig) throw new Error(`Model ID ${model} is not present in the installed WebLLM prebuilt configuration`)

    stage = 'webgpu-capability'
    publish({ status: 'initializing', progress: 0, text: `Checking WebGPU adapter capabilities for ${model}`, stage, model, attempt })
    const gpu = getWebGpuApi()
    if (!gpu) throw new Error('navigator.gpu is not exposed by this browser')
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) throw new Error('navigator.gpu.requestAdapter() returned no adapter')
    const requiredFeatures = (modelConfig.required_features || []) as string[]
    const missingFeatures = requiredFeatures.filter(feature => !adapter.features.has(feature))
    if (missingFeatures.length) throw new Error(`Adapter lacks required WebGPU feature(s): ${missingFeatures.join(', ')}`)
    const probeDevice = await adapter.requestDevice({ requiredFeatures })
    probeDevice.destroy()

    stage = 'indexeddb-cache'
    publish({ status: 'initializing', progress: 0, text: 'Checking ForgeClaw-owned IndexedDB model cache', stage, model, attempt })
    await upgradeNexusCacheIfNeeded()

    stage = 'model-initialization'
    publish({ status: 'initializing', progress: 0, text: `Initializing ${model}`, stage, model, attempt })
    const appConfig = { ...prebuiltAppConfig, cacheBackend: 'indexeddb' as const }
    let progressStage: NexusWebGpuStage = stage
    return await CreateMLCEngine(model, {
      appConfig,
      initProgressCallback: (report: InitProgressReport) => {
        const next = progressState(report, model, attempt)
        progressStage = next.stage || 'model-initialization'
        publish(next)
      },
    }).catch(error => { throw stageFailure(progressStage, model, attempt, error) })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('NEXUS_WEBGPU_FAILURE ')) throw error
    throw stageFailure(stage, model, attempt, error)
  }
}

function shouldRetryInitialization(error: unknown): boolean {
  const stage = stageFromError(error)
  return !stage || !['webgpu-detection', 'webgpu-capability', 'webllm-import', 'model-config'].includes(stage)
}

async function getEngine(model: string): Promise<MLCEngineInterface> {
  if (!enginePromises.has(model)) {
    const enginePromise = (async () => {
      let firstError: unknown
      try {
        return await createEngine(model, 1)
      } catch (error) {
        firstError = error
        if (!shouldRetryInitialization(error)) throw error
      }
      publish({ status: 'initializing', progress: 0, text: 'Retrying the same Qwen model once after its first load failure', stage: stageFromError(firstError) || 'model-initialization', model, attempt: 2, error: sanitizeNexusWebGpuDiagnostic(firstError) })
      await new Promise(resolve => setTimeout(resolve, 1500))
      try {
        return await createEngine(model, 2)
      } catch (secondError) {
        const stage = stageFromError(secondError) || stageFromError(firstError) || 'model-initialization'
        const message = `NEXUS_WEBGPU_FAILURE stage=${stage} model=${model} attempt=2: first attempt: ${sanitizeNexusWebGpuDiagnostic(firstError)}; retry: ${sanitizeNexusWebGpuDiagnostic(secondError)}`
        publish({ status: 'error', progress: 0, text: message, stage, model, attempt: 2, error: message })
        throw new Error(message)
      }
    })().then(engine => {
      publish({ status: 'ready', progress: 1, text: `NEXUS ${model.includes('3B') ? '3B' : '1.5B'} WebGPU model ready`, stage: 'ready', model, attempt: state.model === model ? state.attempt : 1 })
      return engine
    }).catch(error => {
      enginePromises.delete(model)
      if (state.status !== 'error') {
        const stage = stageFromError(error) || 'model-initialization'
        const message = sanitizeNexusWebGpuDiagnostic(error)
        publish({ status: 'error', progress: state.progress, text: message, stage, model, error: message })
      }
      throw error instanceof Error ? error : new Error(sanitizeNexusWebGpuDiagnostic(error))
    })
    enginePromises.set(model, enginePromise)
  }
  return enginePromises.get(model)!
}

export const nexusWebGpuProvider: AIProvider = {
  id: 'nexus',
  label: 'NEXUS WebGPU (secondary local runtime)',
  requiresKey: false,
  models: NEXUS_WEBGPU_MODELS,
  isConfigured(apiKey: string): boolean {
    void apiKey
    return true
  },
  supportsTools(modelId: string): boolean {
    void modelId
    return false
  },
  async send(request: AIRequest, apiKey: string): Promise<AIResponse> {
    void apiKey
    if (request.tools?.length) {
      throw new Error('NEXUS WebGPU does not grant tool authority to local inference')
    }
    const model = request.model === LEGACY_NEXUS_WEBGPU_MODEL
      ? LEGACY_NEXUS_WEBGPU_MODEL
      : DEFAULT_NEXUS_WEBGPU_MODEL
    const engine = await getEngine(model)
    const bounded = limitNexusContext(request.systemPrompt, request.messages)
    const attempt = state.model === model ? state.attempt || 1 : 1
    publish({ status: 'generating', progress: 1, text: `Preparing Qwen chat completion within ${bounded.tokenCount}/${MAX_NEXUS_CONTEXT_TOKENS} conservative prompt tokens`, stage: 'chat-completion', model, attempt })
    const messages = [
      { role: 'system' as const, content: bounded.systemPrompt },
      ...adaptNexusMessages(bounded.messages),
    ]
    let stream: Awaited<ReturnType<MLCEngineInterface['chatCompletion']>>
    try {
      stream = await engine.chatCompletion({
        model,
        messages,
        stream: true,
        max_tokens: request.maxTokens ?? 512,
      })
    } catch (error) {
      if (request.signal?.aborted) throw error
      throw stageFailure('chat-completion', model, attempt, error)
    }
    publish({ status: 'generating', progress: 1, text: `Generating with ${model}`, stage: 'generation', model, attempt })
    let text = ''
    try {
      for await (const chunk of stream) {
        if (request.signal?.aborted) throw new DOMException('Generation aborted', 'AbortError')
        const delta = chunk.choices[0]?.delta?.content
        if (typeof delta === 'string' && delta) {
          text += delta
        }
      }
    } catch (error) {
      if (request.signal?.aborted) throw error
      throw stageFailure('generation', model, attempt, error)
    }
    if (!text.trim()) throw stageFailure('generation', model, attempt, new Error('Qwen completed without emitting any text tokens'))
    const userTask = [...request.messages].reverse().find(message => message.role === 'user')?.content ?? ''
    const quality = assessNexusOutputQuality(text, userTask)
    if (!quality.valid) throw stageFailure('response-quality', model, attempt, new Error(quality.reason || 'output failed conservative quality checks'))
    request.onToken?.(text)
    publish({ status: 'ready', progress: 1, text: `NEXUS ${model.includes('3B') ? '3B' : '1.5B'} WebGPU synthesis completed`, stage: 'ready', model, attempt })
    return {
      text,
      provider: 'nexus',
      model,
      stopReason: 'stop',
    }
  },
  async test(apiKey: string, workspaceId?: string): Promise<void> {
    void apiKey
    void workspaceId
    if (!isNexusWebGpuAvailable()) {
      throw stageFailure('webgpu-detection', DEFAULT_NEXUS_WEBGPU_MODEL, 1, new Error('NEXUS WebGPU is unavailable in this browser; navigator.gpu is not exposed, and no localhost or Ollama fallback is used'))
    }
    let stage: NexusWebGpuStage = 'webllm-import'
    try {
      const { prebuiltAppConfig } = await import('@mlc-ai/web-llm')
      stage = 'model-config'
      const modelConfig = prebuiltAppConfig.model_list.find(entry => entry.model_id === DEFAULT_NEXUS_WEBGPU_MODEL)
      if (!modelConfig) throw stageFailure('model-config', DEFAULT_NEXUS_WEBGPU_MODEL, 1, new Error('Configured Qwen model ID is absent from the installed WebLLM model list'))
      stage = 'webgpu-capability'
      const gpu = getWebGpuApi()
      if (!gpu) throw stageFailure('webgpu-capability', DEFAULT_NEXUS_WEBGPU_MODEL, 1, new Error('navigator.gpu is not exposed by this browser'))
      const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' })
      if (!adapter) throw stageFailure('webgpu-capability', DEFAULT_NEXUS_WEBGPU_MODEL, 1, new Error('navigator.gpu.requestAdapter() returned no adapter'))
      const requiredFeatures = (modelConfig.required_features || []) as string[]
      const missingFeatures = requiredFeatures.filter(feature => !adapter.features.has(feature))
      if (missingFeatures.length) throw stageFailure('webgpu-capability', DEFAULT_NEXUS_WEBGPU_MODEL, 1, new Error(`Adapter lacks required WebGPU feature(s): ${missingFeatures.join(', ')}`))
      const device = await adapter.requestDevice({ requiredFeatures })
      device.destroy()
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('NEXUS_WEBGPU_FAILURE ')) throw error
      throw stageFailure(stage, DEFAULT_NEXUS_WEBGPU_MODEL, 1, error)
    }
  },
}
