// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). AGPL-3.0 License.
// Original work. Unauthorized commercial use prohibited. https://github.com/DeviousDevv303/forgeclaw
import { memo, useState } from 'react'
import type { ReasoningStep } from '../../types/reasoning'

const DEPTH_MARGINS = ['ml-0', 'ml-4', 'ml-8', 'ml-12'] as const

interface ReasoningStepProps {
  step: ReasoningStep
  depth?: number
}

export const ReasoningStepComponent = memo(function ReasoningStepComponent({ step, depth = 0 }: ReasoningStepProps) {
  const [expanded, setExpanded] = useState(step.status === 'active' || step.status === 'error')
  const isActive = step.status === 'active'
  const isError = step.status === 'error'

  const statusColors = {
    active: 'border-orange-500 bg-orange-500/10',
    done: 'border-zinc-700 bg-zinc-800/50',
    error: 'border-red-500 bg-red-500/10',
    pending: 'border-zinc-800 bg-zinc-900/30',
  }

  const iconAnimation = isActive ? 'animate-pulse' : ''
  const marginClass = DEPTH_MARGINS[Math.min(depth, DEPTH_MARGINS.length - 1)]

  return (
    <div className={marginClass}>
      <div
        className={`rounded-lg border-l-2 p-3 mb-2 transition-all duration-300 ${statusColors[step.status]}`}
      >
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 w-full text-left"
        >
          <span className={`text-lg ${iconAnimation}`}>{step.icon}</span>
          <span className={`text-sm font-medium ${isError ? 'text-red-400' : isActive ? 'text-orange-400' : 'text-zinc-300'}`}>
            {step.label}
          </span>
          <span className="text-xs text-zinc-600 ml-auto">
            {new Date(step.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            {step.durationMs && ` +${step.durationMs}ms`}
          </span>
          {step.children && step.children.length > 0 && (
            <span className="text-zinc-600 text-xs">{expanded ? '▼' : '▶'}</span>
          )}
        </button>

        {expanded && step.body && (
          <div className="mt-2 text-xs text-zinc-400 font-mono whitespace-pre-wrap leading-relaxed">
            {step.body}
          </div>
        )}

        {expanded && step.children && step.children.length > 0 && (
          <div className="mt-2 space-y-1">
            {step.children.map(child => (
              <ReasoningStepComponent key={child.id} step={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
})
