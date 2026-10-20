// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Public visitor mode ─────────────────────────────────────────────────────
// A visitor of the public site has no GitHub token, so the model workflow is reached through the
// owner's relay (relay/worker.js), which holds a token limited to that one workflow. The owner's own
// browser has a token and never uses the relay. Nothing of the owner's session (keys, NEXUS, tools) is
// involved: the relay only runs the chat model and returns its text.

export const PUBLIC_RELAY_URL: string = (import.meta.env.VITE_PUBLIC_RELAY_URL as string | undefined)?.trim().replace(/\/+$/, '') ?? ''
export const PUBLIC_RELAY_MAX_WAIT_MS = 20 * 60 * 1000

/** Visitor mode: a relay is configured for this build and this browser has no GitHub token. */
export function isPublicVisitor(ghToken: string, relayUrl = PUBLIC_RELAY_URL): boolean {
  return !!relayUrl && !ghToken.trim()
}

export const PUBLIC_MODE_NOTICE =
  'Public mode: your messages run on ForgeClaw\'s public GitHub Actions model (Qwen3-8B, a few minutes per answer). ' +
  'Do not enter private information. Add your own GitHub token or Kimi/Claude key in Settings for full tools.'

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

/** Ask the public model through the relay and wait for its answer. */
export async function runPublicReasoning(task: string, options: PublicReasoningOptions = {}): Promise<{ invocationId: string; result: string; model: string }> {
  const relay = options.relayUrl ?? PUBLIC_RELAY_URL
  if (!relay) throw new Error('Public mode is not configured for this site.')
  const doFetch = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const now = options.now ?? Date.now
  const start = await doFetch(`${relay}/v1/reason`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task: task.slice(0, 4000) }), signal: options.signal })
  if (!start.ok) throw new Error(`The public model could not start: ${await relayError(start)}`)
  const { invocation_id: invocationId } = await start.json() as { invocation_id: string }
  const began = now()
  for (let attempt = 0; now() - began < PUBLIC_RELAY_MAX_WAIT_MS; attempt++) {
    if (options.signal?.aborted) throw new DOMException('Run aborted', 'AbortError')
    if (attempt) await sleep(10_000)
    const res = await doFetch(`${relay}/v1/reason/${encodeURIComponent(invocationId)}`, { signal: options.signal })
    if (!res.ok) throw new Error(`The public model failed: ${await relayError(res)}`)
    const state = await res.json() as { status: string; result?: string; model?: string; conclusion?: string }
    if (state.status === 'done') return { invocationId, result: state.result || '', model: state.model || '' }
    if (state.status === 'failed') throw new Error(`The public model run ${invocationId} failed (${state.conclusion || 'unknown'}).`)
  }
  throw new Error(`The public model did not answer within ${PUBLIC_RELAY_MAX_WAIT_MS / 60000} minutes (run ${invocationId}).`)
}
