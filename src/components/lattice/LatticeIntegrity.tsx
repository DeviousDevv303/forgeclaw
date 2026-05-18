import { AGENT_CONFIDENCE_THRESHOLD } from '../../lib/agentCore'
import { L } from './palette'

interface Props {
  confidence: number
  retryCount: number
  iterCurrent: number
  iterTotal: number
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'
  guardianWarning: string | null
  guardianOverrideNeeded: boolean
  threadCount: number
}

export function LatticeIntegrity({
  confidence,
  retryCount,
  iterCurrent,
  iterTotal,
  riskLevel,
  guardianWarning,
  guardianOverrideNeeded,
  threadCount,
}: Props) {
  const pct = Math.round(confidence * 100)
  const iterPct = iterTotal > 0 ? Math.round((iterCurrent / iterTotal) * 100) : 0

  const coherenceColor =
    confidence >= 0.72 ? L.active :
    confidence >= 0.55 ? L.guard :
    L.anomaly

  const retryColor =
    retryCount === 0 ? L.active :
    retryCount <= 2  ? L.guard :
    L.anomaly

  const harmonyLabel =
    riskLevel === 'HIGH'   ? 'DISRUPTED' :
    riskLevel === 'MEDIUM' ? 'UNSTABLE'  : 'STABLE'

  const harmonyColor =
    riskLevel === 'HIGH'   ? L.anomaly :
    riskLevel === 'MEDIUM' ? L.guard   : L.active

  // Floor line position: 60% of bar width
  const floorPct = 60

  return (
    <div style={{ padding: '8px 14px' }}>
      <div style={{ color: L.textDim, fontSize: '8px', letterSpacing: '2px', marginBottom: '6px' }}>
        LATTICE INTEGRITY
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>

        {/* 1. Coherence bar */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
            <span style={{ color: L.textDim, fontSize: '8px', letterSpacing: '1px' }}>COHERENCE</span>
            <span style={{ color: coherenceColor, fontSize: '8px' }}>{pct}% [floor {floorPct}%]</span>
          </div>
          <div style={{ position: 'relative', height: '4px', background: L.activeDim, borderRadius: '2px', overflow: 'visible' }}>
            <div style={{
              width: `${pct}%`,
              height: '100%',
              background: coherenceColor,
              borderRadius: '2px',
              transition: 'width 0.4s',
              boxShadow: `0 0 4px ${coherenceColor}`,
            }} />
            {/* Dashed floor line at 60% */}
            <div style={{
              position: 'absolute',
              left: `${floorPct}%`,
              top: '-2px',
              bottom: '-2px',
              width: '1px',
              borderLeft: `1px dashed ${L.guard}`,
            }} />
          </div>
        </div>

        {/* 2. Thread density */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
            <span style={{ color: L.textDim, fontSize: '8px', letterSpacing: '1px' }}>THREAD DENSITY</span>
            <span style={{ color: L.text, fontSize: '8px' }}>{iterCurrent} / {iterTotal} threads</span>
          </div>
          <div style={{ height: '2px', background: L.activeDim, borderRadius: '1px', overflow: 'hidden' }}>
            <div style={{
              width: `${iterPct}%`,
              height: '100%',
              background: L.active,
              transition: 'width 0.4s',
              boxShadow: `0 0 4px ${L.active}`,
            }} />
          </div>
        </div>

        {/* 3. Reoptimization gate */}
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: L.textDim, fontSize: '9px' }}>REOPTIMIZATION GATE</span>
          <span style={{ color: retryColor, fontSize: '9px' }}>{retryCount} / 3</span>
        </div>

        {/* 4. Harmonic stability */}
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: L.textDim, fontSize: '9px' }}>HARMONIC STABILITY</span>
          <span style={{ color: harmonyColor, fontSize: '9px' }}>{harmonyLabel}</span>
        </div>

        {/* 5. Integrity guard */}
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: L.textDim, fontSize: '9px' }}>INTEGRITY GUARD</span>
          {guardianOverrideNeeded
            ? <span style={{ color: L.guard, fontSize: '9px' }}>⚠ BREACH</span>
            : <span style={{ color: L.active, fontSize: '9px' }}>ACTIVE</span>
          }
        </div>

        {/* Active thread count */}
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: L.textDim, fontSize: '9px' }}>ACTIVE THREADS</span>
          <span style={{ color: L.text, fontSize: '9px' }}>{threadCount}</span>
        </div>

        {/* Coherence floor reference */}
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: L.textDim, fontSize: '9px' }}>coherence floor</span>
          <span style={{ color: L.active, fontSize: '9px' }}>{(AGENT_CONFIDENCE_THRESHOLD * 100).toFixed(0)}%</span>
        </div>

        {/* Guardian warning banner */}
        {guardianWarning && (
          <div style={{ marginTop: '4px', padding: '4px 6px', background: L.activeDim, border: `1px solid ${L.guard}`, borderRadius: '2px' }}>
            <span style={{ color: L.guard, fontSize: '8px', letterSpacing: '0.5px' }}>⚠ {guardianWarning}</span>
          </div>
        )}
      </div>
    </div>
  )
}
