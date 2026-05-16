// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). AGPL-3.0 License.
// Original work. Unauthorized commercial use prohibited. https://github.com/DeviousDevv303/forgeclaw
import { useState, memo } from 'react'
import type { ReasoningChain as ReasoningChainType } from '../../types/reasoning'
import { ReasoningPhase } from './ReasoningPhase'

interface ReasoningChainProps {
  chain: ReasoningChainType
}

export const ReasoningChainComponent = memo(function ReasoningChainComponent({ chain }: ReasoningChainProps) {
  const [collapsed, setCollapsed] = useState(false)
  const isComplete = !!chain.completedAt
  const activeSteps = chain.steps.filter(s => s.status === 'active').length

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden mb-4"
    >
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-3 w-full px-4 py-3 bg-slate-900/80 hover:bg-slate-800/50 transition-colors"
      >
        <span className={`text-lg ${isComplete ? '' : 'animate-pulse'}`}
        >
          {isComplete ? '✅' : activeSteps > 0 ? '⚙️' : '🔍'}
        </span>
        <span className="text-sm font-semibold text-slate-200"
        >{chain.rootLabel}</span>
        <span className="text-xs text-slate-600 ml-auto"
        >
          {chain.steps.length} steps
          {isComplete && ' · done'}
        </span>
        <span className="text-slate-600 text-xs"
        >{collapsed ? '▶' : '▼'}</span>
      </button>

      {/* Steps */}
      {!collapsed && (
        <div className="px-4 py-3 space-y-1"
        >
          {chain.steps.length === 0 ? (
            <div className="text-xs text-slate-600 italic"
            >Waiting for steps...</div>
          ) : (
            chain.steps.map(step => (
              <ReasoningPhase key={step.id} step={step} />
            ))
          )}
        </div>
      )}

      {/* Progress bar */}
      {activeSteps > 0 && !isComplete && (
        <div className="h-0.5 bg-slate-800"
        >
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
})
