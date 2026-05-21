import { useCallback, useEffect, useRef, useState } from 'react'
import { L } from './palette'
import { CognitiveMap } from './CognitiveMap'
import { ProcessTrace } from './ProcessTrace'
import { ActiveNodes } from './ActiveNodes'
import { LatticeIntegrity } from './LatticeIntegrity'
import { ExecutionSchema } from './ExecutionSchema'
import { AlternatePaths } from './AlternatePaths'
import type { ForgeOpsState } from '../../types/forgeOps'

interface Props {
  state: ForgeOpsState
  isActive: boolean
  currentPlan?: string
}

type LatticePhase = 'collapsed' | 'entering' | 'open' | 'fading'

function CoherenceChip({ pct }: { pct: number }) {
  const color = pct >= 72 ? L.active : pct >= 55 ? L.guard : L.anomaly
  const border = pct >= 72 ? L.activeDim : pct >= 55 ? '#4a2a0a' : '#3a1060'
  return (
    <span style={{ fontSize: '8px', fontFamily: L.mono, letterSpacing: '1.5px', padding: '2px 7px', borderRadius: '2px', background: L.ghost, color, border: `1px solid ${border}` }}>
      COHERENCE {pct}%
    </span>
  )
}

function HarmonyChip({ risk }: { risk: 'LOW' | 'MEDIUM' | 'HIGH' }) {
  const label = risk === 'HIGH' ? 'DISRUPTED' : risk === 'MEDIUM' ? 'UNSTABLE' : 'STABLE'
  const color = risk === 'HIGH' ? L.anomaly : risk === 'MEDIUM' ? L.guard : L.active
  const border = risk === 'HIGH' ? '#3a1060' : risk === 'MEDIUM' ? '#4a2a0a' : L.activeDim
  return (
    <span style={{ fontSize: '8px', fontFamily: L.mono, letterSpacing: '1.5px', padding: '2px 7px', borderRadius: '2px', background: L.ghost, color, border: `1px solid ${border}` }}>
      HARMONY {label}
    </span>
  )
}

function StatusChip({ isActive, stage }: Pick<Props, 'isActive'> & { stage: string }) {
  const label = isActive ? 'THREADING ●' : stage === 'COMPLETE' ? 'CONVERGED ◆' : 'DORMANT ○'
  const color = isActive ? L.active : stage === 'COMPLETE' ? L.active : L.textDim
  return (
    <span style={{ fontSize: '8px', fontFamily: L.mono, letterSpacing: '1.5px', padding: '2px 7px', borderRadius: '2px', background: L.ghost, color, border: `1px solid ${L.lattice}` }}>
      {label}
    </span>
  )
}

const hasBottomContent = (plan: string | undefined, paths: ForgeOpsState['collapsedPaths']) =>
  !!plan || paths.length > 0

