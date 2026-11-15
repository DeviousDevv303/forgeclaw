// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

/**
 * Error log collector for ForgeClaw.
 * Captures errors, failed tool calls, and workflow failures.
 * Logs can be emailed for remote troubleshooting.
 */

export interface ErrorLogEntry {
  timestamp: number
  level: 'error' | 'warn' | 'info'
  source: string
  message: string
  details?: string
}

const MAX_ENTRIES = 200
const STORAGE_KEY = 'forgeclaw_error_log'

let memoryLog: ErrorLogEntry[] = []

function loadPersisted(): ErrorLogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.slice(-MAX_ENTRIES) : []
  } catch {
    return []
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryLog.slice(-MAX_ENTRIES)))
  } catch {
    // Storage full or unavailable — keep memory-only
  }
}

// 2026-10-23: memoryLog starts empty on every page load and persisted entries were only read back by
// getErrorLog — so the first write after a reload persisted [that one entry] and erased the saved
// history. Every failure count read from this log after a reload was an undercount. Writers now
// merge the persisted log in before their first write.
let hydrated = false
function hydrate() {
  if (hydrated) return
  memoryLog = [...loadPersisted(), ...memoryLog].slice(-MAX_ENTRIES)
  hydrated = true
}

export function logError(source: string, message: string, details?: string) {
  hydrate()
  const entry: ErrorLogEntry = {
    timestamp: Date.now(),
    level: 'error',
    source,
    message,
    details,
  }
  memoryLog.push(entry)
  if (memoryLog.length > MAX_ENTRIES) memoryLog = memoryLog.slice(-MAX_ENTRIES)
  persist()
}

export function logWarning(source: string, message: string, details?: string) {
  hydrate()
  const entry: ErrorLogEntry = {
    timestamp: Date.now(),
    level: 'warn',
    source,
    message,
    details,
  }
  memoryLog.push(entry)
  if (memoryLog.length > MAX_ENTRIES) memoryLog = memoryLog.slice(-MAX_ENTRIES)
  persist()
}

export function getErrorLog(): ErrorLogEntry[] {
  hydrate()
  return [...memoryLog].reverse() // newest first
}

export function clearErrorLog() {
  memoryLog = []
  hydrated = true
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

/** Install global error handlers to capture uncaught errors. */
export function installErrorHandlers() {
  if (typeof window === 'undefined') return

  window.addEventListener('error', (event) => {
    logError('window.onerror', event.message, `${event.filename}:${event.lineno}:${event.colno}`)
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason instanceof Error ? event.reason.message : String(event.reason)
    logError('unhandledrejection', reason, event.reason instanceof Error ? event.reason.stack?.slice(0, 500) : undefined)
  })
}
