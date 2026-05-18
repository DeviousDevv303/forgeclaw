import type { AgentEvent, ForgeStage } from '../../types/forgeOps'
import { L } from './palette'

interface Props {
  events: AgentEvent[]
}

const STAGE_LABELS: Partial<Record<ForgeStage, string>> = {
  RAW_ORE:   'INTENT CAPTURED',
  SMELTING:  'PATTERN RECOGNIZED',
  HAMMERING: 'SYNAPTIC BRIDGE FORMED',
  TEMPERING: 'COHERENCE LOCK',
  REFORGING: 'PATH REOPTIMIZED',
  COMPLETE:  'COHERENCE ACHIEVED',
  BLOCKED:   'ANOMALY UNRESOLVED',
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function traceLabel(ev: AgentEvent): { text: string; color: string } | null {
  switch (ev.type) {
    case 'OBJECTIVE_RECEIVED':
      return { text: `◈ INTENT CAPTURED — ${ev.objective.slice(0, 65)}`, color: L.active }
    case 'PHASE_CHANGE':
      return { text: `◇ pattern shift → ${STAGE_LABELS[ev.phase as ForgeStage] ?? ev.phase}`, color: '#6bbfad' }
    case 'TOOL_START':
      return { text: `◉ synaptic bridge: ${ev.tool}  [thread ${ev.iter}]`, color: L.textDim }
    case 'TOOL_SUCCESS':
      return { text: `◆ bridge stabilized: ${ev.tool}`, color: L.active }
    case 'TOOL_FAILURE':
      return { text: `⊗ anomaly detected: ${ev.tool}  [${ev.failClass}]`, color: L.anomaly }
    case 'RETRY_DECISION':
      return {
        text: ev.shouldRetry
          ? `↻ vector reoptimized — ${ev.strategy.slice(0, 55)}`
          : `⊘ resolution deferred — ${ev.strategy.slice(0, 55)}`,
        color: L.guard,
      }
    case 'PATHS_COLLAPSED':
      return { text: `≈ ${ev.discarded.length + 1} paths collapsed`, color: '#2e4a3e' }
    case 'CHECKPOINT':
      return { text: `◈ coherence checkpoint  [${ev.iter}/${ev.total}]`, color: L.guard }
    case 'MISSION_COMPLETE':
      return { text: '● COHERENCE ACHIEVED', color: L.active }
    case 'MISSION_BLOCKED':
      return { text: `⊗ ANOMALY UNRESOLVED — ${ev.reason.slice(0, 55)}`, color: L.anomaly }
    case 'GUARDIAN_WARNING':
      return { text: `⚠ INTEGRITY GUARD — ${ev.reason}`, color: L.guard }
    case 'THREAD_SPAWN':
      return { text: `● thread allocated: ${ev.threadId}`, color: L.textDim }
    case 'THREAD_MERGE':
      return { text: `○ thread collapsed: ${ev.threadId}`, color: L.textDim }
    default:
      return null
  }
}

export function ProcessTrace({ events }: Props) {
  return (
    <div style={{ padding: '10px 14px' }}>
      <div style={{ color: L.textDim, fontSize: '8px', letterSpacing: '2px', marginBottom: '8px' }}>
        PROCESS TRACE
      </div>
      <div style={{ maxHeight: '160px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {events.length === 0
          ? <span style={{ color: L.textDim, fontSize: '9px' }}>awaiting input…</span>
          : [...events].reverse().map((ev, i) => {
              const line = traceLabel(ev)
              if (!line) return null
              return (
                <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                  <span style={{ color: L.textDim, fontSize: '9px', flexShrink: 0 }}>{fmtTime(ev.timestamp)}</span>
                  <span style={{ color: line.color, fontSize: '9px', lineHeight: '1.45', wordBreak: 'break-word' }}>
                    {line.text}
                  </span>
                </div>
              )
            })
        }
      </div>
    </div>
  )
}
