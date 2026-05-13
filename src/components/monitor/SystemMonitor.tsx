import { useState, useMemo, memo, useEffect } from 'react'
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
}

export const SystemMonitor = memo(function SystemMonitor({ 
  events, 
  isActive = false, 
  expanded: expandedProp,
  lanes = [],
  proposals = [],
}: SystemMonitorProps) {
  const [expanded, setExpanded] = useState(expandedProp ?? false)

  // Sync with external expanded prop (Cycle 2: War Room control)
  useEffect(() => {
    if (expandedProp !== undefined) {
      setExpanded(expandedProp)
    }
  }, [expandedProp])

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
                  <ProposalCard key={proposal.id} proposal={proposal} />
                ))}
              </div>
            </div>
          )}

          {/* Agent Sync scrollback */}
          {agentMessages.length > 0 && (
            <div className="border-t border-slate-700 pt-2 mb-2">
              <div className="text-xs text-slate-500 mb-1">Agent Sync</div>
              <div className="space-y-0.5">
                {agentMessages.map((msg, i) => (
                  <AgentSyncMessage key={`${msg.timestamp}-${i}`} event={msg} />
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