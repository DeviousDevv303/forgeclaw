import { useState, memo } from 'react'
import type { ReasoningStep } from '../../types/reasoning'

const DEPTH_MARGINS = ['ml-0', 'ml-4', 'ml-8', 'ml-12']

interface ReasoningPhaseProps {
  step: ReasoningStep
  depth?: number
}

export const ReasoningPhase = memo(function ReasoningPhase({ step, depth = 0 }: ReasoningPhaseProps) {
  const [expanded, setExpanded] = useState(step.status === 'active' || step.status === 'error')

  const statusClasses = {
    active: 'border-l-2 border-orange-500 bg-orange-500/5',
    done: 'border-l-2 border-slate-700 bg-slate-800/30',
    error: 'border-l-2 border-red-500 bg-red-500/5',
    pending: 'border-l-2 border-slate-800 bg-slate-900/20',
  }

  const iconAnimation = step.status === 'active' ? 'animate-pulse' : ''
  const marginClass = DEPTH_MARGINS[Math.min(depth, DEPTH_MARGINS.length - 1)] || 'ml-0'

  return (
    <div className={marginClass}>
      <div className={`rounded-lg p-3 mb-1 ${statusClasses[step.status]}`}>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 w-full text-left"
        >
          <span className={`text-base ${iconAnimation}`}>{step.icon}</span>
          <span className={`text-sm font-medium ${
            step.status === 'error' ? 'text-red-400' :
            step.status === 'active' ? 'text-orange-400' :
            'text-slate-300'
          }`}>
            {step.label}
          </span>
          <span className="text-xs text-slate-600 ml-auto">
            {new Date(step.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            {step.durationMs && ` +${step.durationMs}ms`}
          </span>
          {step.children && step.children.length > 0 && (
            <span className="text-slate-600 text-xs">{expanded ? '▼' : '▶'}</span>
          )}
        </button>

        {expanded && step.body && (
          <div className="mt-2 text-xs text-slate-400 font-mono whitespace-pre-wrap leading-relaxed">
            {step.body}
          </div>
        )}

        {expanded && step.children && step.children.length > 0 && (
          <div className="mt-2 space-y-1">
            {step.children.map(child => (
              <ReasoningPhase key={child.id} step={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
})
