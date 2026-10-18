// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
import { memo } from 'react'
import { useI18n, type Key } from '../../lib/i18n'
import type { AgentActivityEvent } from '../../types/reasoning'

interface MonitorEventRowProps {
  event: AgentActivityEvent
}

export const MonitorEventRow = memo(function MonitorEventRow({ event }: MonitorEventRowProps) {
  const { t } = useI18n()
  const typeColors: Record<string, string> = {
    tool_call: 'text-yellow-400',
    file_read: 'text-blue-400',
    file_write: 'text-green-400',
    reasoning_phase: 'text-orange-400',
    agent_status: 'text-slate-400',
    error: 'text-red-400',
  }

  const typeLabels: Record<string, Key> = {
    tool_call: 'event.tool_call',
    file_read: 'event.file_read',
    file_write: 'event.file_write',
    reasoning_phase: 'event.reasoning_phase',
    agent_status: 'event.agent_status',
    error: 'event.error',
  }

  // Type-safe detail extraction
  let detail = ''
  switch (event.type) {
    case 'tool_call':
      detail = event.tool
      break
    case 'file_read':
    case 'file_write':
      detail = event.path
      break
    case 'reasoning_phase':
      detail = event.phase
      break
    case 'agent_status':
      detail = event.status
      break
    case 'error':
      detail = event.message.slice(0, 40)
      break
  }

  return (
    <div className="flex items-center gap-2 text-xs font-mono">
      <span className={typeColors[event.type] || 'text-slate-400'}>
        {typeLabels[event.type] ? t(typeLabels[event.type]) : event.type.toUpperCase()}
      </span>
      <span className="text-slate-500">{detail}</span>
      <span className="text-slate-700 ml-auto">
        {new Date(event.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </span>
    </div>
  )
})
