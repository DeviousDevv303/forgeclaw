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

interface ActionPill {
  id: string
  icon: string
  title: string
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

function trimLine(value: string | undefined, fallback: string, maxLength = 86): string {
  const clean = value?.replace(/\s+/g, ' ').trim()
  if (!clean) return fallback
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}...` : clean
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
      { id: 'input', title: 'Understand the user request', status: 'done' },
      { id: 'route', title: 'Check runtime and available tools', status: 'done' },
      { id: 'blocked', title: 'Stop and surface the blocked condition', status: 'error' },
    ]
  }

  if (props.streaming) {
    return [
      { id: 'input', title: 'Understand the user request', status: 'done' },
      { id: 'route', title: 'Check runtime and available tools', status: 'done' },
      { id: 'generate', title: 'Generate the response in the chat stream', status: 'active' },
      { id: 'render', title: 'Attach execution and reasoning trace', status: 'pending' },
    ]
  }

  return [
    { id: 'input', title: 'Understand the user request', status: 'done' },
    { id: 'route', title: 'Check runtime and available tools', status: 'done' },
    { id: props.toolResults?.length ? 'tools' : 'generate', title: props.toolResults?.length ? 'Complete tool work for this answer' : 'Generate the response in the chat stream', status: 'done' },
    { id: 'render', title: 'Attach execution and reasoning trace', status: 'done' },
  ]
}

function buildActionPills(props: ChatLiveExecutionProps, steps: ExecutionStep[]): ActionPill[] {
  const providerLabel = [props.provider, props.model].filter(Boolean).join(' / ') || 'active runtime'
  const toolPills = (props.toolResults ?? []).slice(-3).map((result, index) => ({
    id: `tool-${result.toolCallId}-${index}`,
    icon: result.isError ? '!' : '>_',
    title: `${result.name}: ${result.output.split('\n')[0]}`,
  }))

  return [
    { id: 'objective', icon: '<>', title: `Extract details on ${trimLine(props.objective, 'the current prompt', 74)}` },
    { id: 'runtime', icon: '>_', title: `Check tools available for ${trimLine(providerLabel, 'active runtime', 74)}` },
    ...toolPills,
    { id: 'final', icon: '->', title: trimLine(steps.at(-1)?.title, 'Deliver final response', 82) },
  ]
}

function statusNode(status: StepStatus): { text: string; background: string; color: string; border: string } {
  if (status === 'error') return { text: '!', background: '#6a2b2b', color: '#f5d5d5', border: '#8a3a3a' }
  if (status === 'active') return { text: '', background: '#4b4b4b', color: '#f4f4f4', border: '#777' }
  if (status === 'done') return { text: '✓', background: '#686868', color: '#f1f1f1', border: '#686868' }
  return { text: '', background: '#1f1f1f', color: '#aaa', border: '#3a3a3a' }
}

function ActionPillRow({ pill }: { pill: ActionPill }) {
  return (
    <div style={{
      minHeight: '35px',
      border: '1px solid #353535',
      background: 'linear-gradient(180deg, #282828, #202020)',
      borderRadius: '999px',
      display: 'grid',
      gridTemplateColumns: '28px 1fr',
      alignItems: 'center',
      gap: '3px',
      padding: '0 12px',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 0 rgba(0,0,0,0.5)',
      minWidth: 0,
    }}>
      <span style={{
        width: '22px',
        height: '22px',
        borderRadius: '7px',
        border: '1px solid #555',
        color: '#a9a9a9',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '10px',
        fontFamily: "'JetBrains Mono', 'Courier New', monospace",
        lineHeight: 1,
      }}>
        {pill.icon}
      </span>
      <span style={{
        color: '#aaa',
        fontSize: '14px',
        lineHeight: 1.25,
        fontWeight: 700,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        letterSpacing: '0',
      }}>
        {trimLine(pill.title, 'Execution action', 72)}
      </span>
    </div>
  )
}

export function ChatLiveExecution(props: ChatLiveExecutionProps) {
  const steps = buildExecutionSteps(props)
  const pills = buildActionPills(props, steps)
  const toolSummary = props.toolResults?.slice(-2) ?? []
  const doneCount = steps.filter(step => step.status === 'done').length
  const activeStep = steps.find(step => step.status === 'active' || step.status === 'error') ?? steps.at(-1)
  const tracePreview = trimLine(props.trace?.split('\n').find(line => line.trim()), 'Standing rules for all actions', 70)
  const isBlocked = props.error || props.phase === 'BLOCKED'
  const statusText = isBlocked ? 'blocked' : props.streaming ? 'running' : 'complete'

  return (
    <section style={{
      width: '100%',
      marginTop: '10px',
      borderRadius: '18px',
      background: 'linear-gradient(180deg, #171717, #111 68%, #0d0d0d)',
      border: '1px solid #252525',
      boxShadow: '0 22px 50px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.035)',
      overflow: 'hidden',
      color: '#d7d7d7',
      fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    }}>
      <div style={{ position: 'relative', padding: '12px 16px 14px 42px' }}>
        <div style={{
          position: 'absolute',
          left: '24px',
          top: '0',
          bottom: '58px',
          borderLeft: '2px dotted #303030',
        }} />

        <div style={{ display: 'grid', gap: '10px', marginBottom: '14px' }}>
          {pills.slice(0, 2).map(pill => <ActionPillRow key={pill.id} pill={pill} />)}
        </div>

        <p style={{
          color: '#aaa',
          fontSize: '14px',
          lineHeight: 1.5,
          margin: '0 0 14px',
          letterSpacing: '0',
        }}>
          {isBlocked
            ? 'Execution is paused because the runtime needs operator attention before continuing.'
            : props.streaming
              ? 'ForgeClaw is working through the prompt and updating this answer as the task progresses.'
              : 'ForgeClaw completed this answer and kept the execution path attached to the response.'}
        </p>

        <div style={{ display: 'grid', gap: '14px' }}>
          {steps.slice(0, 3).map((step, index) => {
            const node = statusNode(step.status)
            const tool = toolSummary[index]

            return (
              <div key={step.id} style={{ position: 'relative' }}>
                <span style={{
                  position: 'absolute',
                  left: '-31px',
                  top: '2px',
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  border: `1px solid ${node.border}`,
                  background: node.background,
                  color: node.color,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '14px',
                  fontWeight: 800,
                  boxShadow: step.status === 'active' ? '0 0 0 5px rgba(255,255,255,0.04)' : '0 2px 8px rgba(0,0,0,0.4)',
                }}>
                  {node.text}
                  {step.status === 'active' && (
                    <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#f0f0f0', animation: 'pulse 1.2s infinite' }} />
                  )}
                </span>

                <div style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: '12px',
                }}>
                  <div style={{
                    color: '#e4e4e4',
                    fontSize: '15px',
                    lineHeight: 1.42,
                    fontWeight: 800,
                    letterSpacing: '0',
                  }}>
                    {trimLine(step.title, 'Execution step', 82)}
                  </div>
                  <span style={{ color: '#8d8d8d', fontSize: '18px', lineHeight: 1, transform: step.status === 'pending' ? 'rotate(180deg)' : 'none' }}>
                    ^
                  </span>
                </div>

                {index === 0 && (
                  <div style={{
                    marginTop: '11px',
                    borderRadius: '18px',
                    border: '1px solid #303030',
                    background: 'linear-gradient(180deg, #202020, #171717)',
                    padding: '12px 14px',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.035)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#a7a7a7', fontSize: '14px', fontWeight: 800, marginBottom: '10px' }}>
                      <span style={{
                        width: '22px',
                        height: '22px',
                        borderRadius: '50%',
                        border: '1px solid #505050',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#aaa',
                        fontSize: '12px',
                      }}>
                        ?
                      </span>
                      <span>Knowledge recalled(1)</span>
                      <span style={{ color: '#777', marginLeft: '2px' }}>⌄</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '9px', color: '#bdbdbd', fontSize: '13px', minWidth: 0 }}>
                      <span style={{ width: '14px', height: '16px', border: '1px solid #9a9a9a', borderRadius: '2px', flexShrink: 0 }} />
                      <span style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        textDecoration: 'underline',
                        textUnderlineOffset: '3px',
                      }}>
                        {tracePreview}
                      </span>
                    </div>
                  </div>
                )}

                {tool && (
                  <div style={{ marginTop: '10px' }}>
                    <ActionPillRow
                      pill={{
                        id: tool.toolCallId,
                        icon: tool.isError ? '!' : '[]',
                        title: `${tool.name}: ${tool.output.split('\n')[0]}`,
                      }}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {pills.slice(2, 5).length > 0 && (
          <div style={{ display: 'grid', gap: '10px', marginTop: '15px' }}>
            {pills.slice(2, 5).map(pill => <ActionPillRow key={pill.id} pill={pill} />)}
          </div>
        )}

        <div style={{
          marginTop: '16px',
          minHeight: '48px',
          borderRadius: '17px',
          background: 'linear-gradient(180deg, #3a3a3a, #2a2a2a)',
          border: '1px solid #3f3f3f',
          boxShadow: '0 10px 25px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.05)',
          display: 'grid',
          gridTemplateColumns: '42px 1fr auto',
          alignItems: 'center',
          gap: '10px',
          padding: '8px 13px',
        }}>
          <span style={{
            width: '34px',
            height: '34px',
            borderRadius: '9px',
            background: '#151515',
            border: '1px solid #262626',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#cfcfcf',
            fontSize: '13px',
            fontWeight: 800,
          }}>
            {isBlocked ? '!' : statusText === 'running' ? '>' : '✓'}
          </span>
          <span style={{
            color: '#d8d8d8',
            fontSize: '14px',
            lineHeight: 1.25,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
          }}>
            {trimLine(activeStep?.title, 'Execution attached to answer', 66)}
          </span>
          <span style={{ color: '#a7a7a7', fontSize: '13px', whiteSpace: 'nowrap' }}>
            {doneCount} / {steps.length} ^
          </span>
        </div>
      </div>
    </section>
  )
}
