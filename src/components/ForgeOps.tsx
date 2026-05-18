import { useState } from 'react'
import type { ForgeOpsState, AgentEvent, ForgeStage } from '../types/forgeOps'
import { AGENT_CONFIDENCE_THRESHOLD } from '../lib/agentCore'

interface Props {
  state: ForgeOpsState
  isActive: boolean
  currentPlan?: string
}

// ─── Syncognitive stage mapping ───────────────────────────────────────────────

const STAGE_ORDER: ForgeStage[] = [
  'RAW_ORE', 'SMELTING', 'HAMMERING', 'TEMPERING', 'REFORGING', 'COMPLETE',
]

const STAGE_LATTICE: Record<ForgeStage, { label: string; glyph: string; trace: string }> = {
  RAW_ORE:   { label: 'INTENT CAPTURED',       glyph: '◈', trace: 'parsing objective pattern' },
  SMELTING:  { label: 'PATTERN RECOGNIZED',    glyph: '◇', trace: 'deriving execution schema' },
  HAMMERING: { label: 'SYNAPTIC BRIDGE FORMED', glyph: '◉', trace: 'parallel threads active' },
  TEMPERING: { label: 'COHERENCE LOCK',        glyph: '◎', trace: 'verifying state convergence' },
  REFORGING: { label: 'PATH REOPTIMIZED',      glyph: '↻', trace: 'resolution vector recalculated' },
  COMPLETE:  { label: 'COHERENCE ACHIEVED',    glyph: '◆', trace: 'observable reality stabilized' },
  BLOCKED:   { label: 'ANOMALY UNRESOLVED',    glyph: '⊗', trace: 'harmonic disruption detected' },
}

// ─── Node groups (formerly tool bus) ─────────────────────────────────────────

const NODE_GROUPS = ['github', 'web', 'memory', 'run_js', 'gmail', 'calendar', 'shell', 'spawn']
const DORMANT_NODES = new Set(['gmail', 'calendar', 'shell'])

function nodeGroupFor(name: string): string {
  if (/github/i.test(name))             return 'github'
  if (/http_fetch|web_search/i.test(name)) return 'web'
  if (/memory/i.test(name))             return 'memory'
  if (/run_js/i.test(name))             return 'run_js'
  if (/gmail/i.test(name))              return 'gmail'
  if (/calendar/i.test(name))           return 'calendar'
  if (/shell/i.test(name))              return 'shell'
  if (/spawn/i.test(name))              return 'spawn'
  return name.split('_')[0]
}

