// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
import { useState } from 'react'
import type { PlanStep } from './Planner.parse'

export type { PlanStep } from './Planner.parse'

interface PlannerProps {
  steps: PlanStep[]
  title?: string
}

export function Planner({ steps: rawSteps, title = 'Planner' }: PlannerProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => {
      const n = new Set(prev)
      if (n.has(id)) {
        n.delete(id)
      } else {
        n.add(id)
      }
      return n
    })
  }

  const doneCount = rawSteps.filter(s => s.status === 'done').length
  const activeStep = rawSteps.find(s => s.status === 'active')
  const progressText = `${doneCount} / ${rawSteps.length}`

  return (
    <div style={{
      border: '1px solid #222',
      borderRadius: '12px',
      overflow: 'hidden',
      background: 'rgba(10, 10, 10, 0.95)',
      marginBottom: '16px',
      boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        background: 'rgba(20, 20, 20, 0.8)',
        borderBottom: '1px solid #222',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ 
            width: '20px', 
            height: '20px', 
            borderRadius: '50%', 
            background: 'rgba(249, 115, 22, 0.15)', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            border: '1px solid rgba(249, 115, 22, 0.3)'
          }}>
            <span style={{ fontSize: '11px' }}>🎯</span>
          </div>
          <span style={{
            color: '#f97316',
            fontSize: '11px',
            fontWeight: 800,
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            fontFamily: 'monospace',
          }}>
            {title}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            color: '#555',
            fontSize: '10px',
            fontFamily: 'monospace',
            letterSpacing: '1px',
            background: '#111',
            padding: '2px 6px',
            borderRadius: '4px',
            border: '1px solid #1a1a1a'
          }}>
            {progressText}
          </span>
        </div>
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
                  : '2px solid #222',
                background: step.status === 'done' ? '#22c55e' : 'transparent',
                boxShadow: step.status === 'active' ? '0 0 8px rgba(249, 115, 22, 0.4)' : 'none',
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
