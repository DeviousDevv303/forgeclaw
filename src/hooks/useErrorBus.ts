import { useState, useCallback, useEffect } from 'react'
import type { FailureEvent, FailureSeverity, FailureSource } from '../types/errorBus'
import { safeGetItem, safeSetItem } from '../lib/storage'

const STORAGE_KEY = 'forgeclaw_failure_ledger'

function loadLedger(): FailureEvent[] {
  const raw = safeGetItem(STORAGE_KEY)
  if (!raw) return []
  try {
    return JSON.parse(raw) as FailureEvent[]
  } catch {
    return []
  }
}

function saveLedger(ledger: FailureEvent[]): void {
  safeSetItem(STORAGE_KEY, JSON.stringify(ledger))
}

export interface EmitFailureOptions {
  source: FailureSource
  severity: FailureSeverity
  message: string
  context?: Record<string, unknown>
}

export function useErrorBus() {
  const [ledger, setLedger] = useState<FailureEvent[]>(() => {
    // Clear old errors on fresh mount to prevent stale error display
    const fresh = loadLedger()
    return fresh.filter(e => {
      const age = Date.now() - new Date(e.timestamp).getTime()
      return age < 300000 // Keep only errors from last 5 minutes
    })
  })

  useEffect(() => {
    saveLedger(ledger)
  }, [ledger])

  const emitFailure = useCallback((opts: EmitFailureOptions) => {
    const event: FailureEvent = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      source: opts.source,
      severity: opts.severity,
      message: opts.message,
      context: opts.context,
      resolved: false,
    }
    setLedger(prev => [event, ...prev])
    return event.id
  }, [])

  const resolveFailure = useCallback((id: string) => {
    setLedger(prev =>
      prev.map(e => e.id === id ? { ...e, resolved: true } : e)
    )
  }, [])

  const clearResolved = useCallback(() => {
    setLedger(prev => prev.filter(e => !e.resolved))
  }, [])

  const unresolvedCount = ledger.filter(e => !e.resolved).length

  return { ledger, emitFailure, resolveFailure, clearResolved, unresolvedCount }
}
