// ForgeClaw - Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
import type { ForgeOpsState, AgentEvent } from '../types/forgeOps'
import { parsePlanText } from './Planner.parse'

interface LiveExecutionProps {
  state: ForgeOpsState
  currentPlan?: string
  isActive: boolean
}

type StepStatus = 'pending' | 'active' | 'done' | 'error'

interface LiveStep {
  id: string
  title: string
  status: StepStatus
}

function eventLabel(event: AgentEvent): string {
  switch (event.type) {
    case 'OBJECTIVE_RECEIVED':
      return `Objective: ${event.objective.slice(0, 90)}`
    case 'PHASE_CHANGE':
      return `Phase changed: ${event.phase.replace('_', ' ').toLowerCase()}`
    case 'TOOL_START':
      return `Running ${event.tool}`
    case 'TOOL_SUCCESS':
      return `${event.tool} completed`
    case 'TOOL_FAILURE':
      return `${event.tool} failed: ${event.failClass}`
    case 'RETRY_DECISION':
      return event.shouldRetry ? `Retrying: ${event.strategy}` : `No retry: ${event.strategy}`
    case 'PATHS_COLLAPSED':
      return `Chose path: ${event.chosen}`
    case 'CHECKPOINT':
      return `Checkpoint ${event.iter}/${event.total}`
    case 'MISSION_COMPLETE':
      return 'Task complete'
    case 'MISSION_BLOCKED':
      return `Blocked: ${event.reason}`
    case 'GUARDIAN_WARNING':
      return `Guardian: ${event.reason}`
    case 'THREAD_SPAWN':
      return `Subtask started: ${event.parentTool}`
    case 'THREAD_MERGE':
      return `Subtask merged: ${event.threadId}`
    case 'CONFIDENCE_UPDATE':
      return `Confidence updated: ${Math.round(event.value * 100)}%`
    case 'RESET':
      return 'Execution reset'
    default:
      return 'Execution event'
  }
}

function statusColor(status: StepStatus): string {
  if (status === 'done') return '#22c55e'
  if (status === 'active') return '#f97316'
  if (status === 'error') return '#ef4444'
  return '#555'
}

function buildPlanSteps(planText: string | undefined, state: ForgeOpsState, isActive: boolean): LiveStep[] {
  const parsed = parsePlanText(planText ?? '')
  if (parsed.length === 0) {
    const activeTool = Object.entries(state.toolBus).find(([, status]) => status === 'active')?.[0]
    const failedTool = Object.entries(state.toolBus).find(([, status]) => status === 'error')?.[0]
    return [
      state.objective ? { id: 'objective', title: state.objective.slice(0, 100), status: 'done' } : undefined,
      activeTool ? { id: 'active-tool', title: `Run ${activeTool}`, status: 'active' } : undefined,
      failedTool ? { id: 'failed-tool', title: `Inspect ${failedTool} failure`, status: 'error' } : undefined,
      isActive ? { id: 'active', title: 'Continue execution', status: 'active' } : undefined,
    ].filter(Boolean) as LiveStep[]
  }

  const activeIndex = state.phase === 'COMPLETE'
    ? parsed.length
    : state.phase === 'BLOCKED'
      ? Math.max(0, parsed.length - 1)
      : Math.min(Math.max(0, state.iterCurrent), parsed.length - 1)

  return parsed.map((step, index) => ({
    id: step.id,
    title: step.title,
    status: state.phase === 'BLOCKED' && index === activeIndex
      ? 'error'
      : index < activeIndex || state.phase === 'COMPLETE'
        ? 'done'
        : index === activeIndex
          ? 'active'
          : 'pending',
  }))
}

