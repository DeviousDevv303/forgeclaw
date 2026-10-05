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
export interface NexusWebGpuState {
  status: NexusWebGpuStatus
  progress: number
  text: string
  error?: string
}

let state: NexusWebGpuState = { status: 'idle', progress: 0, text: 'WebGPU not initialized' }
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

function progressState(report: InitProgressReport): NexusWebGpuState {
  const text = report.text || 'Loading browser-local model'
  const normalized = text.toLowerCase()
  const status: NexusWebGpuStatus = normalized.includes('download') || normalized.includes('fetch')
    ? 'downloading'
    : normalized.includes('load') || normalized.includes('initialize') || normalized.includes('cache')
      ? 'loading'
      : 'initializing'
  return { status, progress: Math.max(0, Math.min(1, report.progress ?? 0)), text }
}

function friendlyLoadError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/Cache\.add|cache\.add|network error|Failed to fetch|NetworkError/i.test(message)) {
    return (
      'Model download/cache failed (network or storage). ' +
      'Stay on Wi‑Fi, free storage space, hard-refresh, and retry. ' +
      'Details: ' + message
    )
  }
  return message
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

async function createEngine(model: string): Promise<MLCEngineInterface> {
  const { CreateMLCEngine, prebuiltAppConfig } = await import('@mlc-ai/web-llm')
  // IndexedDB avoids Cache.add() failures common on mobile when caching HF model shards.
  const appConfig = {
    ...prebuiltAppConfig,
    cacheBackend: 'indexeddb' as const,
  }
  return CreateMLCEngine(model, {
    appConfig,
    initProgressCallback: (report: InitProgressReport) => publish(progressState(report)),
  })
}

async function getEngine(model: string): Promise<MLCEngineInterface> {
  if (!isNexusWebGpuAvailable()) {
    const message = 'NEXUS WebGPU is unavailable in this browser. Enable WebGPU or use a WebGPU-capable browser.'
    publish({ status: 'error', progress: 0, text: message, error: message })
    throw new Error(message)
  }
  if (!enginePromises.has(model)) {
    publish({ status: 'initializing', progress: 0, text: 'Checking WebGPU and initializing NEXUS (IndexedDB cache)' })
    const enginePromise = (async () => {
      try {
        await upgradeNexusCacheIfNeeded()
        return await createEngine(model)
      } catch {
        // One automatic retry — transient HF/CDN races are common on phones.
        publish({ status: 'initializing', progress: 0, text: 'Retrying model load after cache/network error…' })
        await new Promise(resolve => setTimeout(resolve, 1500))
        return await createEngine(model)
      }
    })().then(engine => {
      publish({ status: 'ready', progress: 1, text: `NEXUS ${model.includes('3B') ? '3B' : '1.5B'} WebGPU model ready` })
      return engine
    }).catch(error => {
      enginePromises.delete(model)
      const message = friendlyLoadError(error)
      publish({ status: 'error', progress: 0, text: message, error: message })
      throw new Error(message)
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
    publish({ status: 'generating', progress: 1, text: `Generating within ${bounded.tokenCount}/${MAX_NEXUS_CONTEXT_TOKENS} conservative prompt tokens` })
    const messages = [
      { role: 'system' as const, content: bounded.systemPrompt },
      ...adaptNexusMessages(bounded.messages),
    ]
    const stream = await engine.chatCompletion({
      model,
      messages,
      stream: true,
      max_tokens: request.maxTokens ?? 512,
    })
    let text = ''
    for await (const chunk of stream) {
      if (request.signal?.aborted) throw new DOMException('Generation aborted', 'AbortError')
      const delta = chunk.choices[0]?.delta?.content
      if (typeof delta === 'string' && delta) {
        text += delta
        request.onToken?.(delta)
      }
    }
    publish({ status: 'ready', progress: 1, text: `NEXUS ${model.includes('3B') ? '3B' : '1.5B'} WebGPU model ready` })
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
      throw new Error('NEXUS WebGPU is unavailable in this browser; no localhost or Ollama fallback is used')
    }
  },
}
