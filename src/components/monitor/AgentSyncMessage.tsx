import { memo } from 'react'
import type { AgentActivityEvent } from '../../types/reasoning'

interface AgentSyncMessageProps {
  event: Extract<AgentActivityEvent, { type: 'agent_message' }>
}

const priorityConfig = {
  info: { color: 'text-slate-300', border: 'border-slate-600' },
  blocker: { color: 'text-red-300', border: 'border-red-600' },
  proposal: { color: 'text-blue-300', border: 'border-blue-600' },
}

export const AgentSyncMessage = memo(function AgentSyncMessage({ event }: AgentSyncMessageProps) {
  const config = priorityConfig[event.priority]

  return (
    <div className={`flex gap-2 py-1.5 border-l-2 ${config.border} pl-3`}>
      <span className="text-xs text-slate-500 font-mono shrink-0">
        {new Date(event.timestamp).toLocaleTimeString('en-US', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
        })}
      </span>
      <span className="text-xs text-slate-500 shrink-0">{event.agentId}:</span>
      <span className={`text-xs ${config.color}`}>{event.message}</span>
    </div>
  )
})
