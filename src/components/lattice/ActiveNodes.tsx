import { L } from './palette'

interface Props {
  toolBus: Record<string, 'active' | 'idle' | 'error'>
  integrityFrozen: boolean
}

const NODE_GROUPS = ['github', 'web', 'memory', 'run_js', 'gmail', 'calendar', 'shell', 'spawn']
const DORMANT_SET = new Set(['gmail', 'calendar', 'shell'])

function nodeGroupFor(name: string): string {
  if (/github/i.test(name))              return 'github'
  if (/http_fetch|web_search/i.test(name)) return 'web'
  if (/memory/i.test(name))              return 'memory'
  if (/run_js/i.test(name))              return 'run_js'
  if (/gmail/i.test(name))               return 'gmail'
  if (/calendar/i.test(name))            return 'calendar'
  if (/shell/i.test(name))               return 'shell'
  if (/spawn/i.test(name))               return 'spawn'
  return name.split('_')[0]
}

type NodeStatus = 'active' | 'idle' | 'error' | 'dormant'

export function ActiveNodes({ toolBus, integrityFrozen }: Props) {
  // Build aggregated node status
  const nodeStatus: Record<string, NodeStatus> = {}
  for (const g of NODE_GROUPS) {
    nodeStatus[g] = DORMANT_SET.has(g) ? 'dormant' : 'idle'
  }
  for (const [key, status] of Object.entries(toolBus)) {
    const g = nodeGroupFor(key)
    if (status === 'error') {
      nodeStatus[g] = 'error'
    } else if (status === 'active' && nodeStatus[g] !== 'error') {
      nodeStatus[g] = 'active'
    }
  }

  return (
    <div style={{ padding: '8px 14px', borderRight: `1px solid ${L.border}` }}>
      <div style={{ color: L.textDim, fontSize: '8px', letterSpacing: '2px', marginBottom: '6px' }}>
        ACTIVE NODES
      </div>

      {integrityFrozen && (
        <div style={{ marginBottom: '6px', padding: '3px 6px', background: L.activeDim, border: `1px solid ${L.guard}`, borderRadius: '2px' }}>
          <span style={{ color: L.guard, fontSize: '8px', letterSpacing: '1px' }}>⚠ THREAD ALLOCATION FROZEN</span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 8px' }}>
        {NODE_GROUPS.map(g => {
          const status = nodeStatus[g] ?? 'idle'

          const glyph =
            status === 'active'  ? '●' :
            status === 'error'   ? '⊗' : '○'

          const color =
            status === 'active'  ? L.active :
            status === 'error'   ? L.anomaly :
            status === 'dormant' ? L.ghost :
            L.textDim

          return (
            <div key={g} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{
                fontSize: '9px',
                color,
                flexShrink: 0,
                textShadow: status === 'active' ? `0 0 6px ${L.active}` : 'none',
              }}>
                {glyph}
              </span>
              <span style={{ color, fontSize: '9px', letterSpacing: '0.5px', flex: 1 }}>
                {g.toUpperCase()}
              </span>
              <span style={{ color: L.textDim, fontSize: '8px' }}>
                {status}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
