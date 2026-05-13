import { useState } from 'react'
import type { ReasoningChain } from '../../types/reasoning'
import { ReasoningStepComponent } from './ReasoningStep'

interface ReasoningChainProps {
  chain: ReasoningChain
}

export function ReasoningChain({ chain }: ReasoningChainProps) {
  const [collapsed, setCollapsed] = useState(false)
  const isComplete = !!chain.completedAt
  const activeSteps = chain.steps.filter(s => s.status === 'active').length

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden mb-4">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-3 w-full px-4 py-3 bg-zinc-900/80 hover:bg-zinc-800/50 transition-colors"
      >
        <span className={`text-lg ${isComplete ? '' : 'animate-pulse'}`}>
          {isComplete ? '✅' : activeSteps > 0 ? '⚙️' : '🔍'}
        </span>
        <span className="text-sm font-semibold text-zinc-200">{chain.rootLabel}</span>
        <span className="text-xs text-zinc-600 ml-auto">
          {chain.steps.length} steps
          {isComplete && ' · done'}
        </span>
        <span className="text-zinc-600 text-xs">{collapsed ? '▶' : '▼'}</span>
      </button>

      {/* Steps */}
      {!collapsed && (
        <div className="px-4 py-3 space-y-1">
          {chain.steps.length === 0 ? (
            <div className="text-xs text-zinc-600 italic">Waiting for steps...</div>
          ) : (
            chain.steps.map(step => (
              <ReasoningStepComponent key={step.id} step={step} />
            ))
          )}
        </div>
      )}

      {/* Progress bar */}
      {activeSteps > 0 && !isComplete && (
        <div className="h-0.5 bg-zinc-800">
          <div
            className="h-full bg-orange-500 transition-all duration-500"
            style={{
              width: `${(chain.steps.filter(s => s.status === 'done').length / Math.max(chain.steps.length, 1)) * 100}%`,
            }}
          />
        </div>
      )}
    </div>
  )
}
