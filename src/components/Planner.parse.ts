// ForgeClaw - Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

export interface PlanStep {
  id: string
  title: string
  status: 'pending' | 'active' | 'done'
  description?: string
}

const numberedStepPattern = /^(?:Step\s*)?(\d+)[.:)-]\s*(.+)$/i
const bulletStepPattern = /^(?:[-*+]|\u2022)\s*(.+)$/

export function parsePlanText(planText: string): PlanStep[] {
  const lines = planText.split('\n').filter(l => l.trim())
  const steps: PlanStep[] = []
  let idx = 0

  for (const line of lines) {
    const trimmed = line.trim()
    const numMatch = trimmed.match(numberedStepPattern)
    if (numMatch) {
      steps.push({
        id: `plan-step-${idx}`,
        title: numMatch[2].trim(),
        status: 'pending',
      })
      idx++
      continue
    }

    const bulletMatch = trimmed.match(bulletStepPattern)
    if (bulletMatch) {
      steps.push({
        id: `plan-step-${idx}`,
        title: bulletMatch[1].trim(),
        status: 'pending',
      })
      idx++
      continue
    }

    if (steps.length > 0 && !numberedStepPattern.test(trimmed) && !bulletStepPattern.test(trimmed)) {
      const last = steps[steps.length - 1]
      last.description = last.description ? `${last.description}\n${trimmed}` : trimmed
    }
  }

  if (steps.length === 0) {
    return lines.map((line, i) => ({
      id: `plan-step-${i}`,
      title: line.trim(),
      status: 'pending',
    }))
  }

  return steps
}
