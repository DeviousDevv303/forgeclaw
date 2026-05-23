// ForgeClaw - Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
import { parsePlanText } from './Planner.parse'
import type { AgentPhase } from '../types/forgeOps'
import type { ToolResult } from '../lib/forgeTools'

type StepStatus = 'pending' | 'active' | 'done' | 'error'

interface ExecutionStep {
  id: string
  title: string
  status: StepStatus
}

interface ChatLiveExecutionProps {
  objective?: string
  plan?: string
  phase?: AgentPhase
  streaming?: boolean
  toolResults?: ToolResult[]
  trace?: string
  provider?: string
  model?: string
  error?: boolean
}

function trimLine(value: string | undefined, fallback: string, maxLength = 120): string {
  const clean = value?.replace(/\s+/g, ' ').trim()
  if (!clean) return fallback
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}...` : clean
}

function statusColor(status: StepStatus): string {
  if (status === 'done') return '#39ff14'
  if (status === 'active') return '#f97316'
  if (status === 'error') return '#ef4444'
  return '#405060'
}

function buildExecutionSteps(props: ChatLiveExecutionProps): ExecutionStep[] {
  const parsed = parsePlanText(props.plan ?? '')

  if (parsed.length > 0) {
    const activeIndex = props.error || props.phase === 'BLOCKED'
      ? parsed.length - 1
      : props.streaming
        ? 0
        : parsed.length

    return parsed.slice(0, 5).map((step, index) => ({
      id: step.id,
      title: step.title,
      status: props.error || props.phase === 'BLOCKED'
        ? index === activeIndex ? 'error' : 'done'
        : index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'pending',
    }))
  }

  if (props.error || props.phase === 'BLOCKED') {
    return [
      { id: 'input', title: 'Prompt received', status: 'done' },
      { id: 'route', title: 'Route through active provider', status: 'done' },
      { id: 'blocked', title: 'Execution needs operator review', status: 'error' },
    ]
  }

  if (props.streaming) {
    return [
      { id: 'input', title: 'Prompt received', status: 'done' },
      { id: 'route', title: 'Route through active provider', status: 'done' },
      { id: 'generate', title: 'Generating answer', status: 'active' },
      { id: 'render', title: 'Render response and trace', status: 'pending' },
    ]
  }

  return [
    { id: 'input', title: 'Prompt received', status: 'done' },
    { id: 'route', title: 'Route through active provider', status: 'done' },
    { id: props.toolResults?.length ? 'tools' : 'generate', title: props.toolResults?.length ? 'Tool work completed' : 'Answer generated', status: 'done' },
    { id: 'render', title: 'Response rendered below prompt', status: 'done' },
  ]
}

export function ChatLiveExecution(props: ChatLiveExecutionProps) {
  const steps = buildExecutionSteps(props)
  const doneCount = steps.filter(step => step.status === 'done').length
  const activeStep = steps.find(step => step.status === 'active' || step.status === 'error')
  const statusLabel = props.error || props.phase === 'BLOCKED'
    ? 'BLOCKED'
    : props.streaming
      ? 'RUNNING'
      : 'COMPLETE'
  const statusTone = props.error || props.phase === 'BLOCKED'
    ? '#ef4444'
    : props.streaming
      ? '#f97316'
      : '#39ff14'
  const progress = steps.length > 0 ? Math.round((doneCount / steps.length) * 100) : 0
  const toolSummary = props.toolResults?.slice(-3) ?? []
  const tracePreview = trimLine(props.trace?.split('\n').find(line => line.trim()), 'Trace ready', 92)

  return (
    <section style={{
      width: '100%',
      marginTop: '8px',
      borderRadius: '12px',
      border: '1px solid rgba(82, 106, 130, 0.34)',
      background: 'linear-gradient(145deg, rgba(15,23,42,0.94), rgba(5,10,18,0.98) 48%, rgba(3,7,12,0.98))',
      boxShadow: '0 18px 40px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 0 rgba(0,0,0,0.55)',
      overflow: 'hidden',
      fontFamily: "'Courier New', monospace",
      transform: 'perspective(900px) rotateX(0.6deg)',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        padding: '10px 13px',
        background: 'linear-gradient(180deg, rgba(31,41,55,0.78), rgba(7,12,20,0.88))',
        borderBottom: '1px solid rgba(82,106,130,0.22)',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
            <span style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: statusTone,
              boxShadow: `0 0 14px ${statusTone}`,
              animation: props.streaming ? 'pulse 1.2s infinite' : 'none',
              flexShrink: 0,
            }} />
            <span style={{ color: '#f97316', fontSize: '10px', letterSpacing: '2px', fontWeight: 800 }}>
              LIVE EXECUTION
            </span>
          </div>
          <div style={{ color: '#94a3b8', fontSize: '10px', lineHeight: 1.45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {activeStep?.title ?? trimLine(props.objective, 'Answer execution complete')}
          </div>
        </div>
        <div style={{ display: 'grid', justifyItems: 'end', gap: '5px', flexShrink: 0 }}>
          <span style={{
            color: statusTone,
            border: `1px solid ${statusTone}66`,
            background: `${statusTone}14`,
            borderRadius: '999px',
            padding: '3px 8px',
            fontSize: '9px',
            fontWeight: 800,
            letterSpacing: '1px',
          }}>
            {statusLabel}
          </span>
          {(props.provider || props.model) && (
            <span style={{ color: '#475569', fontSize: '8px', maxWidth: '170px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {[props.provider, props.model].filter(Boolean).join(' / ')}
            </span>
          )}
        </div>
      </div>

      <div style={{ height: '3px', background: '#05070a' }}>
        <div style={{
          width: `${props.streaming ? Math.max(progress, 62) : progress}%`,
          height: '100%',
          background: `linear-gradient(90deg, ${statusTone}, rgba(249,115,22,0.75))`,
          boxShadow: `0 0 18px ${statusTone}55`,
          transition: 'width 0.25s ease',
        }} />
      </div>

      <div style={{ display: 'grid', gap: '7px', padding: '10px 13px 11px' }}>
        {steps.map((step, index) => (
          <div key={step.id} style={{ display: 'grid', gridTemplateColumns: '18px 1fr', gap: '8px', alignItems: 'center', minWidth: 0 }}>
            <span style={{
              width: '17px',
              height: '17px',
              borderRadius: '6px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: step.status === 'done' ? '#031106' : statusColor(step.status),
              border: `1px solid ${statusColor(step.status)}66`,
              background: step.status === 'done' ? '#39ff14' : `${statusColor(step.status)}12`,
              boxShadow: step.status === 'active' ? '0 0 16px rgba(249,115,22,0.34)' : 'inset 0 1px 0 rgba(255,255,255,0.04)',
              fontSize: '9px',
              fontWeight: 800,
            }}>
              {step.status === 'done' ? index + 1 : step.status === 'active' ? '>' : step.status === 'error' ? '!' : index + 1}
            </span>
            <span style={{
              color: step.status === 'pending' ? '#475569' : statusColor(step.status),
              fontSize: '10px',
              lineHeight: 1.45,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {step.title}
            </span>
          </div>
        ))}
      </div>

      <div style={{
        display: 'grid',
        gap: '5px',
        padding: '8px 13px 10px',
        borderTop: '1px solid rgba(82,106,130,0.18)',
        background: 'rgba(2,6,12,0.36)',
      }}>
        {toolSummary.map(result => (
          <div key={result.toolCallId} style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            <span style={{ color: result.isError ? '#ef4444' : '#39ff14', fontSize: '8px', letterSpacing: '1px', flexShrink: 0 }}>
              {result.isError ? 'FAIL' : 'TOOL'}
            </span>
            <span style={{ color: '#64748b', fontSize: '9px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {result.name}: {result.output.split('\n')[0].slice(0, 120)}
            </span>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', minWidth: 0 }}>
          <span style={{ color: '#39ff14', fontSize: '8px', letterSpacing: '1.3px', flexShrink: 0 }}>TRACE</span>
          <span style={{ color: '#4ade80', fontSize: '9px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>
            {tracePreview}
          </span>
        </div>
      </div>
    </section>
  )
}
