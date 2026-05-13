import React, { memo, useMemo, useState } from 'react'
import type { OrchestratorEvent } from '../../types/orchestrator'
import { MonitorEventRow } from './MonitorEventRow'

interface Props {
  events: OrchestratorEvent[]
}

export const SystemMonitor = memo(function SystemMonitor({ events }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const now = Date.now()
  const windowed = useMemo(() => events.slice(0, 20), [events])

  if (events.length === 0 && collapsed) return null

  return (
    <div style={{ borderBottom: '1px solid #1a1a1a', marginBottom: '6px', paddingBottom: collapsed ? 0 : '4px' }}>
      <button
        onClick={() => setCollapsed(c => !c)}
        style={{
          background: 'none', border: 'none', width: '100%', cursor: 'pointer',
          padding: '4px 0', display: 'flex', alignItems: 'center', gap: '8px',
        }}
      >
        <span style={{ color: '#333', fontSize: '9px', letterSpacing: '2px', fontFamily: 'monospace', textTransform: 'uppercase' }}>
          🖥 System Monitor
        </span>
        <span style={{ color: '#444', fontSize: '8px' }}>
          {events.length} event{events.length !== 1 ? 's' : ''}
        </span>
        <span style={{ marginLeft: 'auto', color: '#444', fontSize: '8px' }}>{collapsed ? '▲' : '▼'}</span>
      </button>
      {!collapsed && (
        <div style={{ maxHeight: '72px', overflowY: 'auto', paddingBottom: '2px' }}>
          {windowed.length === 0 ? (
            <span style={{ color: '#333', fontSize: '9px', fontFamily: 'monospace' }}>no events yet</span>
          ) : (
            windowed.map(e => <MonitorEventRow key={e.eventId} event={e} now={now} />)
          )}
        </div>
      )}
    </div>
  )
})
