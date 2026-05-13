import { useState } from 'react'
import type { MonitorState, MonitorOperation, SystemActivity } from '../../types/monitor'
import { MonitorLine } from './MonitorLine'

interface SystemMonitorProps {
  state: MonitorState
  operations: MonitorOperation[]
  activities: SystemActivity[]
}

export function SystemMonitor({ state, operations, activities }: SystemMonitorProps) {
  const [expanded, setExpanded] = useState(state.isActive)
  const [filter, setFilter] = useState<'all' | 'running' | 'done'>('all')

  const filteredOps = operations.filter(op => {
    if (filter === 'running') return op.status === 'running'
    if (filter === 'done') return op.status !== 'running'
    return true
  })

  const recentActivities = activities.slice(-20)

  return (
    <div className="rounded-xl border border-zinc-800 bg-black/90 overflow-hidden mb-4">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-3 w-full px-4 py-3 bg-zinc-900/80 hover:bg-zinc-800/50 transition-colors"
      >
        <span className={`text-lg ${state.isActive ? 'animate-pulse text-yellow-400' : 'text-zinc-500'}`}>
          {state.isActive ? '⚡' : '💤'}
        </span>
        <span className="text-sm font-semibold text-zinc-200">Kimi's Computer</span>
        <span className="text-xs text-zinc-600 ml-auto">
          {state.currentPhase}
          {state.currentTool && ` · ${state.currentTool}`}
        </span>
        <span className="text-zinc-600 text-xs">{expanded ? '▼' : '▶'}</span>
      </button>

      {/* Operations */}
      {expanded && (
        <div className="px-4 py-3">
          {/* Filter tabs */}
          <div className="flex gap-2 mb-3">
            {(['all', 'running', 'done'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-xs px-2 py-1 rounded border ${
                  filter === f
                    ? 'border-orange-500 text-orange-400 bg-orange-500/10'
                    : 'border-zinc-700 text-zinc-600 hover:border-zinc-500'
                }`}
              >
                {f === 'all' ? 'All' : f === 'running' ? 'Running' : 'Done'}
              </button>
            ))}
          </div>

          {/* Operation list */}
          <div className="space-y-0.5 max-h-48 overflow-y-auto">
            {filteredOps.length === 0 ? (
              <div className="text-xs text-zinc-600 italic py-2">No operations</div>
            ) : (
              filteredOps.map(op => <MonitorLine key={op.id} op={op} />)
            )}
          </div>

          {/* Activity log */}
          {recentActivities.length > 0 && (
            <div className="mt-3 pt-3 border-t border-zinc-800">
              <div className="text-xs text-zinc-600 mb-2">Recent Activity</div>
              <div className="space-y-0.5 max-h-32 overflow-y-auto">
                {recentActivities.map(act => (
                  <MonitorLine key={act.id} activity={act} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
