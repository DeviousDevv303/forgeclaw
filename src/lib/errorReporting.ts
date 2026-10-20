// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Error reports to the developer ──────────────────────────────────────────
// Every ForgeClaw user's error log (visitors and the owner) is sent to the relay, which stores it and
// emails the developer (relay/worker.js /v1/errors). No setup for the user. Secrets are redacted here
// and again in the relay; only entries newer than the last successful report are sent.

import { getErrorLog, type ErrorLogEntry } from './errorLog'
import { PUBLIC_RELAY_URL } from './publicRelay'
import { sanitizeShellOutput } from './shellLearning'

const SENT_UNTIL_KEY = 'fc_error_reports_sent_until'
export const ERROR_REPORT_INTERVAL_MS = 5 * 60 * 1000

function sentUntil(): number {
  try { return Number(localStorage.getItem(SENT_UNTIL_KEY)) || 0 } catch { return 0 }
}

export function pendingErrorEntries(entries: ErrorLogEntry[] = getErrorLog(), after = sentUntil()): ErrorLogEntry[] {
  return entries.filter(e => e.timestamp > after).slice(-30)
}

/** Send new error entries once; returns how many were reported (0 when there was nothing or no relay). */
export async function reportErrorsNow(mode: 'owner' | 'visitor', options: { relayUrl?: string; fetchImpl?: typeof fetch; entries?: ErrorLogEntry[] } = {}): Promise<number> {
  const relay = options.relayUrl ?? PUBLIC_RELAY_URL
  const pending = pendingErrorEntries(options.entries)
  if (!relay || !pending.length) return 0
  const entries = pending.map(e => ({ ...e, message: sanitizeShellOutput(e.message).output, details: e.details ? sanitizeShellOutput(e.details).output : undefined }))
  try {
    const res = await (options.fetchImpl ?? fetch)(`${relay}/v1/errors`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, app: import.meta.env.VITE_APP_VERSION || '', entries }),
      keepalive: true,
    })
    if (!res.ok) return 0
    try { localStorage.setItem(SENT_UNTIL_KEY, String(Math.max(...pending.map(e => e.timestamp)))) } catch { /* resend next time */ }
    return pending.length
  } catch {
    return 0  // offline or blocked: kept and retried on the next interval
  }
}

/** Report on an interval and when the tab is hidden. Returns a stop function. */
export function startErrorReporting(getMode: () => 'owner' | 'visitor'): () => void {
  if (!PUBLIC_RELAY_URL) return () => {}
  const tick = () => { void reportErrorsNow(getMode()) }
  const timer = globalThis.setInterval(tick, ERROR_REPORT_INTERVAL_MS)
  const onHide = () => { if (document.visibilityState === 'hidden') tick() }
  document.addEventListener('visibilitychange', onHide)
  const first = globalThis.setTimeout(tick, 15_000)
  return () => { globalThis.clearInterval(timer); globalThis.clearTimeout(first); document.removeEventListener('visibilitychange', onHide) }
}
