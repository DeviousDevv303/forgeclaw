// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Public visitor mode ─────────────────────────────────────────────────────
// A visitor of the public site has no GitHub token, so the model workflow is reached through the
// owner's relay (relay/worker.js), which holds a token limited to that one workflow. The owner's own
// browser has a token and never uses the relay. Nothing of the owner's session (keys, NEXUS, tools) is
// involved: the relay only runs the chat model and returns its text.

import type { ResearchReport } from './deepResearch'
import { translate } from './i18n'

export const PUBLIC_RELAY_URL: string = (import.meta.env.VITE_PUBLIC_RELAY_URL as string | undefined)?.trim().replace(/\/+$/, '') ?? ''
export const PUBLIC_RELAY_MAX_WAIT_MS = 20 * 60 * 1000

/** Visitor mode: a relay is configured for this build and this browser has no GitHub token. */
export function isPublicVisitor(ghToken: string, relayUrl = PUBLIC_RELAY_URL): boolean {
  return !!relayUrl && !ghToken.trim()
}

export const PUBLIC_MODE_NOTICE = translate('en', 'public.notice')

export interface PublicReasoningOptions {
  relayUrl?: string
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

async function relayError(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({})) as { error?: string }
  return body.error || `relay ${res.status}`
}

/** Context the relay accepts with a task: gathered web evidence, about 4K tokens of the model's 8K window. */
export const PUBLIC_RELAY_MAX_CONTEXT_CHARS = 16_000

/** Start a relay job, then poll it until it is done; returns the final state. */
async function runRelayJob<T extends { status: string; conclusion?: string }>(route: 'reason' | 'research', payload: Record<string, string>, what: string, options: PublicReasoningOptions): Promise<{ invocationId: string; state: T }> {
  const relay = options.relayUrl ?? PUBLIC_RELAY_URL
  if (!relay) throw new Error('Public mode is not configured for this site.')
  const doFetch = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const now = options.now ?? Date.now
  const start = await doFetch(`${relay}/v1/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: options.signal })
  if (!start.ok) throw new Error(`${what} could not start: ${await relayError(start)}`)
  const { invocation_id: invocationId } = await start.json() as { invocation_id: string }
  const began = now()
  for (let attempt = 0; now() - began < PUBLIC_RELAY_MAX_WAIT_MS; attempt++) {
    if (options.signal?.aborted) throw new DOMException('Run aborted', 'AbortError')
    if (attempt) await sleep(route === 'research' ? 5_000 : 10_000)
    const res = await doFetch(`${relay}/v1/${route}/${encodeURIComponent(invocationId)}`, { signal: options.signal })
    if (!res.ok) throw new Error(`${what} failed: ${await relayError(res)}`)
    const state = await res.json() as T
    if (state.status === 'done') return { invocationId, state }
    if (state.status === 'failed') throw new Error(`${what} run ${invocationId} failed (${state.conclusion || 'unknown'}).`)
  }
  throw new Error(`${what} did not answer within ${PUBLIC_RELAY_MAX_WAIT_MS / 60000} minutes (run ${invocationId}).`)
}

/** Ask the public model through the relay and wait for its answer. Evidence goes in context, not the task. */
export async function runPublicReasoning(task: string, options: PublicReasoningOptions & { context?: string } = {}): Promise<{ invocationId: string; result: string; model: string }> {
  const payload: Record<string, string> = { task: task.slice(0, 4000) }
  if (options.context?.trim()) payload.context = options.context.trim().slice(0, PUBLIC_RELAY_MAX_CONTEXT_CHARS)
  const { invocationId, state } = await runRelayJob<{ status: string; result?: string; model?: string; conclusion?: string }>('reason', payload, 'The public model', options)
  return { invocationId, result: state.result || '', model: state.model || '' }
}

/** Live web research for a visitor, through the relay (deep-research.yml). */
export async function runPublicResearch(question: string, options: PublicReasoningOptions = {}): Promise<{ invocationId: string; report: ResearchReport; runUrl: string }> {
  const { invocationId, state } = await runRelayJob<{ status: string; report?: ResearchReport; run_url?: string; conclusion?: string }>('research', { question: question.trim().slice(0, 500) }, 'Web research', options)
  if (!state.report) throw new Error(`Web research run ${invocationId} returned no report.`)
  return { invocationId, report: state.report, runUrl: state.run_url || '' }
}
