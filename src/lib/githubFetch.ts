// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── GitHub networking boundary ───────────────────────────────────────────────
// One hardened boundary for every browser → api.github.com request. Workflow
// dispatch (shell_exec, generate_image, deepseek_reason), run correlation,
// status polling and artifact listing all share this implementation so the
// DeepSeek path cannot drift into a second, subtly different networking stack.
//
// Responsibilities:
//   • bounded timeout via AbortController (never leave a request pending forever)
//   • bounded retry for transient GitHub READ responses
//   • propagate the run's AbortSignal (user STOP)
//   • never log or return tokens / request bodies
//
// This module knows nothing about tools. `forgeTools.ts` re-exports `toolFetch`
// so existing call sites and tests keep working.

export const GITHUB_READ_RETRY_DELAYS_MS = [100, 250] as const
export const GITHUB_READ_RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504])
export const GITHUB_READ_TIMEOUT_MS = 60_000

/** Minimal structural context: anything carrying a run AbortSignal. */
export interface GithubFetchContext {
  signal?: AbortSignal
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

function isRetryableGithubRead(input: RequestInfo | URL, init: RequestInit): boolean {
  const method = getRequestMethod(input, init)
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) return false
  try {
    return new URL(getRequestUrl(input)).hostname === 'api.github.com'
  } catch {
    return false
  }
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
  if (ctx.signal?.aborted) throw new DOMException('Run aborted', 'AbortError')

  if (!isRetryableGithubRead(input, init)) {
    return fetch(input, { ...init, signal: ctx.signal ?? init.signal })
  }

  for (let attempt = 0; ; attempt += 1) {
    if (ctx.signal?.aborted) throw new DOMException('Run aborted', 'AbortError')

    const controller = new AbortController()
    const parentSignal = ctx.signal ?? init.signal
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, GITHUB_READ_TIMEOUT_MS)

    const onParentAbort = () => controller.abort()

    if (parentSignal?.aborted) {
      throw new DOMException('Run aborted', 'AbortError')
    }

    parentSignal?.addEventListener('abort', onParentAbort, { once: true })

    try {
      const response = await fetch(input, {
        ...init,
        signal: controller.signal,
      })

      if (
        !GITHUB_READ_RETRYABLE_STATUSES.has(response.status) ||
        attempt >= GITHUB_READ_RETRY_DELAYS_MS.length
      ) {
        return response
      }
    } catch (error) {
      if (parentSignal?.aborted) {
        throw new DOMException('Run aborted', 'AbortError')
      }

      if (timedOut) {
        throw new Error(`GitHub read timed out after ${GITHUB_READ_TIMEOUT_MS}ms`)
      }

      if (attempt >= GITHUB_READ_RETRY_DELAYS_MS.length) throw error
    } finally {
      clearTimeout(timer)
      parentSignal?.removeEventListener('abort', onParentAbort)
    }

    await waitForGithubRetry(GITHUB_READ_RETRY_DELAYS_MS[attempt], ctx.signal)
  }
}

// ─── Stage-specific failure reporting ─────────────────────────────────────────
// A bare browser "Failed to fetch" cannot distinguish a CORS rejection from a
// dropped network, a DNS failure or a blocked redirect. Every DeepSeek stage
// labels its own failure so the operator can see WHERE the path broke without
// ever exposing the token or the request body.

/** True when the thrown value is the browser's opaque network/CORS rejection. */
export function isBrowserNetworkFailure(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return false
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /failed to fetch|networkerror|load failed|network request failed|err_failed|err_connection/i.test(message)
}

/**
 * Turn any thrown transport error into a stage-labelled, non-sensitive message.
 * `stage` is a short stable label such as `deepseek-dispatch`.
 */
export function describeGithubTransportFailure(stage: string, error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return `${stage}: request aborted.`
  }
  if (isBrowserNetworkFailure(error)) {
    return `${stage}: browser network/CORS failure — the request produced no HTTP response (blocked redirect, blocked preflight, offline, or DNS failure).`
  }
  const message = error instanceof Error ? error.message : String(error ?? 'unknown failure')
  return `${stage}: ${message}`
}

/** HTTP-level failure for a GitHub stage that DID receive a response. */
export function describeGithubHttpFailure(stage: string, status: number, statusText = ''): string {
  const detail = statusText.trim()
  return `${stage}: GitHub HTTP ${status}${detail ? ` ${detail}` : ''}.`
}

/**
 * Run one stage of a GitHub-backed pipeline, tagging any thrown error with the
 * stage label exactly once. Errors already tagged by an inner stage are passed
 * through unchanged so the innermost (most specific) label is preserved.
 */
export async function githubStage<T>(stage: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.startsWith(`${stage}:`)) throw error
    throw new Error(describeGithubTransportFailure(stage, error))
  }
}