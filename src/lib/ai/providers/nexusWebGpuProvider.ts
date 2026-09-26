import type { InitProgressReport, MLCEngineInterface } from '@mlc-ai/web-llm'
import type { AIProvider, AIRequest, AIResponse } from '../types'
import { limitNexusContext } from '../nexusContext'

export const DEFAULT_NEXUS_WEBGPU_MODEL = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC'
export const NEXUS_WEBGPU_MODELS = [
  {
    id: DEFAULT_NEXUS_WEBGPU_MODEL,
    label: 'Qwen2.5 1.5B Instruct Q4 (Browser WebGPU)',
    contextK: 4,
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
let enginePromise: Promise<MLCEngineInterface> | undefined
const listeners = new Set<(next: NexusWebGpuState) => void>()

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

async function createEngine(): Promise<MLCEngineInterface> {
  const { CreateMLCEngine, prebuiltAppConfig } = await import('@mlc-ai/web-llm')
  // IndexedDB avoids Cache.add() failures common on mobile when caching HF model shards.
  const appConfig = {
    ...prebuiltAppConfig,
    cacheBackend: 'indexeddb' as const,
  }
  return CreateMLCEngine(DEFAULT_NEXUS_WEBGPU_MODEL, {
    appConfig,
    initProgressCallback: (report: InitProgressReport) => publish(progressState(report)),
  })
}

async function getEngine(): Promise<MLCEngineInterface> {
  if (!isNexusWebGpuAvailable()) {
    const message = 'NEXUS WebGPU is unavailable in this browser. Enable WebGPU or use a WebGPU-capable browser.'
    publish({ status: 'error', progress: 0, text: message, error: message })
    throw new Error(message)
  }
  if (!enginePromise) {
    publish({ status: 'initializing', progress: 0, text: 'Checking WebGPU and initializing NEXUS (IndexedDB cache)' })
    enginePromise = (async () => {
      try {
        return await createEngine()
      } catch {
        // One automatic retry — transient HF/CDN races are common on phones.
        publish({
          status: 'initializing',
          progress: 0,
          text: 'Retrying model load after cache/network error…',
        })
        await new Promise(resolve => setTimeout(resolve, 1500))
        return await createEngine()
      }
    })().then(engine => {
      publish({ status: 'ready', progress: 1, text: 'NEXUS WebGPU model ready' })
      return engine
    }).catch(error => {
      enginePromise = undefined
      const message = friendlyLoadError(error)
      publish({ status: 'error', progress: 0, text: message, error: message })
      throw new Error(message)
    })
  }
  return enginePromise
}

export const nexusWebGpuProvider: AIProvider = {
  id: 'nexus',
  label: 'NEXUS/CORPUS (Browser WebGPU)',
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
    const engine = await getEngine()
    const bounded = limitNexusContext(request.systemPrompt, request.messages)
    publish({ status: 'generating', progress: 1, text: `Generating within ${bounded.tokenCount}/4096 conservative prompt tokens` })
    const messages = [
      { role: 'system' as const, content: bounded.systemPrompt },
      ...bounded.messages.map(message => ({ role: message.role as 'user' | 'assistant', content: message.content })),
    ]
    const stream = await engine.chatCompletion({
      model: DEFAULT_NEXUS_WEBGPU_MODEL,
      messages,
      stream: true,
      max_tokens: request.maxTokens ?? 512,
    })
    let text = ''
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content
      if (typeof delta === 'string' && delta) {
        text += delta
        request.onToken?.(delta)
      }
    }
    publish({ status: 'ready', progress: 1, text: 'NEXUS WebGPU model ready' })
    return { text, provider: 'nexus', model: DEFAULT_NEXUS_WEBGPU_MODEL, stopReason: 'stop' }
  },
  async test(apiKey: string, workspaceId?: string): Promise<void> {
    void apiKey
    void workspaceId
    if (!isNexusWebGpuAvailable()) {
      throw new Error('NEXUS WebGPU is unavailable in this browser; no localhost or Ollama fallback is used')
    }
  },
}
