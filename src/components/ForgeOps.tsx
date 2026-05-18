import { useState } from 'react'
import type { ForgeOpsState, AgentEvent, ForgeStage } from '../types/forgeOps'
import { AGENT_CONFIDENCE_THRESHOLD } from '../lib/agentCore'

interface Props {
  state: ForgeOpsState
  isActive: boolean
  currentPlan?: string
}

const STAGE_ORDER: ForgeStage[] = [
  'RAW_ORE', 'SMELTING', 'HAMMERING', 'TEMPERING', 'REFORGING', 'COMPLETE',
]

const STAGE_META: Record<ForgeStage, { label: string; icon: string; desc: string }> = {
  RAW_ORE:   { label: 'RAW ORE',        icon: '⚒',  desc: 'objective received' },
  SMELTING:  { label: 'SMELTING',       icon: '🔥', desc: 'interpret & plan' },
  HAMMERING: { label: 'HAMMERING',      icon: '🛠',  desc: 'tool execution' },
  TEMPERING: { label: 'TEMPERING',      icon: '🌡',  desc: 'verification' },
  REFORGING: { label: 'REFORGING',      icon: '♻',  desc: 'retry / adapt' },
  COMPLETE:  { label: 'BLADE COMPLETE', icon: '✅', desc: 'task verified done' },
  BLOCKED:   { label: 'BLOCKED',        icon: '⊘',  desc: 'awaiting authorization' },
}

const TOOL_GROUPS = ['github', 'shell', 'web', 'memory', 'run_js', 'gmail', 'calendar', 'spawn']
const LOCKED_TOOLS = new Set(['gmail', 'calendar', 'shell']) // locked until guardian approves

