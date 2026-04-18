import { useState, useCallback, useEffect } from 'react'
import type { FailureEvent, FailureSeverity, FailureSource } from '../types/errorBus'

const STORAGE_KEY = 'forgeclaw_failure_ledger'

function loadLedger(): FailureEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as FailureEvent[]) : []
  } catch {
    return []
  }
}

function saveLedger(ledger: FailureEvent[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger))
}

export interface EmitFailureOptions {
  source: FailureSource
  severity: FailureSeverity
  message: string
  context?: Record<string, unknown>
}

export function useErrorBus() {
  const [ledger, setLedger] = useState<FailureEvent[]>(loadLedger)

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
