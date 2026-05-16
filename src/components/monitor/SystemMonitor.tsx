// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). AGPL-3.0 License.
// Original work. Unauthorized commercial use prohibited. https://github.com/DeviousDevv303/forgeclaw
import { useState, useMemo, memo } from 'react'
import type { AgentActivityEvent } from '../../types/reasoning'
import type { AgentLane as AgentLaneType, Proposal as ProposalType } from '../../types/warRoom'
import { MonitorEventRow } from './MonitorEventRow'
import { AgentLane } from './AgentLane'
import { ProposalCard } from './ProposalCard'
import { AgentSyncMessage } from './AgentSyncMessage'

interface SystemMonitorProps {
  events: AgentActivityEvent[]
  isActive?: boolean
  expanded?: boolean  // Cycle 2: War Room expanded view
  lanes?: AgentLaneType[]  // Cycle 2: Agent lanes from useWarRoom
  proposals?: ProposalType[]  // Cycle 2: Proposals from useWarRoom
  onAcknowledge?: (targetId: string) => void  // Cycle 3: Proposal write-back
  onReject?: (targetId: string) => void  // Cycle 3: Proposal write-back
}

export const SystemMonitor = memo(function SystemMonitor({ 
  events, 
  isActive = false, 
  expanded: expandedProp,
  lanes = [],
  proposals = [],
  onAcknowledge,
  onReject,
}: SystemMonitorProps) {
  const [internalExpanded, setInternalExpanded] = useState(expandedProp ?? false)
  // When expandedProp is provided, it acts as the controlled value
  const expanded = expandedProp !== undefined ? expandedProp : internalExpanded
  const setExpanded = (v: boolean) => { if (expandedProp === undefined) setInternalExpanded(v) }

  // Auto-expand on activity, collapse after idle
  const displayEvents = useMemo(() => {
    return events.slice(-20)
  }, [events])

  const hasErrors = useMemo(() => events.some(e => e.type === 'error'), [events])

  // Filter agent_message events for sync scrollback
  const agentMessages = useMemo(() => {
    return events.filter((e): e is Extract<AgentActivityEvent, { type: 'agent_message' }> => 
      e.type === 'agent_message'
    ).slice(-10)
  }, [events])

  const hasWarRoomData = lanes.length > 0 || proposals.length > 0

  return (
    <div
      className={`border-t border-slate-700 bg-slate-900/50 backdrop-blur-sm transition-all duration-200 ${
        expanded ? (hasWarRoomData ? 'max-h-[520px]' : 'max-h-48') : 'max-h-8'
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
        <div className="px-3 pb-2 space-y-1 overflow-y-auto">
          {/* War Room: Agent Lanes + Proposals */}
          {hasWarRoomData && (
            <div className="grid grid-cols-3 gap-2 mb-3">
              {/* Agent Lanes */}
              <div className="col-span-2 space-y-2">
                {lanes.map(lane => (
                  <AgentLane key={lane.agentId} lane={lane} />
                ))}
              </div>
              
              {/* Proposals */}
              <div className="space-y-2">
                {proposals.map(proposal => (
                  <ProposalCard 
                    key={proposal.id} 
                    proposal={proposal} 
                    onAcknowledge={onAcknowledge}
                    onReject={onReject}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Agent Sync scrollback */}
          {agentMessages.length > 0 && (
            <div className="border-t border-slate-700 pt-2 mb-2">
              <div className="text-xs text-slate-500 mb-1">Agent Sync</div>
              <div className="space-y-0.5">
                {agentMessages.map((msg) => (
                  <AgentSyncMessage key={`${msg.agentId}-${msg.timestamp}`} event={msg} />
                ))}
              </div>
            </div>
          )}

          {/* Raw events (fallback when no War Room data) */}
          {!hasWarRoomData && displayEvents.map((event) => (
            <MonitorEventRow key={`${event.type}-${event.timestamp}-${event.agentId}`} event={event} />
          ))}
        </div>
      )}
    </div>
  )
})