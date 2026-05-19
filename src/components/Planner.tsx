// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
import { useState } from 'react'

export interface PlanStep {
  id: string
  title: string
  status: 'pending' | 'active' | 'done'
  description?: string
}

interface PlannerProps {
  steps: PlanStep[]
  title?: string
}

function parsePlanText(planText: string): PlanStep[] {
  const lines = planText.split('\n').filter(l => l.trim())
  const steps: PlanStep[] = []
  let idx = 0

  for (const line of lines) {
    const trimmed = line.trim()
    // Match numbered steps: "1. Do something" or "Step 1: Do something"
    const numMatch = trimmed.match(/^(?:Step\s*)?(\d+)[\.:\)\-]\s*(.+)$/i)
    if (numMatch) {
      steps.push({
        id: `plan-step-${idx}`,
        title: numMatch[2].trim(),
        status: 'pending',
      })
      idx++
      continue
    }
    // Match bullet steps: "- Do something" or "* Do something"
    const bulletMatch = trimmed.match(/^[\*\-\+•]\s*(.+)$/)
    if (bulletMatch) {
      steps.push({
        id: `plan-step-${idx}`,
        title: bulletMatch[1].trim(),
        status: 'pending',
      })
      idx++
      continue
    }
    // If no match but previous step exists, append as description
    if (steps.length > 0 && !trimmed.match(/^(?:Step\s*)?\d+[\.:\)\-]/i) && !trimmed.match(/^[\*\-\+•]/)) {
      const last = steps[steps.length - 1]
      last.description = last.description ? `${last.description}\n${trimmed}` : trimmed
    }
  }

  // If no structured steps found, treat each line as a step
  if (steps.length === 0) {
    return lines.map((line, i) => ({
      id: `plan-step-${i}`,
      title: line.trim(),
      status: 'pending' as const,
    }))
  }

  return steps
}

export function Planner({ steps: rawSteps, title = 'Planner' }: PlannerProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  const doneCount = rawSteps.filter(s => s.status === 'done').length
  const activeStep = rawSteps.find(s => s.status === 'active')
  const progressText = `${doneCount} / ${rawSteps.length}`

  return (
    <div style={{
      border: '1px solid #1a1a1a',
      borderRadius: '10px',
      overflow: 'hidden',
      background: '#0a0a0a',
      marginBottom: '16px',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px',
        background: '#0d0d0d',
        borderBottom: '1px solid #1a1a1a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '16px' }}>🎯</span>
          <span style={{
            color: '#ccc',
            fontSize: '13px',
            fontWeight: 600,
            letterSpacing: '0.3px',
          }}>
            {title}
          </span>
        </div>
        <span style={{
          color: '#555',
          fontSize: '11px',
          fontFamily: 'monospace',
          letterSpacing: '1px',
        }}>
          {progressText}
        </span>
      </div>

      {/* Steps */}
      <div style={{ padding: '8px 0' }}>
        {rawSteps.map((step, index) => {
          const isExpanded = expandedIds.has(step.id)
          const hasDesc = !!step.description

          return (
            <div
              key={step.id}
              onClick={() => hasDesc && toggleExpanded(step.id)}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                padding: '8px 14px',
                cursor: hasDesc ? 'pointer' : 'default',
                borderBottom: index < rawSteps.length - 1 ? '1px solid #111' : 'none',
                background: step.status === 'active' ? 'rgba(249,115,22,0.04)' : 'transparent',
                transition: 'background 0.15s',
              }}
            >
              {/* Status icon */}
              <div style={{
                width: '18px',
                height: '18px',
                borderRadius: '50%',
                border: step.status === 'done'
                  ? 'none'
                  : step.status === 'active'
                  ? '2px solid #f97316'
                  : '2px solid #333',
                background: step.status === 'done' ? '#22c55e' : 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                marginTop: '1px',
              }}>
                {step.status === 'done' && (
                  <span style={{ color: '#000', fontSize: '11px', fontWeight: 'bold' }}>✓</span>
                )}
                {step.status === 'active' && (
                  <span style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: '#f97316',
                    animation: 'pulse 1.2s infinite',
                  }} />
                )}
              </div>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  flexWrap: 'wrap',
                }}>
                  <span style={{
                    color: step.status === 'done' ? '#555' : step.status === 'active' ? '#f97316' : '#888',
                    fontSize: '12px',
                    fontWeight: step.status === 'active' ? 600 : 500,
                    textDecoration: step.status === 'done' ? 'line-through' : 'none',
                    textDecorationColor: '#333',
                    textDecorationThickness: '1px',
                  }}>
                    {step.title}
                  </span>
                  {hasDesc && (
                    <span style={{ color: '#333', fontSize: '9px' }}>
                      {isExpanded ? '▼' : '▶'}
                    </span>
                  )}
                </div>

                {isExpanded && step.description && (
                  <div style={{
                    marginTop: '6px',
                    padding: '8px 10px',
                    background: '#080808',
                    borderRadius: '6px',
                    border: '1px solid #151515',
                  }}>
                    <pre style={{
                      margin: 0,
                      color: '#555',
                      fontSize: '10px',
                      fontFamily: "'Courier New', monospace",
                      whiteSpace: 'pre-wrap',
                      lineHeight: '1.5',
                      wordBreak: 'break-word',
                    }}>
                      {step.description}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Active step indicator */}
      {activeStep && (
        <div style={{
          padding: '8px 14px',
          background: 'rgba(249,115,22,0.03)',
          borderTop: '1px solid #1a1a1a',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <span style={{
            display: 'inline-block',
            width: '7px',
            height: '7px',
            borderRadius: '50%',
            background: '#f97316',
            animation: 'pulse 1.2s infinite',
          }} />
          <span style={{
            color: '#f97316',
            fontSize: '10px',
            fontFamily: 'monospace',
            letterSpacing: '1px',
          }}>
            CURRENT: {activeStep.title}
          </span>
        </div>
      )}
    </div>
  )
}

export { parsePlanText }
