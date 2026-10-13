import type { AIProvider, AIRequest, AIResponse } from '../types'

export const DEFAULT_TASTE_ENDPOINT = 'http://127.0.0.1:8377/v1'
export const TASTE_ENDPOINT_STORAGE_KEY = 'fc_taste_endpoint'
export function configuredTasteEndpoint(): string {
  if (typeof localStorage === 'undefined') return DEFAULT_TASTE_ENDPOINT
  return (localStorage.getItem(TASTE_ENDPOINT_STORAGE_KEY) || DEFAULT_TASTE_ENDPOINT).replace(/\/+$/, '')
}
export const TASTE_MODELS = [{ id: 'nexus-taste-v1', label: 'NEXUS Taste v1', contextK: 0, note: 'Local aesthetic preference service' }]
export type TasteSignal = 'fire' | 'up' | 'down'
export type TasteFormat = 'generation' | 'raw' | 'full'
export interface ExtractJob { job_id: string; status_url: string }
export interface ExtractFeature { value: number; confidence: number }
export interface ExtractResult { status: 'pending' | 'complete' | 'failed'; image_id?: string; features?: Record<string, ExtractFeature>; error?: string; detail?: string; extraction_time_ms?: number; extraction_model?: string; prompt_version?: string }
export interface FeedbackResult { image_id: string; routing: string; update_type: string; dimensions_updated: string[]; centroid_displacement: number; alpha_effective: number; drift_flag: boolean }
export interface TasteCluster { id?: string; label?: string; centroid?: Record<string, number>; size?: number; [key: string]: unknown }
export interface TasteProfile { profile?: Record<string, string>; prompt_positive?: string; prompt_negative?: string; confidence?: Record<string, number>; centroid?: Record<string, number>; event_count: number; alpha_current?: number; drift_flag: boolean; fallback_active?: boolean; clusters?: TasteCluster[] }

type Fetcher = typeof fetch
const POLL_INITIAL_DELAY_MS = 2_000
const POLL_MAX_DELAY_MS = 30_000
const EXTRACT_TIMEOUT_MS = 120_000
export const HEALTH_CACHE_TTL_MS = 30_000
type HealthCacheEntry = { value?: boolean; expiresAt: number; pending?: Promise<boolean> }
const healthCache = new Map<string, HealthCacheEntry>()

async function readError(response: Response): Promise<string> {
  const raw = await response.text().catch(() => '')
  try { const parsed = JSON.parse(raw) as { detail?: string; error?: string }; return parsed.detail || parsed.error || `Taste service HTTP ${response.status}` } catch { return raw || `Taste service HTTP ${response.status}` }
}
function abortError(): DOMException { return new DOMException('Taste extract aborted', 'AbortError') }
function throwIfAborted(signal?: AbortSignal): void { if (signal?.aborted) throw abortError() }
function dataUrlBase64(image: Blob | string): Promise<string> {
  if (typeof image === 'string') {
    const match = image.match(/^data:image\/(?:png|jpe?g|webp);base64,(.+)$/i)
    if (!match) return Promise.reject(new Error('Taste extract requires a PNG, JPEG, or WebP data URL.'))
    return Promise.resolve(match[1])
  }
  return image.arrayBuffer().then(bytes => {
    const value = new Uint8Array(bytes)
    let binary = ''
    for (let index = 0; index < value.length; index += 0x8000) binary += String.fromCharCode(...value.subarray(index, index + 0x8000))
    return btoa(binary)
  })
}

