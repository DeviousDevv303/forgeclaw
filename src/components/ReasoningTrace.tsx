// ForgeClaw - Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

interface ReasoningTraceProps {
  trace: string
  isOpen: boolean
  onToggle: () => void
}

const TRACE_FONT = "'Brush Script MT', 'Apple Chancery', 'Segoe Script', 'Zapfino', cursive"
const TRACE_LASER = '#39ff14'
const TRACE_LASER_SOFT = 'rgba(57, 255, 20, 0.72)'
const TRACE_LASER_DIM = 'rgba(57, 255, 20, 0.34)'

function splitTraceLine(line: string): { label?: string; value: string } {
  const match = /^([A-Z][A-Za-z ]{2,24}):\s*(.*)$/.exec(line.trim())
  if (!match) return { value: line }
  return { label: match[1], value: match[2] }
}

export function ReasoningTrace({ trace, isOpen, onToggle }: ReasoningTraceProps) {
  const lines = trace.split('\n').map(line => line.trimEnd()).filter(Boolean)
  const firstLine = lines[0] ?? 'Operational trace ready'

  return (
    <div style={{ width: '100%', maxWidth: '90%', marginTop: '8px' }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%',
          background: 'linear-gradient(90deg, rgba(57,255,20,0.075), rgba(57,255,20,0.025))',
          border: `1px solid ${TRACE_LASER_DIM}`,
          borderRadius: '8px',
          cursor: 'pointer',
          padding: '8px 11px',
          minHeight: '40px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          WebkitTapHighlightColor: 'transparent',
          boxShadow: isOpen
            ? '0 0 22px rgba(57, 255, 20, 0.18), inset 0 0 18px rgba(57, 255, 20, 0.045)'
            : '0 0 12px rgba(57, 255, 20, 0.1)',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <span style={{ color: TRACE_LASER, fontSize: '10px', textShadow: `0 0 8px ${TRACE_LASER_SOFT}`, flexShrink: 0 }}>
            {isOpen ? 'v' : '>'}
          </span>
          <span style={{ color: TRACE_LASER, fontSize: '14px', fontFamily: TRACE_FONT, letterSpacing: '0.6px', textShadow: `0 0 11px ${TRACE_LASER_SOFT}`, flexShrink: 0 }}>
            Reasoning Trace
          </span>
          <span style={{ color: 'rgba(57,255,20,0.42)', fontSize: '10px', fontFamily: "'Courier New', monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {firstLine}
          </span>
        </span>
        <span style={{ color: 'rgba(57,255,20,0.52)', border: '1px solid rgba(57,255,20,0.18)', borderRadius: '999px', padding: '2px 7px', fontSize: '8px', letterSpacing: '1px', fontFamily: "'Courier New', monospace", flexShrink: 0 }}>
          PUBLIC TRACE
        </span>
      </button>

      {isOpen && (
        <div style={{
          background: 'linear-gradient(180deg, rgba(3, 14, 4, 0.97), rgba(1, 7, 2, 0.99))',
          border: `1px solid ${TRACE_LASER_DIM}`,
          borderTop: 'none',
          borderRadius: '0 0 8px 8px',
          padding: '12px 15px 13px',
          marginTop: '-1px',
          maxHeight: '260px',
          overflowY: 'auto',
          boxShadow: 'inset 0 0 24px rgba(57, 255, 20, 0.075), 0 0 18px rgba(57, 255, 20, 0.12)',
        }}>
          <div style={{ display: 'grid', gap: '7px' }}>
            {lines.map((line, index) => {
              const part = splitTraceLine(line)
              return (
                <div key={`${index}-${line}`} style={{ display: part.label ? 'grid' : 'block', gridTemplateColumns: part.label ? '112px 1fr' : undefined, gap: '9px', alignItems: 'baseline' }}>
                  {part.label && (
                    <span style={{ color: 'rgba(57,255,20,0.58)', fontSize: '10px', fontFamily: "'Courier New', monospace", letterSpacing: '1px', textTransform: 'uppercase' }}>
                      {part.label}
                    </span>
                  )}
                  <span style={{ color: TRACE_LASER, fontSize: '12px', fontFamily: TRACE_FONT, lineHeight: '1.8', letterSpacing: '0.2px', textShadow: '0 0 8px rgba(57, 255, 20, 0.42)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {part.value}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
