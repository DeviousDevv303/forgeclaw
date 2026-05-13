import React, { memo, useState } from 'react'
import type { ReasoningPhase as ReasoningPhaseType } from './types'
import { PHASE_ICONS } from './types'
import { ReasoningStep } from './ReasoningStep'

interface Props {
  phase: ReasoningPhaseType
  defaultOpen?: boolean
}

export const ReasoningPhase = memo(function ReasoningPhase({ phase, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen || phase.status === 'streaming')
  const isStreaming = phase.status === 'streaming'
  const isPending = phase.status === 'pending'
  const statusColor = isStreaming ? '#f97316' : phase.status === 'complete' ? '#10b981' : '#333'

  return (
    <div style={{
      borderLeft: `2px solid ${statusColor}40`,
      paddingLeft: '12px',
      marginBottom: '10px',
      opacity: isPending ? 0.35 : 1,
      transition: 'opacity 0.3s',
    }}>
      <button
        onClick={() => !isPending && setOpen(o => !o)}
        style={{
          background: 'none', border: 'none', padding: 0, width: '100%',
          cursor: isPending ? 'default' : 'pointer',
          display: 'flex', alignItems: 'center', gap: '8px',
        }}
      >
        <span style={{ color: statusColor, fontSize: '10px' }}>{PHASE_ICONS[phase.index]}</span>
        <span style={{ color: statusColor, fontSize: '10px', fontWeight: 'bold', letterSpacing: '1px', textTransform: 'uppercase', fontFamily: 'monospace' }}>
          {phase.name}
        </span>
        {isStreaming && <span style={{ color: '#f97316', fontSize: '8px' }} className="pulse-text">LIVE</span>}
        {phase.status === 'complete' && <span style={{ color: '#10b981', fontSize: '8px' }}>✓</span>}
        {!isPending && (
          <span style={{ color: '#444', fontSize: '8px', marginLeft: 'auto' }}>{open ? '▲' : '▼'}</span>
        )}
      </button>
      {open && !isPending && (
        <div style={{ marginTop: '8px' }}>
          {phase.steps.map(step => <ReasoningStep key={step.id} step={step} />)}
        </div>
      )}
    </div>
  )
})