export class TasteProviderClient {
  private readonly baseUrl: string
  private readonly fetchImpl: Fetcher
  constructor(baseUrl = configuredTasteEndpoint(), fetchImpl: Fetcher = fetch) { this.baseUrl = baseUrl.replace(/\/+$/, ''); this.fetchImpl = fetchImpl }
  async isConfigured(signal?: AbortSignal): Promise<boolean> {
    const now = Date.now()
    const cached = healthCache.get(this.baseUrl)
    if (cached?.value !== undefined && cached.expiresAt > now) return cached.value
    if (cached?.pending) return cached.pending
    const entry: HealthCacheEntry = { expiresAt: now + HEALTH_CACHE_TTL_MS }
    const pending = this.fetchImpl(`${this.baseUrl}/health`, { signal, cache: 'no-store' })
      .then(response => response.ok)
      .then(value => {
        entry.value = value
        entry.expiresAt = Date.now() + HEALTH_CACHE_TTL_MS
        return value
      })
      .catch(error => {
        if (signal?.aborted) throw error
        entry.value = false
        entry.expiresAt = Date.now() + HEALTH_CACHE_TTL_MS
        return false
      })
      .finally(() => {
        if (healthCache.get(this.baseUrl)?.pending === pending) {
          entry.pending = undefined
          healthCache.set(this.baseUrl, entry)
        }
      })
    entry.pending = pending
    healthCache.set(this.baseUrl, entry)
    return pending
  }
  async health(signal?: AbortSignal): Promise<Record<string, unknown>> { const response = await this.fetchImpl(`${this.baseUrl}/health`, { signal, cache: 'no-store' }); if (!response.ok) throw new Error(await readError(response)); return response.json() as Promise<Record<string, unknown>> }
  async extract(image: Blob | string, dimensions?: string[], imageId?: string, signal?: AbortSignal): Promise<ExtractJob> {
    throwIfAborted(signal)
    const body = { image: await dataUrlBase64(image), ...(imageId ? { image_id: imageId } : {}), ...(dimensions ? { dimensions } : {}) }
    const response = await this.fetchImpl(`${this.baseUrl}/extract`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
    if (!response.ok) throw new Error(await readError(response))
    return response.json() as Promise<ExtractJob>
  }
  async getExtractJob(jobId: string, signal?: AbortSignal): Promise<ExtractResult> {
    const response = await this.fetchImpl(`${this.baseUrl}/extract/${encodeURIComponent(jobId)}`, { signal, cache: 'no-store' })
    if (response.status === 410) throw new Error('Taste extract job expired.')
    if (!response.ok) throw new Error(await readError(response))
    return response.json() as Promise<ExtractResult>
  }
  async extractAndWait(image: Blob | string, dimensions?: string[], imageId?: string, signal?: AbortSignal): Promise<ExtractResult> {
    const job = await this.extract(image, dimensions, imageId, signal)
    const deadline = Date.now() + EXTRACT_TIMEOUT_MS
    let delayMs = POLL_INITIAL_DELAY_MS
    while (Date.now() < deadline) {
      throwIfAborted(signal)
      const result = await this.getExtractJob(job.job_id, signal)
      if (result.status !== 'pending') return result
      await new Promise<void>((resolve, reject) => {
        const timer = globalThis.setTimeout(resolve, Math.min(delayMs, Math.max(0, deadline - Date.now())))
        const onAbort = () => { globalThis.clearTimeout(timer); reject(abortError()) }
        signal?.addEventListener('abort', onAbort, { once: true })
      })
      delayMs = Math.min(POLL_MAX_DELAY_MS, delayMs * 2)
    }
    throw new Error(`Taste extraction timed out after ${EXTRACT_TIMEOUT_MS / 1000} seconds.`)
  }
  async feedback(imageId: string, signal: TasteSignal, text?: string, dimension?: string): Promise<FeedbackResult> {
    const response = await this.fetchImpl(`${this.baseUrl}/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_id: imageId, signal, ...(text ? { text } : {}), ...(dimension ? { dimension } : {}) }) })
    if (!response.ok) throw new Error(await readError(response))
    return response.json() as Promise<FeedbackResult>
  }
  async profile(format: TasteFormat): Promise<TasteProfile> {
    const response = await this.fetchImpl(`${this.baseUrl}/profile`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format }) })
    if (!response.ok) throw new Error(await readError(response))
    return response.json() as Promise<TasteProfile>
  }
}

/** AIProvider-compatible facade; taste work uses the dedicated client methods, not chat send(). */
export const tasteProvider: AIProvider = {
  id: 'taste', label: 'NEXUS Taste', requiresKey: false, models: TASTE_MODELS,
  isConfigured(): Promise<boolean> { return new TasteProviderClient().isConfigured() },
  supportsTools(): boolean { return false },
  async send(request: AIRequest): Promise<AIResponse> { void request; throw new Error('NEXUS Taste uses extract, feedback, and profile methods, not chat send().') },
  async test(): Promise<void> { if (!await new TasteProviderClient().isConfigured()) throw new Error('NEXUS Taste service is unavailable.') },
}
