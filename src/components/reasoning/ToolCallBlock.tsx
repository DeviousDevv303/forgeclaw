// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). AGPL-3.0 License.
// Original work. Unauthorized commercial use prohibited. https://github.com/DeviousDevv303/forgeclaw
import { memo, useState } from 'react'
import type { ToolCall } from './types'

const STATUS_COLOR: Record<ToolCall['status'], string> = {
  pending: '#555',
  running: '#eab308',
  success: '#10b981',
  error: '#ef4444',
}

const STATUS_ICON: Record<ToolCall['status'], string> = {
  pending: '○',
  running: '◎',
  success: '●',
  error: '✗',
}

export const ToolCallBlock = memo(function ToolCallBlock({ toolCall }: { toolCall: ToolCall }) {
  const [open, setOpen] = useState(false)
  const color = STATUS_COLOR[toolCall.status]

  return (
    <div style={{ marginTop: '6px', background: 'rgba(0,0,0,0.3)', border: `1px solid ${color}30`, borderRadius: '4px', padding: '6px 8px', fontSize: '10px', fontFamily: 'monospace' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: '6px', width: '100%' }}
      >
        <span style={{ color, fontSize: '8px' }}>{STATUS_ICON[toolCall.status]}</span>
        <span style={{ color: '#a78bfa' }}>{toolCall.name}</span>
        {toolCall.status === 'running' && (
          <span style={{ color: '#eab308', fontSize: '8px' }} className="pulse-text">running</span>
        )}
        <span style={{ color: '#333', marginLeft: 'auto', fontSize: '9px' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ marginTop: '6px', borderTop: '1px solid #222', paddingTop: '6px' }}>
          <div style={{ color: '#555', marginBottom: '4px', fontSize: '9px', letterSpacing: '1px' }}>ARGS</div>
          <pre style={{ color: '#888', margin: 0, fontSize: '9px', overflow: 'auto', maxHeight: '80px' }}>
            {JSON.stringify(toolCall.args, null, 2)}
          </pre>
          {toolCall.result != null && (
            <>
              <div style={{ color: '#555', marginTop: '6px', marginBottom: '4px', fontSize: '9px', letterSpacing: '1px' }}>RESULT</div>
              <pre style={{ color: '#10b981', margin: 0, fontSize: '9px', overflow: 'auto', maxHeight: '60px' }}>
                {toolCall.result}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  )
})
