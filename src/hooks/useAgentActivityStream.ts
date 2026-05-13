import { useState, useEffect, useMemo, useCallback } from 'react'
import type { AgentActivityEvent } from '../types/reasoning'

interface UseAgentActivityStreamOptions {
  eventSource?: EventSource | null
}

export function useAgentActivityStream(options: UseAgentActivityStreamOptions = {}) {
  const [events, setEvents] = useState<AgentActivityEvent[]>([])
  const [isConnected, setIsConnected] = useState(false)

  // Window to last 20 events, memoized
  const windowedEvents = useMemo(() => events.slice(-20), [events])

  const addEvent = useCallback((event: AgentActivityEvent) => {
    setEvents(prev => {
      const next = [...prev, event]
      // Keep only last 100 events in memory, windowed to 20 for display
      return next.length > 100 ? next.slice(-100) : next
    })
  }, [])

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

    source.addEventListener('message', handleMessage)
    source.addEventListener('open', () => setIsConnected(true))
    source.addEventListener('error', () => setIsConnected(false))

    return () => {
      source.removeEventListener('message', handleMessage)
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