export function LiveExecution({ state, currentPlan, isActive }: LiveExecutionProps) {
  const hasWorkEvent = state.events.some(event =>
    ['TOOL_START', 'TOOL_SUCCESS', 'TOOL_FAILURE', 'RETRY_DECISION', 'PATHS_COLLAPSED', 'CHECKPOINT', 'MISSION_BLOCKED', 'THREAD_SPAWN', 'THREAD_MERGE', 'GUARDIAN_WARNING'].includes(event.type)
  )
  const shouldShow = isActive || hasWorkEvent || state.phase === 'BLOCKED'
  if (!shouldShow) return null

  const steps = buildPlanSteps(currentPlan, state, isActive).slice(0, 5)
  const recentEvents = state.events.slice(-4).reverse()
  const activeStep = steps.find(step => step.status === 'active' || step.status === 'error')
  const doneCount = steps.filter(step => step.status === 'done').length
  const progress = steps.length > 0 ? Math.round((doneCount / steps.length) * 100) : 0
  const statusLabel = state.phase === 'BLOCKED'
    ? 'BLOCKED'
    : isActive
      ? 'RUNNING'
      : state.phase === 'COMPLETE'
        ? 'COMPLETE'
        : state.phase.replace('_', ' ')

  return (
    <section style={{
      border: '1px solid #1f2937',
      background: 'rgba(5, 10, 15, 0.94)',
      borderRadius: '10px',
      margin: '0 0 10px',
      overflow: 'hidden',
      boxShadow: '0 -8px 28px rgba(0,0,0,0.28)',
      fontFamily: "'Courier New', monospace",
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '12px',
        padding: '10px 14px',
        borderBottom: '1px solid #111827',
        background: 'rgba(17, 24, 39, 0.72)',
      }}>
        <div>
          <div style={{ color: '#f97316', fontSize: '10px', letterSpacing: '2px', fontWeight: 800 }}>
            LIVE EXECUTION
          </div>
          <div style={{ color: '#94a3b8', fontSize: '10px', marginTop: '4px', lineHeight: 1.4 }}>
            {activeStep?.title ?? state.objective.slice(0, 120) ?? 'Monitoring current task'}
          </div>
        </div>
        <span style={{
          color: state.phase === 'BLOCKED' ? '#ef4444' : isActive ? '#f97316' : '#22c55e',
          border: `1px solid ${state.phase === 'BLOCKED' ? '#7f1d1d' : isActive ? '#7c2d12' : '#14532d'}`,
          background: state.phase === 'BLOCKED' ? 'rgba(127,29,29,0.18)' : isActive ? 'rgba(124,45,18,0.18)' : 'rgba(20,83,45,0.18)',
          borderRadius: '999px',
          padding: '4px 8px',
          fontSize: '9px',
          letterSpacing: '1px',
          whiteSpace: 'nowrap',
        }}>
          {statusLabel}
        </span>
      </div>

      <div style={{ height: '2px', background: '#0f172a' }}>
        <div style={{
          width: `${progress}%`,
          height: '100%',
          background: state.phase === 'BLOCKED' ? '#ef4444' : '#f97316',
          transition: 'width 0.25s ease',
        }} />
      </div>

      {steps.length > 0 && (
        <div style={{ padding: '8px 14px', display: 'grid', gap: '6px' }}>
          {steps.map(step => (
            <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: '9px', minWidth: 0 }}>
              <span style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: step.status === 'pending' ? 'transparent' : statusColor(step.status),
                border: `1px solid ${statusColor(step.status)}`,
                boxShadow: step.status === 'active' ? '0 0 10px rgba(249,115,22,0.55)' : 'none',
                flexShrink: 0,
              }} />
              <span style={{
                color: step.status === 'done' ? '#64748b' : step.status === 'pending' ? '#475569' : statusColor(step.status),
                fontSize: '11px',
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
      )}

      {recentEvents.length > 0 && (
        <div style={{
          display: 'grid',
          gap: '4px',
          padding: '8px 14px 10px',
          borderTop: '1px solid #111827',
          color: '#64748b',
          fontSize: '9px',
        }}>
          {recentEvents.map(event => (
            <div key={`${event.type}-${event.timestamp}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{eventLabel(event)}</span>
              <span style={{ color: '#334155', flexShrink: 0 }}>{new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
