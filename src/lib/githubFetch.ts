// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Shared GitHub networking boundary ────────────────────────────────────────
// All browser-side GitHub operations use this boundary: shell_exec, DeepSeek,
// repository tools, image workflows, run correlation, and artifact retrieval.
// It bounds every request, retries only safe GitHub reads, uses no-store for API
// reads, propagates STOP, and never logs tokens or request bodies.

export const GITHUB_READ_RETRY_DELAYS_MS = [100, 250] as const
export const GITHUB_READ_RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504])
export const GITHUB_READ_TIMEOUT_MS = 60_000

/** Minimal structural context: anything carrying a run AbortSignal and optional per-stage deadline. */
export interface GithubFetchContext {
  signal?: AbortSignal
  timeoutMs?: number
}

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function getRequestMethod(input: RequestInfo | URL, init: RequestInit): string {
  if (init.method) return String(init.method).toUpperCase()
  if (typeof Request !== 'undefined' && input instanceof Request) return input.method.toUpperCase()
  return 'GET'
}

function isGithubApi(input: RequestInfo | URL): boolean {
  try { return new URL(getRequestUrl(input)).hostname === 'api.github.com' } catch { return false }
}

function isRetryableGithubRead(input: RequestInfo | URL, init: RequestInit): boolean {
  return ['GET', 'HEAD', 'OPTIONS'].includes(getRequestMethod(input, init)) && isGithubApi(input)
}

function waitForGithubRetry(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Run aborted', 'AbortError'))
      return
    }

    // `timer` is assigned after `onAbort` is defined because the callback closes over it.
    // eslint-disable-next-line prefer-const
    let timer: ReturnType<typeof setTimeout>
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(new DOMException('Run aborted', 'AbortError'))
    }

    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function toolFetch(
  ctx: GithubFetchContext,
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const method = getRequestMethod(input, init)
  const retryableRead = isRetryableGithubRead(input, init)
  const parentSignal = ctx.signal ?? init.signal ?? undefined
  const timeoutMs = Number.isFinite(ctx.timeoutMs) && (ctx.timeoutMs ?? 0) > 0
    ? Math.floor(ctx.timeoutMs!)
    : GITHUB_READ_TIMEOUT_MS
  const requestLabel = isGithubApi(input)
    ? method === 'GET' || method === 'HEAD' || method === 'OPTIONS' ? 'GitHub read' : `GitHub ${method.toLowerCase()}`
    : `${method} request`

  if (parentSignal?.aborted) throw new DOMException('Run aborted', 'AbortError')

  for (let attempt = 0; ; attempt += 1) {
    if (parentSignal?.aborted) throw new DOMException('Run aborted', 'AbortError')

    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    const onParentAbort = () => controller.abort()
    parentSignal?.addEventListener('abort', onParentAbort, { once: true })
    let retry = false

    try {
      const response = await fetch(input, {
        ...init,
        ...(isGithubApi(input) && retryableRead ? { cache: 'no-store' as RequestCache } : {}),
        signal: controller.signal,
      })
      if (retryableRead && GITHUB_READ_RETRYABLE_STATUSES.has(response.status) && attempt < GITHUB_READ_RETRY_DELAYS_MS.length) {
        await response.body?.cancel().catch(() => undefined)
        retry = true
      } else {
        return response
      }
    } catch (error) {
      if (parentSignal?.aborted) throw new DOMException('Run aborted', 'AbortError')
      if (timedOut) throw new Error(`${requestLabel} timed out after ${timeoutMs}ms`)
      if (!retryableRead || attempt >= GITHUB_READ_RETRY_DELAYS_MS.length) throw error
      retry = true
    } finally {
      clearTimeout(timer)
      parentSignal?.removeEventListener('abort', onParentAbort)
    }

    if (retry) await waitForGithubRetry(GITHUB_READ_RETRY_DELAYS_MS[attempt], parentSignal)
  }
}

// ─── Stage-specific failure reporting ─────────────────────────────────────────
// A bare browser "Failed to fetch" cannot distinguish CORS rejection, DNS,
// offline state, or a dropped connection. The caller supplies the current stage.

/** True when the thrown value is the browser's opaque network/CORS rejection. */
export function isBrowserNetworkFailure(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return false
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /failed to fetch|networkerror|load failed|network request failed|err_failed|err_connection/i.test(message)
}

/** Turn transport errors into a stage-labelled, non-sensitive operator message. */
export function describeGithubTransportFailure(stage: string, error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return `${stage}: request aborted.`
  if (isBrowserNetworkFailure(error)) {
    return `${stage}: browser network/CORS failure — the request produced no HTTP response (blocked redirect, blocked preflight, offline, or DNS failure).`
  }
  const message = error instanceof Error ? error.message : String(error ?? 'unknown failure')
  return `${stage}: ${message}`
}

/** HTTP-level failure for a GitHub stage that received a response. */
export function describeGithubHttpFailure(stage: string, status: number, statusText = ''): string {
  const detail = statusText.trim()
  return `${stage}: GitHub HTTP ${status}${detail ? ` ${detail}` : ''}.`
}

/** Preserve the most specific inner stage instead of wrapping it in a generic one. */
export async function githubStage<T>(stage: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.startsWith(`${stage}:`)) throw error
    throw new Error(describeGithubTransportFailure(stage, error))
  }
}
