import { memo } from 'react'
import type { AgentActivityEvent } from '../../types/reasoning'

interface MonitorEventRowProps {
  event: AgentActivityEvent
}

export const MonitorEventRow = memo(function MonitorEventRow({ event }: MonitorEventRowProps) {
  const typeColors: Record<string, string> = {
    tool_call: 'text-yellow-400',
    file_read: 'text-blue-400',
    file_write: 'text-green-400',
    reasoning_phase: 'text-orange-400',
    agent_status: 'text-slate-400',
    error: 'text-red-400',
  }

  const typeLabels: Record<string, string> = {
    tool_call: 'TOOL',
    file_read: 'READ',
    file_write: 'WRITE',
    reasoning_phase: 'REASON',
    agent_status: 'STATUS',
    error: 'ERROR',
  }

  // Type-safe detail extraction
  let detail = ''
  switch (event.type) {
    case 'tool_call':
      detail = event.tool
      break
    case 'file_read':
    case 'file_write':
      detail = event.path
      break
    case 'reasoning_phase':
      detail = event.phase
      break
    case 'agent_status':
      detail = event.status
      break
    case 'error':
      detail = event.message.slice(0, 40)
      break
  }

  return (
    <div className="flex items-center gap-2 text-xs font-mono">
      <span className={typeColors[event.type] || 'text-slate-400'}>
        {typeLabels[event.type] || event.type.toUpperCase()}
      </span>
      <span className="text-slate-500">{detail}</span>
      <span className="text-slate-700 ml-auto">
        {new Date(event.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </span>
    </div>
  )
})
