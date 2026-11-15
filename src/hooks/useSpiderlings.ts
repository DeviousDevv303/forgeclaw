// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

/**
 * useSpiderlings — folds the ForgeOps event stream into the spider ledger. Observes only: it never emits an event and never
 * touches storage. `source` is carried on the ledger so a demo feed can never be mistaken for, or mixed into, a live one.
 */
import { useEffect, useRef, useState } from 'react'
import type { AgentEvent } from '../types/forgeOps'
import { emptyLedger, eventsAfter, foldSpiderEvents, type SpiderLedger, type SpiderSource } from '../lib/spiderlings'

export function useSpiderlings(events: readonly AgentEvent[], source: SpiderSource): SpiderLedger {
  const [ledger, setLedger] = useState<SpiderLedger>(() => emptyLedger(source, Date.now()))
  const lastRef = useRef<AgentEvent | null>(null)
  useEffect(() => {
    const fresh = eventsAfter(events, lastRef.current)
    if (fresh.length === 0) return
    lastRef.current = events[events.length - 1]
    setLedger(prev => foldSpiderEvents(prev, fresh))
  }, [events])
  return ledger
}

/** A one-second clock for "as of" and the staleness rule. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/**
 * DEMO feed. Scripted events through the same ledger so the owner can watch the spiders without running a task. It is only
 * created when the URL says `spiders=demo`, and everything it produces is labelled DEMO on screen: it is never live data.
 */
export function useSpiderDemoEvents(enabled: boolean): AgentEvent[] {
  // One start that happened 20 minutes ago and never got an end event: the staleness rule, shown as UNKNOWN.
  const [events, setEvents] = useState<AgentEvent[]>(() => (enabled ? [{ type: 'TOOL_START', tool: 'shell_patch', timestamp: Date.now() - 20 * 60_000, iter: 0 }] : []))
  useEffect(() => {
    if (!enabled) return
    const script: Array<[number, AgentEvent['type'], string, string?]> = [
      [600, 'TOOL_START', 'browser_run'], [1400, 'TOOL_START', 'shell_exec'], [2200, 'TOOL_START', 'qwen_reason'],
      [9000, 'TOOL_SUCCESS', 'browser_run'], [12000, 'TOOL_FAILURE', 'shell_exec', 'TOOL_FAILURE'], [15500, 'TOOL_SUCCESS', 'qwen_reason'],
    ]
    const timers = script.map(([ms, type, tool, failClass]) => setTimeout(() => {
      const timestamp = Date.now()
      const ev: AgentEvent = type === 'TOOL_START' ? { type, tool, timestamp, iter: 0 }
        : type === 'TOOL_SUCCESS' ? { type, tool, timestamp }
        : { type: 'TOOL_FAILURE', tool, failClass: (failClass ?? 'TOOL_FAILURE') as never, timestamp }
      setEvents(prev => [...prev, ev])
    }, ms))
    return () => timers.forEach(clearTimeout)
  }, [enabled])
  return events
}
