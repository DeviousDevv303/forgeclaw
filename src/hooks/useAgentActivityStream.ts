// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import type { AgentActivityEvent } from '../types/reasoning'

interface UseAgentActivityStreamOptions {
  eventSource?: EventSource | null
}

export function useAgentActivityStream(options: UseAgentActivityStreamOptions = {}) {
  const [events, setEvents] = useState<AgentActivityEvent[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const addEventRef = useRef<(event: AgentActivityEvent) => void>(() => {})

  // Window to last 20 events, memoized
  const windowedEvents = useMemo(() => events.slice(-20), [events])

  const addEvent = useCallback((event: AgentActivityEvent) => {
    setEvents(prev => {
      const next = [...prev, event]
      // Keep only last 100 events in memory, windowed to 20 for display
      return next.length > 100 ? next.slice(-100) : next
    })
  }, [])

  // Stable ref — kept in sync via effect so it never goes stale
  useEffect(() => { addEventRef.current = addEvent }, [addEvent])

  const clearEvents = useCallback(() => {
    setEvents([])
  }, [])

  // If EventSource provided, subscribe to it
  useEffect(() => {
    const source = options.eventSource
    if (!source) return

    const handleMessage = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as AgentActivityEvent
        addEvent(data)
      } catch {
        // Silently ignore malformed events
      }
    }

    const handleOpen = () => setIsConnected(true)
    const handleError = () => setIsConnected(false)

    source.addEventListener('message', handleMessage)
    source.addEventListener('open', handleOpen)
    source.addEventListener('error', handleError)

    return () => {
      source.removeEventListener('message', handleMessage)
      source.removeEventListener('open', handleOpen)
      source.removeEventListener('error', handleError)
    }
  }, [options.eventSource, addEvent])

  return {
    events: windowedEvents,
    allEvents: events,
    isConnected,
    addEvent,
    clearEvents,
  }
}
