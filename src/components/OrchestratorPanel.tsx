import { useState } from 'react'
import type { AgentContract, AgentId, OrchestratorEvent, TaskSpec } from '../types/orchestrator'

interface OrchestratorPanelProps {
  taskQueue: TaskSpec[]
  events: OrchestratorEvent[]
  contracts: Record<AgentId, AgentContract>
  onResolveTask: (taskId: string) => void
}

const EVENT_COLOR: Record<string, string> = {
  task_admitted:      '#22c55e',
  task_rejected:      '#eab308',
  authority_violation:'#ef4444',
  recovery_triggered: '#f97316',
}

const EVENT_BG: Record<string, string> = {
  task_admitted:      '#001a00',
  task_rejected:      '#1a1500',
  authority_violation:'#1a0000',
  recovery_triggered: '#1a0a00',
}

type PanelView = 'queue' | 'events' | 'contracts'

export function OrchestratorPanel({ taskQueue, events, contracts, onResolveTask }: OrchestratorPanelProps) {
  const [view, setView] = useState<PanelView>('queue')
  const [expandedAgent, setExpandedAgent] = useState<AgentId | null>(null)

  const viewBtn = (v: PanelView, label: string) => (
    <button
      onClick={() => setView(v)}
      style={{
        background: 'transparent',
        border: 'none',
        borderBottom: view === v ? '1px solid #f97316' : '1px solid transparent',
        color: view === v ? '#f97316' : '#555',
        padding: '4px 10px',
        cursor: 'pointer',
        fontSize: '9px',
        fontWeight: 'bold',
        letterSpacing: '1px',
        textTransform: 'uppercase',
        fontFamily: 'monospace',
      }}
    >
      {label}
    </button>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', height: '100%' }}>

      {/* Sub-nav */}
      <div style={{ display: 'flex', gap: '4px', borderBottom: '1px solid #1a1a1a', paddingBottom: '2px' }}>
        {viewBtn('queue', `Queue (${taskQueue.length})`)}
        {viewBtn('events', `Events (${events.length})`)}
        {viewBtn('contracts', 'Contracts')}
      </div>

      {/* ── Task Queue ── */}
      {view === 'queue' && (
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {taskQueue.length === 0 ? (
            <div style={{ color: '#333', fontSize: '12px', textAlign: 'center', marginTop: '40px' }}>
              No tasks in queue.
            </div>
          ) : (
            taskQueue.map(task => (
              <div key={task.taskId} style={{ background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: '6px', padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
                  <span style={{ fontSize: '9px', color: '#22c55e', border: '1px solid #22c55e', padding: '1px 5px', borderRadius: '3px', letterSpacing: '0.5px' }}>ADMITTED</span>
                  <span style={{ fontSize: '9px', color: '#555', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{task.agentId}</span>
                  <button
                    onClick={() => onResolveTask(task.taskId)}
                    style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid #333', color: '#555', fontSize: '8px', padding: '2px 6px', borderRadius: '3px', cursor: 'pointer', fontFamily: 'monospace', textTransform: 'uppercase' }}
                  >
                    RESOLVE
                  </button>
                </div>
                <div style={{ fontSize: '11px', color: '#ccc', marginBottom: '4px' }}>{task.intent}</div>
                <div style={{ fontSize: '9px', color: '#444' }}>
                  scopes: {task.requestedScopes.join(', ')} · timeout: {task.timeout}ms
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Event Log ── */}
      {view === 'events' && (
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {events.length === 0 ? (
            <div style={{ color: '#333', fontSize: '12px', textAlign: 'center', marginTop: '40px' }}>
              No orchestrator events.
            </div>
          ) : (
            events.map(event => {
              const color = EVENT_COLOR[event.type] ?? '#888'
              const bg    = EVENT_BG[event.type]    ?? '#111'
              return (
                <div key={event.eventId} style={{ background: bg, border: `1px solid ${color}22`, borderRadius: '6px', padding: '10px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span style={{ fontSize: '9px', fontWeight: 'bold', color, border: `1px solid ${color}`, padding: '1px 5px', borderRadius: '3px', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                      {event.type.replace(/_/g, ' ')}
                    </span>
                    <span style={{ fontSize: '9px', color: '#555', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{event.agentId}</span>
                    <span style={{ fontSize: '9px', color: '#444', marginLeft: 'auto' }}>{new Date(event.timestamp).toLocaleTimeString()}</span>
                  </div>
                  {event.reason && (
                    <div style={{ fontSize: '11px', color: '#aaa', fontFamily: 'monospace' }}>{event.reason}</div>
                  )}
                  {event.taskSpec && (
                    <div style={{ fontSize: '9px', color: '#444', marginTop: '3px' }}>
                      task: {event.taskSpec.taskId} · intent: {event.taskSpec.intent}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}

      {/* ── Contracts ── */}
      {view === 'contracts' && (
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {(Object.values(contracts) as AgentContract[]).map(contract => (
            <div key={contract.id} style={{ background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: '6px', overflow: 'hidden' }}>
              <div
                onClick={() => setExpandedAgent(expandedAgent === contract.id ? null : contract.id)}
                style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
              >
                <span style={{ fontSize: '9px', color: '#f97316', fontWeight: 'bold', letterSpacing: '1px', textTransform: 'uppercase' }}>{contract.id}</span>
                <span style={{ fontSize: '9px', color: '#444' }}>v{contract.version}</span>
                <span style={{ fontSize: '9px', color: '#555', marginLeft: 'auto' }}>{contract.capabilities.length} capabilities</span>
                <span style={{ fontSize: '9px', color: '#444', transform: expandedAgent === contract.id ? 'rotate(90deg)' : 'rotate(0)', display: 'inline-block', transition: 'transform 0.15s' }}>▶</span>
              </div>
              {expandedAgent === contract.id && (
                <div style={{ borderTop: '1px solid #1a1a1a', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div>
                    <div style={{ fontSize: '9px', color: '#555', letterSpacing: '1px', marginBottom: '4px' }}>MAX SCOPES</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                      {contract.maxScopes.map(scope => (
                        <span key={scope} style={{ fontSize: '9px', color: '#3b82f6', border: '1px solid #1a2a3a', padding: '1px 5px', borderRadius: '3px', fontFamily: 'monospace' }}>{scope}</span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '9px', color: '#555', letterSpacing: '1px', marginBottom: '4px' }}>CAPABILITIES</div>
                    {contract.capabilities.map(cap => (
                      <div key={cap.name} style={{ marginBottom: '6px' }}>
                        <div style={{ fontSize: '10px', color: '#ccc', fontFamily: 'monospace' }}>{cap.name}</div>
                        <div style={{ fontSize: '9px', color: '#555', marginBottom: '2px' }}>{cap.description}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                          {cap.scopes.map(s => (
                            <span key={s} style={{ fontSize: '8px', color: '#666', border: '1px solid #222', padding: '1px 4px', borderRadius: '2px', fontFamily: 'monospace' }}>{s}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: '9px', color: '#444' }}>maxRetries: {contract.maxRetries}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
