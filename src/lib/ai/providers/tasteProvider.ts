import type { AIProvider, AIRequest, AIResponse } from '../types'

export const DEFAULT_TASTE_ENDPOINT = 'http://127.0.0.1:8377/v1'
export const TASTE_MODELS = [{ id: 'nexus-taste-v1', label: 'NEXUS Taste v1', contextK: 0, note: 'Local aesthetic preference service' }]
export type TasteSignal = 'fire' | 'up' | 'down'
export type TasteFormat = 'generation' | 'raw' | 'full'
export interface ExtractJob { job_id: string; status_url: string }
export interface ExtractResult { status: 'pending' | 'complete' | 'failed'; image_id?: string; features?: Record<string, { value: number; confidence: number }>; error?: string; detail?: string; extraction_time_ms?: number; extraction_model?: string; prompt_version?: string }
export interface FeedbackResult { image_id: string; routing: string; update_type: string; dimensions_updated: string[]; centroid_displacement: number; alpha_effective: number; drift_flag: boolean }
export interface TasteProfile { profile?: Record<string, string>; confidence?: Record<string, number>; centroid?: Record<string, number>; event_count: number; alpha_current?: number; drift_flag: boolean; fallback_active?: boolean; clusters?: unknown[] }

type Fetcher = typeof fetch
async function readError(response: Response): Promise<string> {
  const raw = await response.text().catch(() => '')
  try { const parsed = JSON.parse(raw) as { detail?: string; error?: string }; return parsed.detail || parsed.error || `Taste service HTTP ${response.status}` } catch { return raw || `Taste service HTTP ${response.status}` }
}
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
  constructor(baseUrl = DEFAULT_TASTE_ENDPOINT, fetchImpl: Fetcher = fetch) { this.baseUrl = baseUrl; this.fetchImpl = fetchImpl }
  async isConfigured(): Promise<boolean> { try { const response = await this.fetchImpl(`${this.baseUrl}/health`); return response.ok } catch { return false } }
  async health(): Promise<Record<string, unknown>> { const response = await this.fetchImpl(`${this.baseUrl}/health`); if (!response.ok) throw new Error(await readError(response)); return response.json() as Promise<Record<string, unknown>> }
  async extract(image: Blob | string, dimensions?: string[], imageId?: string): Promise<ExtractJob> {
    const body = { image: await dataUrlBase64(image), ...(imageId ? { image_id: imageId } : {}), ...(dimensions ? { dimensions } : {}) }
    const response = await this.fetchImpl(`${this.baseUrl}/extract`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!response.ok) throw new Error(await readError(response))
    return response.json() as Promise<ExtractJob>
  }
  async getExtractJob(jobId: string): Promise<ExtractResult> {
    const response = await this.fetchImpl(`${this.baseUrl}/extract/${encodeURIComponent(jobId)}`)
    if (response.status === 410) throw new Error('Taste extract job expired.')
    if (!response.ok) throw new Error(await readError(response))
    return response.json() as Promise<ExtractResult>
  }
  async extractAndWait(image: Blob | string, dimensions?: string[], imageId?: string, signal?: AbortSignal): Promise<ExtractResult> {
    const job = await this.extract(image, dimensions, imageId)
    const deadline = Date.now() + 120_000
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new DOMException('Taste extract aborted', 'AbortError')
      const result = await this.getExtractJob(job.job_id)
      if (result.status !== 'pending') return result
      await new Promise<void>((resolve, reject) => { const timer = globalThis.setTimeout(resolve, 2000); signal?.addEventListener('abort', () => { globalThis.clearTimeout(timer); reject(new DOMException('Taste extract aborted', 'AbortError')) }, { once: true }) })
    }
    throw new Error('Taste extraction timed out after 120 seconds.')
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

/** AIProvider-compatible facade for registry/status code; taste work uses the dedicated methods above. */
export const tasteProvider: AIProvider = {
  id: 'taste', label: 'NEXUS Taste', requiresKey: false, models: TASTE_MODELS,
  isConfigured(): boolean { return true }, supportsTools(): boolean { return false },
  async send(request: AIRequest): Promise<AIResponse> { void request; throw new Error('NEXUS Taste uses extract, feedback, and profile methods, not chat send().') },
  async test(): Promise<void> { if (!await new TasteProviderClient().isConfigured()) throw new Error('NEXUS Taste service is unavailable.') },
}
