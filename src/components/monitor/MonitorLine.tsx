// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
import type { MonitorOperation, SystemActivity } from '../../types/monitor'

interface MonitorLineProps {
  op?: MonitorOperation
  activity?: SystemActivity
}

export function MonitorLine({ op, activity }: MonitorLineProps) {
  if (op) {
    const typeColors = {
      read: 'text-blue-400',
      write: 'text-green-400',
      execute: 'text-yellow-400',
      error: 'text-red-400',
      info: 'text-zinc-400',
      warn: 'text-orange-400',
    }

    const statusIcon = op.status === 'running' ? '▶' : op.status === 'done' ? '✓' : '✗'

    return (
      <div className="flex items-start gap-2 py-1 font-mono text-xs">
        <span className="text-zinc-600">{statusIcon}</span>
        <span className={typeColors[op.type]}>{op.type.toUpperCase()}</span>
        <span className="text-zinc-500">{op.tool}</span>
        <span className="text-zinc-400 truncate">{op.target}</span>
        {op.detail && <span className="text-zinc-600">{op.detail}</span>}
        {op.durationMs && <span className="text-zinc-700 ml-auto">+{op.durationMs}ms</span>}
      </div>
    )
  }

  if (activity) {
    const categoryColors = {
      file: 'text-blue-400',
      network: 'text-purple-400',
      command: 'text-yellow-400',
      reasoning: 'text-orange-400',
      guardian: 'text-red-400',
    }

    return (
      <div className="flex items-start gap-2 py-1 font-mono text-xs">
        <span className="text-zinc-600">{new Date(activity.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
        <span className={categoryColors[activity.category]}>{activity.category.toUpperCase()}</span>
        <span className="text-zinc-400">{activity.action}</span>
        {activity.path && <span className="text-zinc-500">{activity.path}</span>}
        {activity.result && (
          <span className={activity.result === 'success' ? 'text-green-500' : activity.result === 'failure' ? 'text-red-500' : 'text-yellow-500'}>
            {activity.result}
          </span>
        )}
      </div>
    )
  }

  return null
}
