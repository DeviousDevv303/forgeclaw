import { L } from './palette'
import type { AlternatePath } from '../../types/forgeOps'

interface Props {
  paths: AlternatePath[]
}

export function AlternatePaths({ paths }: Props) {
  if (paths.length === 0) return null

  return (
    <div style={{ padding: '8px 14px' }}>
      <div style={{ color: L.textDim, fontSize: '8px', letterSpacing: '2px', marginBottom: '8px', fontFamily: L.mono }}>
        ◇ ALTERNATE PATHS COLLAPSED
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
        {paths.map((path, i) => {
          const chosen = path.status === 'active'
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '9px', color: chosen ? L.active : L.ghost, flexShrink: 0, fontFamily: L.mono }}>
                {chosen ? '◈' : '≈'}
              </span>
              <span style={{
                flex: 1, fontSize: '9px', fontFamily: L.mono,
                color: chosen ? L.text : L.textDim,
              }}>
                {path.label}
              </span>
              <span style={{
                fontSize: '8px', fontFamily: L.mono, flexShrink: 0,
                color: chosen ? L.active : L.textDim,
                minWidth: '58px', textAlign: 'right',
              }}>
                {chosen ? 'CHOSEN · active' : `${path.probability.toFixed(1)}% · discarded`}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
