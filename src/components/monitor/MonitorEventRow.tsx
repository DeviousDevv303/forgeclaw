import React, { memo } from 'react'
import type { OrchestratorEvent } from '../../types/orchestrator'

const EVENT_COLORS: Record<OrchestratorEvent['type'], string> = {
  task_admitted: '#10b981',
  task_rejected: '#ef4444',
  authority_violation: '#ef4444',
  recovery_triggered: '#eab308',
}

const EVENT_ICONS: Record<OrchestratorEvent['type'], string> = {
  task_admitted: '▶',
  task_rejected: '✗',
  authority_violation: '⚠',
  recovery_triggered: '↺',
}

interface Props {
  event: OrchestratorEvent
  now: number
}

export const MonitorEventRow = memo(function MonitorEventRow({ event, now }: Props) {
  const delta = Math.round((now - Date.parse(event.timestamp)) / 1000)
  const ageStr = delta < 60 ? `${delta}s` : `${Math.round(delta / 60)}m`
  const color = EVENT_COLORS[event.type]
  const icon = EVENT_ICONS[event.type]

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 0', fontSize: '9px', fontFamily: 'monospace' }}>
      <span style={{ color, width: '10px', textAlign: 'center', flexShrink: 0 }}>{icon}</span>
      <span style={{ color: '#555', flexShrink: 0, minWidth: '22px' }}>{ageStr}</span>
      <span style={{ color: '#777', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {event.type.replace(/_/g, ' ')}
        {' · '}
        <span style={{ color: '#555' }}>{event.agentId}</span>
        {event.taskSpec?.taskId && (
          <span style={{ color: '#444' }}>{' · '}{event.taskSpec.taskId.slice(0, 8)}</span>
        )}
      </span>
    </div>
  )
})