// ─── Cognitive process trace language ────────────────────────────────────────

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function traceLabel(ev: AgentEvent): { text: string; color: string } | null {
  switch (ev.type) {
    case 'OBJECTIVE_RECEIVED':
      return { text: `◈ INTENT CAPTURED — ${ev.objective.slice(0, 65)}`, color: '#7dd3fc' }
    case 'PHASE_CHANGE':
      return { text: `◇ pattern shift → ${STAGE_LATTICE[ev.phase as ForgeStage]?.label ?? ev.phase}`, color: '#93c5fd' }
    case 'TOOL_START':
      return { text: `◉ synaptic bridge: ${ev.tool}  [thread ${ev.iter}]`, color: '#94a3b8' }
    case 'TOOL_SUCCESS':
      return { text: `◆ bridge stabilized: ${ev.tool}`, color: '#a5f3fc' }
    case 'TOOL_FAILURE':
      return { text: `⊗ anomaly detected: ${ev.tool}  [${ev.failClass}]`, color: '#f0abfc' }
    case 'RETRY_DECISION':
      return {
        text: ev.shouldRetry
          ? `↻ vector reoptimized — ${ev.strategy.slice(0, 55)}`
          : `⊘ resolution deferred — ${ev.strategy.slice(0, 55)}`,
        color: ev.shouldRetry ? '#fde68a' : '#fca5a5',
      }
    case 'CONFIDENCE_UPDATE':
      return { text: `◎ coherence → ${(ev.value * 100).toFixed(1)}%`, color: '#c4b5fd' }
    case 'CHECKPOINT':
      return { text: `◈ coherence checkpoint  [${ev.iter}/${ev.total} threads]`, color: '#7dd3fc' }
    case 'MISSION_COMPLETE':
      return { text: '◆ COHERENCE ACHIEVED — observable reality stabilized', color: '#a5f3fc' }
    case 'MISSION_BLOCKED':
      return { text: `⊗ ANOMALY UNRESOLVED — ${ev.reason.slice(0, 55)}`, color: '#f0abfc' }
    default:
      return null
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LatticeChip({ text, variant }: { text: string; variant: 'ice' | 'violet' | 'amber' | 'disruption' | 'dim' }) {
  const map = {
    ice:       { bg: '#030f1f', fg: '#7dd3fc', border: '#0c2a4a' },
    violet:    { bg: '#0d0520', fg: '#c4b5fd', border: '#2e1065' },
    amber:     { bg: '#1a1205', fg: '#fde68a', border: '#713f12' },
    disruption:{ bg: '#200520', fg: '#f0abfc', border: '#6b21a8' },
    dim:       { bg: '#0a0a0a', fg: '#334155', border: '#1e293b' },
  }[variant]
  return (
    <span style={{ fontSize: '8px', fontFamily: 'monospace', letterSpacing: '1.5px', padding: '2px 7px', borderRadius: '2px', background: map.bg, color: map.fg, border: `1px solid ${map.border}` }}>
      {text}
    </span>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ForgeOps({ state, isActive, currentPlan }: Props) {
  const [planOpen, setPlanOpen] = useState(false)

  if (!isActive && state.events.length === 0) return null

  const stageIdx = state.stage === 'BLOCKED' ? -1 : STAGE_ORDER.indexOf(state.stage)
  const coherence = Math.round(state.confidence * 100)
  const iterPct   = state.iterTotal > 0 ? Math.round((state.iterCurrent / state.iterTotal) * 100) : 0

  // Aggregate node status
  const nodeStatus: Record<string, 'active' | 'idle' | 'error' | 'dormant'> = {}
  for (const g of NODE_GROUPS) nodeStatus[g] = DORMANT_NODES.has(g) ? 'dormant' : 'idle'
  for (const [key, status] of Object.entries(state.toolBus)) {
    const g = nodeGroupFor(key)
    if (status === 'error')  nodeStatus[g] = 'error'
    else if (status === 'active' && nodeStatus[g] !== 'error') nodeStatus[g] = 'active'
    else if (nodeStatus[g] === 'idle') nodeStatus[g] = 'idle'
  }

  const harmonyLabel = state.riskLevel === 'HIGH' ? 'DISRUPTED' : state.riskLevel === 'MEDIUM' ? 'UNSTABLE' : 'STABLE'
  const harmonyVariant: 'disruption' | 'amber' | 'ice' =
    state.riskLevel === 'HIGH' ? 'disruption' : state.riskLevel === 'MEDIUM' ? 'amber' : 'ice'

  const statusLabel = isActive ? 'THREADING' : state.stage === 'COMPLETE' ? 'CONVERGED' : 'DORMANT'
  const statusVariant: 'ice' | 'violet' | 'dim' = isActive ? 'ice' : state.stage === 'COMPLETE' ? 'violet' : 'dim'

  const planLines = currentPlan?.split('\n').filter(Boolean) ?? []

  // CSS vars for palette — all inline to avoid touching global CSS
  const C = {
    bg:       '#020408',
    border:   '#0c2340',
    surface:  '#040c14',
    dim:      '#1e293b',
    text:     '#94a3b8',
    textBright: '#e2e8f0',
    ice:      '#7dd3fc',
    iceDim:   '#1e4a6e',
    violet:   '#c4b5fd',
    cyan:     '#a5f3fc',
    amber:    '#fde68a',
    disruption: '#f0abfc',
    active:   '#e2e8f0',
    mono:     "'Courier New', monospace",
  }

  return (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: '4px', marginBottom: '10px', fontFamily: C.mono, fontSize: '11px', overflow: 'hidden' }}>

      {/* ── Header ─────────────────────────────────────────── */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ color: C.ice, letterSpacing: '3px', fontSize: '9px', fontWeight: 700 }}>◈ SYNCOGNITIVE LATTICE</span>
          {isActive && (
            <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: C.ice, display: 'inline-block', animation: 'pulse 1.5s infinite', boxShadow: `0 0 6px ${C.ice}` }} />
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <LatticeChip text={`COHERENCE ${coherence}%`} variant={coherence >= 72 ? 'ice' : coherence >= 50 ? 'amber' : 'disruption'} />
          <LatticeChip text={`HARMONY ${harmonyLabel}`} variant={harmonyVariant} />
          <LatticeChip text={statusLabel} variant={statusVariant} />
        </div>
      </div>

      {/* Intent */}
      {state.objective && (
        <div style={{ padding: '5px 14px', borderBottom: `1px solid ${C.dim}`, display: 'flex', gap: '10px', alignItems: 'baseline' }}>
          <span style={{ color: C.iceDim, fontSize: '8px', letterSpacing: '2px', flexShrink: 0 }}>INTENT</span>
          <span style={{ color: C.textBright, fontSize: '10px', lineHeight: '1.4' }}>{state.objective.slice(0, 140)}</span>
        </div>
      )}

      {/* ── Main grid ──────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>

        {/* LEFT — Cognitive stages */}
        <div style={{ padding: '10px 14px', borderRight: `1px solid ${C.border}` }}>
          <div style={{ color: C.iceDim, fontSize: '8px', letterSpacing: '2px', marginBottom: '10px' }}>COGNITIVE MAP</div>
          {STAGE_ORDER.map((s, idx) => {
            const meta = STAGE_LATTICE[s]
            const done   = stageIdx > idx
            const active = stageIdx === idx
            return (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', opacity: (!done && !active) ? 0.22 : 1, transition: 'opacity 0.3s' }}>
                <span style={{ color: done ? C.cyan : active ? C.ice : C.dim, fontSize: '10px', width: '14px', flexShrink: 0, textAlign: 'center' }}>
                  {done ? '◆' : active ? meta.glyph : '○'}
                </span>
                <div style={{ flex: 1 }}>
                  <span style={{ color: done ? C.cyan : active ? C.ice : C.text, letterSpacing: '1px', fontSize: '9px' }}>{meta.label}</span>
                  {active && <span style={{ color: C.iceDim, fontSize: '8px', marginLeft: '8px' }}>{meta.trace}</span>}
                </div>
                {active && (
                  <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: C.ice, flexShrink: 0, animation: 'pulse 1.2s infinite', boxShadow: `0 0 5px ${C.ice}` }} />
                )}
              </div>
            )
          })}
          {state.stage === 'BLOCKED' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
              <span style={{ color: C.disruption, fontSize: '10px' }}>⊗</span>
              <span style={{ color: C.disruption, letterSpacing: '1px', fontSize: '9px' }}>ANOMALY UNRESOLVED</span>
            </div>
          )}
        </div>

        {/* RIGHT — Process trace */}
        <div style={{ padding: '10px 14px' }}>
          <div style={{ color: C.iceDim, fontSize: '8px', letterSpacing: '2px', marginBottom: '8px' }}>PROCESS TRACE</div>
          <div style={{ maxHeight: '138px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {state.events.length === 0
              ? <span style={{ color: C.dim, fontSize: '9px' }}>awaiting input…</span>
              : [...state.events].reverse().map((ev, i) => {
                  const line = traceLabel(ev)
                  if (!line) return null
                  return (
                    <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                      <span style={{ color: '#334155', fontSize: '9px', flexShrink: 0 }}>{fmtTime(ev.timestamp)}</span>
                      <span style={{ color: line.color, fontSize: '9px', lineHeight: '1.45', wordBreak: 'break-word' }}>{line.text}</span>
                    </div>
                  )
                })
            }
          </div>
        </div>
      </div>

      {/* ── Active nodes + Lattice integrity ────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: `1px solid ${C.border}` }}>

        {/* Active nodes */}
        <div style={{ padding: '8px 14px', borderRight: `1px solid ${C.border}` }}>
          <div style={{ color: C.iceDim, fontSize: '8px', letterSpacing: '2px', marginBottom: '6px' }}>ACTIVE NODES</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
            {NODE_GROUPS.map(g => {
              const status = nodeStatus[g] ?? 'idle'
              const nodeColor =
                status === 'active'  ? C.ice :
                status === 'error'   ? C.disruption :
                status === 'dormant' ? '#2e1065' : C.dim
              const labelColor =
                status === 'active'  ? C.textBright :
                status === 'error'   ? C.disruption :
                status === 'dormant' ? '#4c1d95' : '#334155'
              return (
                <div key={g} style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: '80px' }}>
                  <span style={{
                    width: '5px', height: '5px', borderRadius: '50%', flexShrink: 0,
                    background: nodeColor,
                    boxShadow: status === 'active' ? `0 0 6px ${C.ice}` : 'none',
                    animation: status === 'active' ? 'pulse 1.2s infinite' : 'none',
                  }} />
                  <span style={{ color: labelColor, fontSize: '9px', letterSpacing: '0.5px', flex: 1 }}>{g.toUpperCase()}</span>
                  <span style={{ color: labelColor, fontSize: '8px', opacity: 0.7 }}>
                    {status === 'active' ? '●' : status === 'error' ? '⊗' : status === 'dormant' ? '○' : '○'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Lattice integrity (formerly guardian) */}
        <div style={{ padding: '8px 14px' }}>
          <div style={{ color: C.iceDim, fontSize: '8px', letterSpacing: '2px', marginBottom: '6px' }}>LATTICE INTEGRITY</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: C.text, fontSize: '9px' }}>coherence floor</span>
              <span style={{ color: C.ice, fontSize: '9px' }}>{(AGENT_CONFIDENCE_THRESHOLD * 100).toFixed(0)}%</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: C.text, fontSize: '9px' }}>integrity guard</span>
              <span style={{ color: C.cyan, fontSize: '9px' }}>ACTIVE</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: C.text, fontSize: '9px' }}>reoptimization cycles</span>
              <span style={{ color: state.retryCount > 0 ? C.amber : C.text, fontSize: '9px' }}>{state.retryCount} / 3</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: C.text, fontSize: '9px' }}>thread coherence</span>
              <span style={{ color: state.riskLevel === 'HIGH' ? C.disruption : state.riskLevel === 'MEDIUM' ? C.amber : C.cyan, fontSize: '9px' }}>{harmonyLabel}</span>
            </div>
            {/* Thread progress */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
              <span style={{ color: C.iceDim, fontSize: '8px', letterSpacing: '1px', flexShrink: 0 }}>THREADS</span>
              <div style={{ flex: 1, height: '2px', background: C.dim, borderRadius: '1px', overflow: 'hidden' }}>
                <div style={{ width: `${iterPct}%`, height: '100%', background: C.ice, transition: 'width 0.4s', boxShadow: `0 0 4px ${C.ice}` }} />
              </div>
              <span style={{ color: C.text, fontSize: '9px', flexShrink: 0 }}>{state.iterCurrent}/{state.iterTotal}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Schema accordion (active plan) ──────────────────── */}
      {planLines.length > 0 && (
        <div style={{ borderTop: `1px solid ${C.border}` }}>
          <button
            onClick={() => setPlanOpen(o => !o)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', padding: '7px 14px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
          >
            <span style={{ color: C.ice, fontSize: '9px', letterSpacing: '2px', fontWeight: 700 }}>◇ EXECUTION SCHEMA</span>
            <span style={{ color: C.iceDim, fontSize: '9px' }}>{planOpen ? '▲' : '▼'}</span>
          </button>
          {planOpen && (
            <div style={{ padding: '0 14px 10px' }}>
              {planLines.map((line, i) => (
                <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
                  <span style={{ color: C.iceDim, fontSize: '9px', flexShrink: 0, width: '14px' }}>{i + 1}.</span>
                  <span style={{ color: C.textBright, fontSize: '9px', lineHeight: '1.5' }}>{line.replace(/^\d+\.\s*/, '')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
