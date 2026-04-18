import type { FailureEvent } from '../types/errorBus'

interface FailureDashboardProps {
  ledger: FailureEvent[]
  onResolve: (id: string) => void
  onClearResolved: () => void
}

const SEVERITY_COLOR: Record<string, string> = {
  info:     '#3b82f6',
  warning:  '#eab308',
  error:    '#f97316',
  critical: '#ef4444',
}

const SEVERITY_BG: Record<string, string> = {
  info:     '#00091a',
  warning:  '#1a1500',
  error:    '#1a0a00',
  critical: '#1a0000',
}

const SEVERITY_BORDER: Record<string, string> = {
  info:     '#001a3a',
  warning:  '#3a3000',
  error:    '#3a1800',
  critical: '#3a0000',
}

export function FailureDashboard({ ledger, onResolve, onClearResolved }: FailureDashboardProps) {
  const unresolved = ledger.filter(e => !e.resolved)
  const resolved   = ledger.filter(e => e.resolved)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ color: '#f97316', fontSize: '10px', letterSpacing: '1px' }}>FAILURE LEDGER</span>
        <span style={{ color: '#444', fontSize: '10px' }}>
          {unresolved.length} active · {resolved.length} resolved
        </span>
        {resolved.length > 0 && (
          <button
            onClick={onClearResolved}
            style={{
              marginLeft: 'auto',
              background: 'transparent',
              border: '1px solid #333',
              color: '#666',
              fontSize: '9px',
              padding: '3px 8px',
              borderRadius: '3px',
              cursor: 'pointer',
              fontFamily: 'monospace',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            CLEAR RESOLVED
          </button>
        )}
      </div>

      {/* Event list */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {ledger.length === 0 && (
          <div style={{ color: '#333', fontSize: '12px', textAlign: 'center', marginTop: '40px' }}>
            No failures logged.
          </div>
        )}

        {ledger.map(event => {
          const color  = SEVERITY_COLOR[event.severity]  ?? '#888'
          const bg     = SEVERITY_BG[event.severity]     ?? '#111'
          const border = SEVERITY_BORDER[event.severity] ?? '#222'

          return (
            <div
              key={event.id}
              style={{
                background: event.resolved ? '#0f0f0f' : bg,
                border: `1px solid ${event.resolved ? '#1a1a1a' : border}`,
                borderRadius: '6px',
                padding: '10px 12px',
                opacity: event.resolved ? 0.45 : 1,
                transition: 'opacity 0.2s',
              }}
            >
              {/* Header row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
                <span style={{
                  fontSize: '9px',
                  fontWeight: 'bold',
                  color,
                  border: `1px solid ${color}`,
                  padding: '1px 5px',
                  borderRadius: '3px',
                  letterSpacing: '0.5px',
                  textTransform: 'uppercase',
                }}>
                  {event.severity}
                </span>
                <span style={{ fontSize: '9px', color: '#555', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                  {event.source}
                </span>
                <span style={{ fontSize: '9px', color: '#444', marginLeft: 'auto' }}>
                  {new Date(event.timestamp).toLocaleTimeString()}
                </span>
                {!event.resolved && (
                  <button
                    onClick={() => onResolve(event.id)}
                    style={{
                      background: 'transparent',
                      border: '1px solid #333',
                      color: '#555',
                      fontSize: '8px',
                      padding: '2px 6px',
                      borderRadius: '3px',
                      cursor: 'pointer',
                      fontFamily: 'monospace',
                      textTransform: 'uppercase',
                    }}
                  >
                    RESOLVE
                  </button>
                )}
                {event.resolved && (
                  <span style={{ fontSize: '8px', color: '#22c55e', letterSpacing: '0.5px' }}>✓ RESOLVED</span>
                )}
              </div>

              {/* Message */}
              <div style={{ fontSize: '12px', color: event.resolved ? '#555' : '#ccc', lineHeight: '1.4', fontFamily: 'monospace' }}>
                {event.message}
              </div>

              {/* Context (if present) */}
              {event.context && Object.keys(event.context).length > 0 && (
                <details style={{ marginTop: '6px' }}>
                  <summary style={{ fontSize: '9px', color: '#444', cursor: 'pointer', letterSpacing: '0.5px' }}>CONTEXT</summary>
                  <pre style={{ fontSize: '10px', color: '#555', marginTop: '4px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {JSON.stringify(event.context, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
