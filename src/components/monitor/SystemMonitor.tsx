import { useState, useMemo } from 'react'
import type { AgentActivityEvent } from '../../types/reasoning'
import { MonitorEventRow } from './MonitorEventRow'

interface SystemMonitorProps {
  events: AgentActivityEvent[]
  isActive?: boolean
}

export const SystemMonitor = ({ events, isActive = false }: SystemMonitorProps) => {
  const [expanded, setExpanded] = useState(false)

  // Auto-expand on activity, collapse after idle
  const displayEvents = useMemo(() => {
    return events.slice(-5)
  }, [events])

  const hasErrors = useMemo(() => events.some(e => e.type === 'error'), [events])

  return (
    <div
      className={`border-t border-slate-700 bg-slate-900/50 backdrop-blur-sm transition-all duration-200 ${
        expanded ? 'max-h-48' : 'max-h-8'
      } overflow-hidden`}
    >
      {/* Collapsed strip */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-1.5 text-xs"
      >
        <span className={`${isActive ? 'animate-pulse text-yellow-400' : 'text-slate-500'}`}>
          {isActive ? '⚡' : '💤'}
        </span>
        <span className="text-slate-400 font-mono">
          Cristian's Computer
        </span>
        <span className="text-xs text-slate-600 ml-auto">
          {displayEvents.length > 0
            ? `${displayEvents.length} events`
            : 'System idle'}
        </span>
        {hasErrors && <span className="text-red-400 ml-auto">● Error</span>}
        <span className="text-slate-600 ml-auto">{expanded ? '▼' : '▶'}</span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 pb-2 space-y-1">
          {displayEvents.map((event, i) => (
            <MonitorEventRow key={`${event.timestamp}-${i}`} event={event} />
          ))}
        </div>
      )}
    </div>
  )
}