export function SyncognitiveLattice({ state, isActive, currentPlan }: Props) {
  const [phase, setPhase] = useState<LatticePhase>('collapsed')
  const phaseRef = useRef<LatticePhase>('collapsed')
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const setPhaseSync = useCallback((p: LatticePhase) => {
    phaseRef.current = p
    setPhase(p)
  }, [])

  useEffect(() => {
    let enterFrame = 0
    let openFrame = 0

    if (isActive) {
      if (fadeTimer.current) clearTimeout(fadeTimer.current)
      if (collapseTimer.current) clearTimeout(collapseTimer.current)
      enterFrame = requestAnimationFrame(() => {
        setPhaseSync('entering')
        // One more RAF lets the DOM paint opacity:0 before opacity:1.
        openFrame = requestAnimationFrame(() => setPhaseSync('open'))
      })
    } else {
      // Only fade if currently visible
      if (phaseRef.current === 'open' || phaseRef.current === 'entering') {
        fadeTimer.current = setTimeout(() => {
          setPhaseSync('fading')
          collapseTimer.current = setTimeout(() => setPhaseSync('collapsed'), 700)
        }, 2500)
      }
    }
    return () => {
      if (enterFrame) cancelAnimationFrame(enterFrame)
      if (openFrame) cancelAnimationFrame(openFrame)
      if (fadeTimer.current) clearTimeout(fadeTimer.current)
      if (collapseTimer.current) clearTimeout(collapseTimer.current)
    }
  }, [isActive, setPhaseSync])

  const pct = Math.round(state.confidence * 100)

  // Nothing to show yet
  if (phase === 'collapsed' && state.events.length === 0) return null

  // Collapsed summary strip — tap to re-expand
  if (phase === 'collapsed') {
    return (
      <div
        onClick={() => {
          setPhaseSync('entering')
          requestAnimationFrame(() => requestAnimationFrame(() => setPhaseSync('open')))
        }}
        style={{
          cursor: 'pointer', padding: '6px 14px', marginBottom: '8px',
          background: L.surface, border: `1px solid ${L.border}`, borderRadius: '4px',
          display: 'flex', alignItems: 'center', gap: '10px', opacity: 0.65,
          transition: 'opacity 0.2s', fontFamily: L.mono,
        }}
      >
        <span style={{ color: L.active, fontSize: '9px' }}>◆</span>
        <span style={{ color: L.textDim, fontSize: '8px', letterSpacing: '1.5px' }}>
          {state.stage} · {pct}% COHERENCE · tap to review
        </span>
      </div>
    )
  }

  const opacity = phase === 'open' ? 1 : 0
  const showBottom = hasBottomContent(currentPlan, state.collapsedPaths)
  const bottomCols = currentPlan && state.collapsedPaths.length > 0 ? '1fr 1fr' : '1fr'

  return (
    <div style={{
      background: L.bg, border: `1px solid ${L.border}`, borderRadius: '4px',
      marginBottom: '10px', fontFamily: L.mono, overflow: 'hidden',
      opacity, transition: 'opacity 0.6s ease',
    }}>

      {/* ── Header ────────────────────────────────────────────── */}
      <div style={{
        background: L.surface, borderBottom: `1px solid ${L.border}`,
        padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ color: L.active, letterSpacing: '3px', fontSize: '9px', fontWeight: 700 }}>
            ◈ SYNCOGNITIVE LATTICE
          </span>
          {isActive && (
            <span style={{
              width: '5px', height: '5px', borderRadius: '50%',
              background: L.active, display: 'inline-block',
              animation: 'pulse 1.5s infinite', boxShadow: `0 0 6px ${L.active}`,
            }} />
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <CoherenceChip pct={pct} />
          <HarmonyChip risk={state.riskLevel} />
          <StatusChip isActive={isActive} stage={state.stage} />
        </div>
      </div>

      {/* Intent line */}
      {state.objective && (
        <div style={{
          padding: '5px 14px', borderBottom: `1px solid ${L.ghost}`,
          display: 'flex', gap: '10px', alignItems: 'baseline',
        }}>
          <span style={{ color: L.textDim, fontSize: '8px', letterSpacing: '2px', flexShrink: 0 }}>INTENT</span>
          <span style={{ color: L.text, fontSize: '10px', lineHeight: '1.4' }}>
            {state.objective.slice(0, 140)}
          </span>
        </div>
      )}

      {/* ── Guardian override banner ───────────────────────────── */}
      {state.guardianOverrideNeeded && (
        <div style={{
          padding: '6px 14px', background: '#1a0a00', borderBottom: `1px solid ${L.guard}`,
          display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          <span style={{ color: L.guard, fontSize: '10px' }}>⚠</span>
          <span style={{ color: L.guard, fontSize: '9px', letterSpacing: '1px' }}>
            GUARDIAN OVERRIDE REQUIRED — reoptimization gate exceeded
          </span>
        </div>
      )}

      {/* ── Main 2-col grid: CognitiveMap | ProcessTrace ─────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
        <CognitiveMap stage={state.stage} phase={state.phase} integrityFrozen={state.integrityFrozen} />
        <ProcessTrace events={state.events} />
      </div>

      {/* ── Bottom 2-col grid: ActiveNodes | LatticeIntegrity ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: `1px solid ${L.border}` }}>
        <ActiveNodes toolBus={state.toolBus} integrityFrozen={state.integrityFrozen} />
        <LatticeIntegrity
          confidence={state.confidence}
          retryCount={state.retryCount}
          iterCurrent={state.iterCurrent}
          iterTotal={state.iterTotal}
          riskLevel={state.riskLevel}
          guardianWarning={state.guardianWarning}
          guardianOverrideNeeded={state.guardianOverrideNeeded}
          threadCount={state.threadCount}
        />
      </div>

      {/* ── Schema + Paths row ────────────────────────────────── */}
      {showBottom && (
        <div style={{ display: 'grid', gridTemplateColumns: bottomCols, borderTop: `1px solid ${L.border}` }}>
          {currentPlan && <ExecutionSchema plan={currentPlan} />}
          {state.collapsedPaths.length > 0 && <AlternatePaths paths={state.collapsedPaths} />}
        </div>
      )}

      {/* ── Signature line ────────────────────────────────────── */}
      <div style={{
        padding: '6px 14px', borderTop: `1px solid ${L.ghost}`,
        textAlign: 'center', fontSize: '9px', color: L.textDim,
        fontStyle: 'italic', letterSpacing: '0.3px',
      }}>
        ForgeClaw does not show a task list. It reveals the cognitive lattice forming under the task.
        <span style={{ color: L.lattice, marginLeft: '6px' }}>— Syncognitive Lattice v1.0</span>
      </div>
    </div>
  )
}
