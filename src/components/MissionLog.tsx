// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
import { useState, useEffect, useRef } from 'react'

export interface MissionTask {
  id: string
  title: string
  status: 'pending' | 'active' | 'done' | 'error'
  timestamp: number
  elapsedMs?: number
  knowledge?: { label: string; url?: string }[]
  skills?: string[]
  description?: string
  subTasks?: MissionTask[]
  toolIcon?: string
  toolName?: string
}

interface MissionLogProps {
  tasks: MissionTask[]
  isThinking: boolean
  thinkingTitle?: string
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  if (m > 0) return `${m}:${String(s % 60).padStart(2, '0')}`
  return `0:${String(s).padStart(2, '0')}`
}

function TaskNode({ task, depth = 0 }: { task: MissionTask; depth?: number }) {
  const [expanded, setExpanded] = useState(true)
  const [liveMs, setLiveMs] = useState(task.elapsedMs || 0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (task.status === 'active') {
      const start = Date.now() - (task.elapsedMs || 0)
      intervalRef.current = setInterval(() => {
        setLiveMs(Date.now() - start)
      }, 1000)
      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current)
      }
    }
  }, [task.status, task.elapsedMs])

  const hasChildren = (task.subTasks && task.subTasks.length > 0) || (task.knowledge && task.knowledge.length > 0)

  const statusIcon = task.status === 'done'
    ? <span style={{ color: '#22c55e', fontSize: '14px', flexShrink: 0 }}>✓</span>
    : task.status === 'error'
    ? <span style={{ color: '#ef4444', fontSize: '14px', flexShrink: 0 }}>✗</span>
    : task.status === 'active'
    ? <span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', background: '#f97316', animation: 'pulse 1.2s infinite', flexShrink: 0 }} />
    : <span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', border: '2px solid #333', flexShrink: 0 }} />

  return (
    <div style={{ marginLeft: depth > 0 ? '18px' : '0' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '8px',
          padding: '8px 0',
          borderBottom: depth === 0 ? '1px solid #0f0f0f' : 'none',
          cursor: hasChildren ? 'pointer' : 'default',
          opacity: task.status === 'pending' ? 0.5 : 1,
          transition: 'opacity 0.2s',
        }}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        {hasChildren && (
          <span style={{ color: '#333', fontSize: '9px', marginTop: '3px', flexShrink: 0, transform: expanded ? 'none' : 'rotate(-90deg)', transition: 'transform 0.15s' }}>▼</span>
        )}
        {statusIcon}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{
              color: task.status === 'error' ? '#ef4444' : task.status === 'active' ? '#f97316' : '#ccc',
              fontSize: '12px',
              fontWeight: task.status === 'active' ? 600 : 500,
              letterSpacing: '0.3px',
            }}>
              {task.title}
            </span>
            {task.status === 'active' && (
              <span style={{ color: '#f97316', fontSize: '10px', fontFamily: 'monospace', letterSpacing: '1px' }}>
                {formatElapsed(liveMs)}
              </span>
            )}
          </div>

          {task.description && (
            <div style={{ color: '#555', fontSize: '10px', marginTop: '4px', lineHeight: '1.5' }}>
              {task.description}
            </div>
          )}

          {task.skills && task.skills.length > 0 && (
            <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
              {task.skills.map((skill, i) => (
                <span key={i} style={{ color: '#666', fontSize: '9px', border: '1px solid #1a1a1a', padding: '2px 6px', borderRadius: '3px', letterSpacing: '0.5px' }}>
                  🧩 {skill}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Knowledge recalled */}
      {expanded && task.knowledge && task.knowledge.length > 0 && (
        <div style={{ margin: '4px 0 8px 26px', padding: '8px 10px', background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
            <span style={{ color: '#555', fontSize: '10px' }}>💡</span>
            <span style={{ color: '#666', fontSize: '10px', letterSpacing: '0.5px' }}>Knowledge recalled ({task.knowledge.length})</span>
          </div>
          {task.knowledge.map((k, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 0' }}>
              <span style={{ color: '#333', fontSize: '9px' }}>☐</span>
              {k.url ? (
                <a href={k.url} target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6', fontSize: '10px', textDecoration: 'none' }}>
                  {k.label}
                </a>
              ) : (
                <span style={{ color: '#555', fontSize: '10px' }}>{k.label}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Sub-tasks */}
      {expanded && task.subTasks && task.subTasks.map(sub => (
        <TaskNode key={sub.id} task={sub} depth={depth + 1} />
      ))}
    </div>
  )
}

export function MissionLog({ tasks, isThinking, thinkingTitle }: MissionLogProps) {
  const activeTask = tasks.find(t => t.status === 'active')

  return (
    <div style={{ border: '1px solid #1a1a1a', borderRadius: '8px', overflow: 'hidden', background: '#080808' }}>
      {/* Header */}
      <div style={{ padding: '8px 12px', background: '#0d0d0d', borderBottom: '1px solid #1a1a1a', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{
          display: 'inline-block',
          width: '7px',
          height: '7px',
          borderRadius: '50%',
          background: isThinking ? '#f97316' : tasks.some(t => t.status === 'error') ? '#ef4444' : '#22c55e',
          animation: isThinking ? 'pulse 1s infinite' : 'none',
        }} />
        <span style={{ color: '#f97316', fontSize: '9px', letterSpacing: '2px', fontWeight: 'bold', fontFamily: 'monospace' }}>LIVE AGENT WORK</span>
        <span style={{ color: '#333', fontSize: '8px', marginLeft: 'auto', fontFamily: 'monospace' }}>
          {tasks.filter(t => t.status === 'done').length}/{tasks.length} COMPLETE
        </span>
      </div>

      {/* Thinking indicator */}
      {isThinking && activeTask && (
        <div style={{ padding: '8px 12px', background: '#0a0d0a', borderBottom: '1px solid #1a1a1a', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: '#3b82f6', animation: 'pulse 1.2s infinite' }} />
          <span style={{ color: '#3b82f6', fontSize: '9px', letterSpacing: '1px', fontFamily: 'monospace' }}>THINKING</span>
          <span style={{ color: '#555', fontSize: '10px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {thinkingTitle || activeTask.title}
          </span>
        </div>
      )}

      {/* Task tree */}
      <div style={{ padding: '0 12px' }}>
        {tasks.map(task => (
          <TaskNode key={task.id} task={task} />
        ))}
      </div>

      {tasks.length === 0 && (
        <div style={{ padding: '20px', textAlign: 'center', color: '#333', fontSize: '10px', letterSpacing: '1px' }}>
          NO ACTIVE TASKS
        </div>
      )}
    </div>
  )
}
