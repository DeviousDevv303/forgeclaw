import type { ForgeStage, AgentPhase } from '../../types/forgeOps'
import { L } from './palette'
import { TypingText } from './TypingText'

interface Props {
  stage: ForgeStage
  phase: AgentPhase
  integrityFrozen: boolean
}

const STAGE_ORDER: ForgeStage[] = [
  'RAW_ORE', 'SMELTING', 'HAMMERING', 'TEMPERING', 'REFORGING', 'COMPLETE',
]

const STAGE_META: Record<ForgeStage, { label: string; glyph: string; trace: string }> = {
  RAW_ORE:   { glyph: '◈', label: 'INTENT CAPTURED',        trace: 'parsing objective pattern' },
  SMELTING:  { glyph: '◇', label: 'PATTERN RECOGNIZED',     trace: 'deriving execution schema' },
  HAMMERING: { glyph: '◉', label: 'SYNAPTIC BRIDGE FORMED', trace: 'parallel threads active' },
  TEMPERING: { glyph: '◆', label: 'COHERENCE LOCK',         trace: 'verifying state convergence' },
  REFORGING: { glyph: '↻', label: 'PATH REOPTIMIZED',       trace: 'resolution vector recalculated' },
  COMPLETE:  { glyph: '●', label: 'COHERENCE ACHIEVED',     trace: 'observable reality stabilized' },
  BLOCKED:   { glyph: '⊗', label: 'ANOMALY UNRESOLVED',     trace: 'harmonic disruption detected' },
}

export function CognitiveMap({ stage, integrityFrozen }: Props) {
  const stageIdx = stage === 'BLOCKED' ? -1 : STAGE_ORDER.indexOf(stage)

  return (
    <div style={{ padding: '10px 14px', borderRight: `1px solid ${L.border}` }}>
      <div style={{ color: L.textDim, fontSize: '8px', letterSpacing: '2px', marginBottom: '10px' }}>
        COGNITIVE MAP
      </div>

      {STAGE_ORDER.map((s, idx) => {
        const meta = STAGE_META[s]
        const done   = stageIdx > idx
        const active = stageIdx === idx
        const future = !done && !active

        return (
          <div
            key={s}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '6px',
              opacity: future ? 0.2 : 1,
              transition: 'opacity 0.3s',
            }}
          >
            <span style={{
              color: done ? L.active : active ? L.active : L.textDim,
              fontSize: '10px',
              width: '14px',
              flexShrink: 0,
              textAlign: 'center',
            }}>
              {done ? '◆' : active ? meta.glyph : '○'}
            </span>
            <div style={{ flex: 1 }}>
              <span style={{
                color: done ? L.active : active ? L.active : L.text,
                letterSpacing: '1px',
                fontSize: '9px',
              }}>
                {meta.label}
              </span>
              {active && (
                <TypingText
                  key={s}
                  text={meta.trace}
                  color={L.textDim}
                  speed={22}
                  style={{ fontSize: '8px', marginLeft: '8px' }}
                />
              )}
            </div>
            {active && (
              <span style={{
                width: '4px',
                height: '4px',
                borderRadius: '50%',
                background: L.active,
                flexShrink: 0,
                boxShadow: `0 0 5px ${L.active}`,
              }} />
            )}
          </div>
        )
      })}

      {stage === 'BLOCKED' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
          <span style={{ color: L.anomaly, fontSize: '10px' }}>⊗</span>
          <span style={{ color: L.anomaly, letterSpacing: '1px', fontSize: '9px' }}>ANOMALY UNRESOLVED</span>
        </div>
      )}

      {integrityFrozen && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px', padding: '4px 6px', background: L.activeDim, border: `1px solid ${L.guard}`, borderRadius: '2px' }}>
          <span style={{ color: L.guard, fontSize: '9px' }}>⚠ INTEGRITY FROZEN</span>
        </div>
      )}
    </div>
  )
}
