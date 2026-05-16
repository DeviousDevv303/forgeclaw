// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). AGPL-3.0 License.
// Original work. Unauthorized commercial use prohibited. https://github.com/DeviousDevv303/forgeclaw
import { memo } from 'react'
import type { AgentLane as AgentLaneType } from '../../types/warRoom'

interface AgentLaneProps {
  lane: AgentLaneType
}

const statusConfig = {
  idle: { dot: 'bg-slate-500', label: 'Idle' },
  working: { dot: 'bg-orange-500 animate-pulse', label: 'Working' },
  blocked: { dot: 'bg-red-500', label: 'Blocked' },
  reviewing: { dot: 'bg-yellow-500', label: 'Reviewing' },
}

export const AgentLane = memo(function AgentLane({ lane }: AgentLaneProps) {
  const config = statusConfig[lane.status]

  return (
    <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-2 h-2 rounded-full ${config.dot}`} />
        <span className="text-sm font-medium text-slate-200">{lane.agentId}</span>
        <span className="text-xs text-slate-500 ml-auto">{config.label}</span>
      </div>
      
      {lane.currentTask && (
        <div className="text-xs text-slate-400 mb-1 truncate">
          {lane.currentTask}
        </div>
      )}
      
      <div className="flex items-center gap-2 text-xs text-slate-600">
        {lane.sha && <span className="font-mono">{lane.sha.slice(0, 7)}</span>}
        <span className="ml-auto">
          {new Date(lane.lastActivity).toLocaleTimeString('en-US', { 
            hour12: false, 
            hour: '2-digit', 
            minute: '2-digit' 
          })}
        </span>
      </div>
    </div>
  )
})
