import { useRef, useEffect, useState } from 'react'
import type { AgentEvent, ForgeStage } from '../../types/forgeOps'
import { L } from './palette'
import { TypingText } from './TypingText'

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

interface TraceRowProps {
  ev: AgentEvent
  isNew: boolean
}

function TraceRow({ ev, isNew }: TraceRowProps) {
  // Capture at mount — never allow isNew to flip after the component is mounted.
  // If it flipped, useLiveTyping would re-run and interrupt in-progress typing.
  const [shouldType] = useState(() => isNew)
  const line = traceLabel(ev)
  if (!line) return null
  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
      <span style={{ color: L.textDim, fontSize: '9px', flexShrink: 0 }}>{fmtTime(ev.timestamp)}</span>
      <TypingText
        text={line.text}
        color={line.color}
        speed={28}
        instant={!shouldType}
        style={{ fontSize: '9px', lineHeight: '1.45', wordBreak: 'break-word' as const }}
      />
    </div>
  )
}

export function ProcessTrace({ events }: Props) {
  // Seed with all events present on first render so they appear instantly.
  // Events arriving after mount will have timestamps not in the set → they type in.
  const seenRef = useRef<Set<number> | null>(null)
  if (seenRef.current === null) {
    seenRef.current = new Set(events.map(e => e.timestamp))
  }

  useEffect(() => {
    events.forEach(ev => seenRef.current!.add(ev.timestamp))
  }, [events])

  const reversed = [...events].reverse()

  return (
    <div style={{ padding: '10px 14px' }}>
      <div style={{ color: L.textDim, fontSize: '8px', letterSpacing: '2px', marginBottom: '8px' }}>
        PROCESS TRACE
      </div>
      <div style={{ maxHeight: '160px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {reversed.length === 0
          ? <span style={{ color: L.textDim, fontSize: '9px' }}>awaiting input…</span>
          : reversed.map(ev => (
              <TraceRow
                key={ev.timestamp}
                ev={ev}
                isNew={!seenRef.current!.has(ev.timestamp)}
              />
            ))
        }
      </div>
    </div>
  )
}
