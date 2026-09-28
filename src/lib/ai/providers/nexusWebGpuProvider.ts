import type { InitProgressReport, MLCEngineInterface } from '@mlc-ai/web-llm'
import type { AIProvider, AIRequest, AIResponse } from '../types'
import { limitNexusContext } from '../nexusContext'

export const DEFAULT_NEXUS_WEBGPU_MODEL = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC'
export const NEXUS_WEBGPU_MODELS = [
  {
    id: DEFAULT_NEXUS_WEBGPU_MODEL,
    label: 'Qwen2.5 1.5B Instruct Q4 (Browser WebGPU)',
    contextK: 4,
    note: 'Browser-local WebLLM/WebGPU; model assets are cached by the browser',
    noTools: true,
  },
]

export type NexusWebGpuStatus = 'idle' | 'available' | 'initializing' | 'downloading' | 'loading' | 'ready' | 'generating' | 'error'
export interface NexusWebGpuState {
  status: NexusWebGpuStatus
  progress: number
  text: string
  error?: string
}

let state: NexusWebGpuState = { status: 'idle', progress: 0, text: 'WebGPU not initialized' }
let enginePromise: Promise<MLCEngineInterface> | undefined
const listeners = new Set<(next: NexusWebGpuState) => void>()

type WebGpuNavigator = Navigator & {
  gpu?: {
    requestAdapter: (options?: { powerPreference?: 'low-power' | 'high-performance' }) => Promise<unknown | null>
  }
}

function publish(next: NexusWebGpuState): void {
  state = next
  listeners.forEach(listener => listener(state))
}

function progressState(report: InitProgressReport): NexusWebGpuState {
  const text = report.text || 'Loading browser-local model'
  const normalized = text.toLowerCase()
  const status: NexusWebGpuStatus = normalized.includes('download')
    ? 'downloading'
    : normalized.includes('load') || normalized.includes('initialize')
      ? 'loading'
      : 'initializing'
  return { status, progress: Math.max(0, Math.min(1, report.progress ?? 0)), text }
}

export function getNexusWebGpuState(): NexusWebGpuState {
  return state
}

export function subscribeNexusWebGpu(listener: (next: NexusWebGpuState) => void): () => void {
  listeners.add(listener)
  listener(state)
  return () => listeners.delete(listener)
}

export function isNexusWebGpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator && Boolean(navigator.gpu)
}

async function acquireAdapter(): Promise<unknown> {
  if (!isNexusWebGpuAvailable()) {
    throw new Error('WebGPU API is unavailable in this browser')
  }
  const gpu = (navigator as WebGpuNavigator).gpu
  if (!gpu) throw new Error('WebGPU API is unavailable in this browser')
  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' }) ?? await gpu.requestAdapter()
  if (!adapter) {
    throw new Error('WebGPU API is present, but this browser could not acquire a compatible GPU adapter')
  }
  return adapter
}

function friendlyLoadError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/Cache\.add|cache\.add|network error|Failed to fetch|NetworkError/i.test(message)) {
    return `Model download/cache failed (network or storage). Stay on Wi-Fi, free storage, hard-refresh, and retry. Details: ${message}`
  }
  return message
}

async function createEngine(): Promise<MLCEngineInterface> {
  const { CreateMLCEngine, prebuiltAppConfig } = await import('@mlc-ai/web-llm')
  const appConfig = { ...prebuiltAppConfig, cacheBackend: 'indexeddb' as const }
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
    publish({ status: 'initializing', progress: 0, text: 'Acquiring GPU adapter and initializing NEXUS (IndexedDB cache)' })
    enginePromise = (async () => {
      await acquireAdapter()
      try {
        return await createEngine()
      } catch {
        publish({ status: 'initializing', progress: 0, text: 'Retrying model load after cache/network error…' })
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
  isConfigured: () => true,
  supportsTools: () => false,
  async send(request: AIRequest): Promise<AIResponse> {
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
      if (request.signal?.aborted) throw new DOMException('Generation aborted', 'AbortError')
      const delta = chunk.choices[0]?.delta?.content
      if (typeof delta === 'string' && delta) {
        text += delta
        request.onToken?.(delta)
      }
    }
    publish({ status: 'ready', progress: 1, text: 'NEXUS WebGPU model ready' })
    return { text, provider: 'nexus', model: DEFAULT_NEXUS_WEBGPU_MODEL, stopReason: 'stop' }
  },
  async test(): Promise<void> {
    try {
      await acquireAdapter()
      publish({ status: 'available', progress: 0, text: 'NEXUS WebGPU API available; GPU adapter acquired' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      publish({ status: 'error', progress: 0, text: message, error: message })
      throw new Error(`${message}; no localhost or Ollama fallback is used`)
    }
  },
}
