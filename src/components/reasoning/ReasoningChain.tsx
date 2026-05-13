import React, { memo, useState } from 'react'
import type { ReasoningData } from './types'
import { ReasoningPhase } from './ReasoningPhase'

interface Props {
  messageId: string
  reasoning: ReasoningData
}

function propsAreEqual(prev: Props, next: Props): boolean {
  return prev.messageId === next.messageId && prev.reasoning.version === next.reasoning.version
}

export const ReasoningChain = memo(function ReasoningChain({ messageId: _messageId, reasoning }: Props) {
  const isComplete = reasoning.status === 'complete'
  const isStreaming = reasoning.status === 'streaming'
  const [collapsed, setCollapsed] = useState(isComplete)
  const doneCount = reasoning.phases.filter(p => p.status === 'complete').length

  return (
    <div style={{
      marginBottom: '6px',
      background: 'rgba(10,10,10,0.6)',
      border: '1px solid rgba(249,115,22,0.15)',
      borderRadius: '6px',
      overflow: 'hidden',
    }}>
      <button
        onClick={() => setCollapsed(c => !c)}
        style={{
          background: 'none', border: 'none', width: '100%', cursor: 'pointer',
          padding: '7px 12px', display: 'flex', alignItems: 'center', gap: '8px',
        }}
      >
        <span style={{ fontSize: '9px', color: '#f97316' }}>⬡</span>
        <span style={{ color: '#f97316', fontSize: '9px', fontWeight: 'bold', letterSpacing: '2px', textTransform: 'uppercase', fontFamily: 'monospace' }}>
          {isStreaming ? 'Reasoning…' : '5-Phase Scaffold'}
        </span>
        {isComplete && (
          <span style={{ color: '#555', fontSize: '8px' }}>{doneCount}/5 phases</span>
        )}
        {isStreaming && (
          <span style={{ color: '#f97316', fontSize: '8px' }} className="pulse-text">●</span>
        )}
        <span style={{ marginLeft: 'auto', color: '#444', fontSize: '8px' }}>{collapsed ? '▼' : '▲'}</span>
      </button>
      {!collapsed && (
        <div style={{ padding: '0 12px 12px' }}>
          {reasoning.phases.map(phase => (
            <ReasoningPhase
              key={phase.id}
              phase={phase}
              defaultOpen={phase.status === 'streaming'}
            />
          ))}
        </div>
      )}
    </div>
  )
}, propsAreEqual)