function toolGroupFor(name: string): string {
  if (/github/i.test(name)) return 'github'
  if (/http_fetch|web_search/i.test(name)) return 'web'
  if (/memory/i.test(name)) return 'memory'
  if (/run_js/i.test(name)) return 'run_js'
  if (/gmail/i.test(name)) return 'gmail'
  if (/calendar/i.test(name)) return 'calendar'
  if (/shell/i.test(name)) return 'shell'
  if (/spawn/i.test(name)) return 'spawn'
  return name.split('_')[0]
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function eventLine(ev: AgentEvent): { text: string; color: string } | null {
  switch (ev.type) {
    case 'OBJECTIVE_RECEIVED': return { text: `⬟ OBJECTIVE: ${ev.objective.slice(0, 70)}`, color: '#f97316' }
    case 'PHASE_CHANGE':       return { text: `▶ phase → ${ev.phase}`, color: '#38bdf8' }
    case 'TOOL_START':         return { text: `⬡ ${ev.tool}(…) [iter ${ev.iter}]`, color: '#a3a3a3' }
    case 'TOOL_SUCCESS':       return { text: `✓ ${ev.tool} — success`, color: '#22c55e' }
    case 'TOOL_FAILURE':       return { text: `✗ ${ev.tool} [${ev.failClass}]`, color: '#ef4444' }
    case 'RETRY_DECISION':     return { text: `↺ RETRY:${ev.shouldRetry ? 'YES' : 'NO'} — ${ev.strategy.slice(0, 55)}`, color: ev.shouldRetry ? '#facc15' : '#f87171' }
    case 'CONFIDENCE_UPDATE':  return { text: `◎ confidence → ${(ev.value * 100).toFixed(0)}%`, color: '#a78bfa' }
    case 'CHECKPOINT':         return { text: `◈ soft checkpoint [${ev.iter}/${ev.total}]`, color: '#fb923c' }
    case 'MISSION_COMPLETE':   return { text: '◆ MISSION COMPLETE', color: '#22c55e' }
    case 'MISSION_BLOCKED':    return { text: `⊘ BLOCKED: ${ev.reason.slice(0, 55)}`, color: '#ef4444' }
    default: return null
  }
}

function StatusBadge({ text, variant }: { text: string; variant: 'green' | 'red' | 'yellow' | 'blue' | 'dim' }) {
  const colors = {
    green:  { bg: '#052e12', fg: '#22c55e', border: '#14532d' },
    red:    { bg: '#2e0505', fg: '#ef4444', border: '#7f1d1d' },
    yellow: { bg: '#1a1205', fg: '#facc15', border: '#713f12' },
    blue:   { bg: '#0a1a2e', fg: '#38bdf8', border: '#0c4a6e' },
    dim:    { bg: '#111',    fg: '#555',    border: '#222' },
  }[variant]
  return (
    <span style={{ fontSize: '8px', fontFamily: 'monospace', letterSpacing: '1.5px', padding: '2px 6px', borderRadius: '3px', background: colors.bg, color: colors.fg, border: `1px solid ${colors.border}` }}>
      {text}
    </span>
  )
}

export function ForgeOps({ state, isActive, currentPlan }: Props) {
  const [planOpen, setPlanOpen] = useState(false)

  if (!isActive && state.events.length === 0) return null

  const stageIdx = state.stage === 'BLOCKED' ? -1 : STAGE_ORDER.indexOf(state.stage)
  const confPct = Math.round(state.confidence * 100)
  const iterPct = state.iterTotal > 0 ? Math.round((state.iterCurrent / state.iterTotal) * 100) : 0

  // Aggregate tool statuses
  const toolStatus: Record<string, 'active' | 'idle' | 'error' | 'locked'> = {}
  for (const g of TOOL_GROUPS) {
    toolStatus[g] = LOCKED_TOOLS.has(g) && !isActive ? 'locked' : 'idle'
  }
  for (const [key, status] of Object.entries(state.toolBus)) {
    const g = toolGroupFor(key)
    if (status === 'error') toolStatus[g] = 'error'
    else if (status === 'active' && toolStatus[g] !== 'error') toolStatus[g] = 'active'
    else if (toolStatus[g] === 'idle' || toolStatus[g] === 'locked') toolStatus[g] = status
  }

  const guardianDecision = state.retryCount === 0 ? 'MONITORING'
    : state.riskLevel === 'HIGH' ? 'REVIEW REQUIRED'
    : 'APPROVED'

  const planLines = currentPlan?.split('\n').filter(Boolean) ?? []

  return (
    <div style={{
      background: '#030a03', border: '1px solid #1a3a1a', borderRadius: '6px',
      marginBottom: '10px', fontFamily: "'Courier New', monospace", fontSize: '11px', overflow: 'hidden',
    }}>
      {/* ── Header ─────────────────────────────────────────── */}
      <div style={{ background: '#050e05', borderBottom: '1px solid #1a3a1a', padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ color: '#f97316', letterSpacing: '2px', fontSize: '10px', fontWeight: 700 }}>FORGECLAW // MISSION CONTROL</span>
          {isActive && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e', display: 'inline-block', animation: 'pulse 1.2s infinite' }} />}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <StatusBadge text={`CONF: ${confPct}%`} variant={confPct >= 72 ? 'green' : confPct >= 50 ? 'yellow' : 'red'} />
          <StatusBadge text={`RISK: ${state.riskLevel}`} variant={state.riskLevel === 'HIGH' ? 'red' : state.riskLevel === 'MEDIUM' ? 'yellow' : 'green'} />
          <StatusBadge text={isActive ? 'ACTIVE' : state.stage === 'COMPLETE' ? 'COMPLETE' : 'IDLE'} variant={isActive ? 'blue' : state.stage === 'COMPLETE' ? 'green' : 'dim'} />
        </div>
      </div>

      {/* Objective */}
      {state.objective && (
        <div style={{ padding: '6px 12px', borderBottom: '1px solid #111', background: '#040c04' }}>
          <span style={{ color: '#555', fontSize: '9px', letterSpacing: '1px' }}>OBJECTIVE  </span>
          <span style={{ color: '#ddd8cc', fontSize: '10px' }}>{state.objective.slice(0, 140)}</span>
        </div>
      )}

      {/* ── Main grid ──────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
        {/* LEFT — Forge stages */}
        <div style={{ padding: '10px 12px', borderRight: '1px solid #1a3a1a' }}>
          <div style={{ color: '#3a5c2a', fontSize: '8px', letterSpacing: '2px', marginBottom: '8px' }}>FORGE PROCESS</div>
          {STAGE_ORDER.map((s, idx) => {
            const meta = STAGE_META[s]
            const done = stageIdx > idx
            const active = stageIdx === idx
            return (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px', opacity: (!done && !active) ? 0.3 : 1 }}>
                <span style={{ fontSize: '11px', width: '18px', flexShrink: 0 }}>{active ? meta.icon : done ? '✓' : '○'}</span>
                <span style={{ color: done ? '#22c55e' : active ? '#f97316' : '#555', letterSpacing: '1px', fontSize: '9px', flex: 1 }}>{meta.label}</span>
                {active && (
                  <>
                    <span style={{ color: '#555', fontSize: '9px' }}>{meta.desc}</span>
                    <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#f97316', flexShrink: 0, animation: 'pulse 1s infinite' }} />
                  </>
                )}
              </div>
            )
          })}
          {state.stage === 'BLOCKED' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
              <span style={{ fontSize: '11px' }}>⊘</span>
              <span style={{ color: '#ef4444', letterSpacing: '1px', fontSize: '9px' }}>BLOCKED</span>
            </div>
          )}
        </div>

        {/* RIGHT — Live timeline */}
        <div style={{ padding: '10px 12px' }}>
          <div style={{ color: '#3a5c2a', fontSize: '8px', letterSpacing: '2px', marginBottom: '8px' }}>LIVE EXECUTION FEED</div>
          <div style={{ maxHeight: '130px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {state.events.length === 0
              ? <span style={{ color: '#333', fontSize: '9px' }}>awaiting events…</span>
              : [...state.events].reverse().map((ev, i) => {
                  const line = eventLine(ev)
                  if (!line) return null
                  return (
                    <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                      <span style={{ color: '#444', fontSize: '9px', flexShrink: 0 }}>{fmtTime(ev.timestamp)}</span>
                      <span style={{ color: line.color, fontSize: '9px', lineHeight: '1.4', wordBreak: 'break-word' }}>{line.text}</span>
                    </div>
                  )
                })
            }
          </div>
        </div>
      </div>

      {/* ── Tool bus + Guardian row ─────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: '1px solid #1a3a1a' }}>
        {/* Tool bus */}
        <div style={{ padding: '8px 12px', borderRight: '1px solid #1a3a1a' }}>
          <div style={{ color: '#3a5c2a', fontSize: '8px', letterSpacing: '2px', marginBottom: '6px' }}>TOOL BUS</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {TOOL_GROUPS.map(g => {
              const status = toolStatus[g] ?? 'idle'
              const color = status === 'active' ? '#22c55e' : status === 'error' ? '#ef4444' : status === 'locked' ? '#7f1d1d' : '#333'
              const label = status === 'locked' ? 'LOCKED' : status.toUpperCase()
              return (
                <div key={g} style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: '80px' }}>
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: color, flexShrink: 0 }} />
                  <span style={{ color: status === 'idle' ? '#444' : color, fontSize: '9px', letterSpacing: '0.5px', flex: 1 }}>{g.toUpperCase()}</span>
                  <span style={{ color: status === 'locked' ? '#7f1d1d' : status === 'idle' ? '#333' : color, fontSize: '8px' }}>{label}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Guardian arbitration */}
        <div style={{ padding: '8px 12px' }}>
          <div style={{ color: '#3a5c2a', fontSize: '8px', letterSpacing: '2px', marginBottom: '6px' }}>GUARDIAN ARBITRATION</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#555', fontSize: '9px' }}>confidence threshold</span>
              <span style={{ color: '#aaa', fontSize: '9px' }}>{(AGENT_CONFIDENCE_THRESHOLD * 100).toFixed(0)}%</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#555', fontSize: '9px' }}>destructive guard</span>
              <span style={{ color: '#22c55e', fontSize: '9px' }}>ENABLED</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#555', fontSize: '9px' }}>retries used</span>
              <span style={{ color: state.retryCount > 0 ? '#facc15' : '#aaa', fontSize: '9px' }}>{state.retryCount} / 3</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#555', fontSize: '9px' }}>decision</span>
              <span style={{ color: guardianDecision === 'REVIEW REQUIRED' ? '#ef4444' : '#22c55e', fontSize: '9px' }}>{guardianDecision}</span>
            </div>
            {/* Iter progress */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
              <span style={{ color: '#555', fontSize: '9px' }}>iter</span>
              <div style={{ flex: 1, height: '3px', background: '#111', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{ width: `${iterPct}%`, height: '100%', background: '#38bdf8', transition: 'width 0.4s' }} />
              </div>
              <span style={{ color: '#aaa', fontSize: '9px', flexShrink: 0 }}>{state.iterCurrent}/{state.iterTotal}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Plan accordion ──────────────────────────────────── */}
      {planLines.length > 0 && (
        <div style={{ borderTop: '1px solid #1a3a1a' }}>
          <button
            onClick={() => setPlanOpen(o => !o)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', padding: '7px 12px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
          >
            <span style={{ color: '#22c55e', fontSize: '9px', letterSpacing: '2px', fontWeight: 700 }}>◆ ACTIVE PLAN</span>
            <span style={{ color: '#3a5c2a', fontSize: '9px' }}>{planOpen ? '▲' : '▼'}</span>
          </button>
          {planOpen && (
            <div style={{ padding: '0 12px 10px' }}>
              {planLines.map((line, i) => (
                <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '3px' }}>
                  <span style={{ color: '#3a5c2a', fontSize: '9px', flexShrink: 0 }}>{i + 1}.</span>
                  <span style={{ color: '#4ade80', fontSize: '9px', lineHeight: '1.5' }}>{line.replace(/^\d+\.\s*/, '')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
