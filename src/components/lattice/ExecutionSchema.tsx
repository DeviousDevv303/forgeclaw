import { useState } from 'react'
import { L } from './palette'

interface Props {
  plan: string | undefined
}

export function ExecutionSchema({ plan }: Props) {
  const [open, setOpen] = useState(false)

  if (!plan) return null

  const lines = plan.split('\n').filter(Boolean)

  return (
    <div style={{ borderRight: `1px solid ${L.border}` }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', background: 'none', border: 'none', padding: '7px 14px',
          cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
        }}
      >
        <span style={{ color: L.active, fontSize: '9px', letterSpacing: '2px', fontFamily: L.mono, fontWeight: 700 }}>◇ EXECUTION SCHEMA</span>
        <span style={{ color: L.textDim, fontSize: '9px', fontFamily: L.mono }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ padding: '0 14px 10px' }}>
          {lines.map((line, i) => (
            <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
              <span style={{ color: L.textDim, fontSize: '9px', flexShrink: 0, width: '14px', fontFamily: L.mono }}>{i + 1}.</span>
              <span style={{ color: L.text, fontSize: '9px', lineHeight: '1.5', fontFamily: L.mono }}>{line.replace(/^\d+\.\s*/, '')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
