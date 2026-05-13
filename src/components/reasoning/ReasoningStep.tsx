import React, { memo } from 'react'
import type { ReasoningStep as ReasoningStepType } from './types'
import { ToolCallBlock } from './ToolCallBlock'

export const ReasoningStep = memo(function ReasoningStep({ step }: { step: ReasoningStepType }) {
  const isStreaming = step.status === 'streaming'
  const dotColor = isStreaming ? '#f97316' : step.status === 'complete' ? '#10b981' : '#333'

  return (
    <div style={{ marginLeft: '12px', borderLeft: '1px solid #2a2a2a', paddingLeft: '10px', marginBottom: '6px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
        <span
          style={{ color: dotColor, fontSize: '8px', marginTop: '3px', flexShrink: 0 }}
          className={isStreaming ? 'pulse-text' : undefined}
        >◉</span>
        <p style={{
          margin: 0, fontSize: '12px', lineHeight: '1.5', fontStyle: 'italic',
          fontFamily: "'Crimson Pro', Georgia, serif",
          color: isStreaming ? '#c8c0b8' : '#7a7a7a',
        }}>
          {step.content}
          {isStreaming && <span style={{ color: '#f97316' }} className="pulse-text">▌</span>}
        </p>
      </div>
      {step.toolCalls?.map(tc => <ToolCallBlock key={tc.id} toolCall={tc} />)}
    </div>
  )
})
