// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Agent Attribution Contract ──────────────────────────────────────────────
// Every repository operation performed through ForgeClaw must be attributable.
// This module is the single source of truth for that attribution so the
// requirement is enforced in code instead of remembered by an operator.

import type { ToolDef } from './forgeTools'

/** The ForgeClaw-side coding agent identity that performs repository work. */
export const FORGECLAW_AGENT_ID = 'forgesmith-coding'
export const FORGECLAW_AGENT_LABEL = 'ForgeClaw Coding Specialist'

/**
 * The orchestrating agent. Repository operations run by this agent surface are
 * attributed to MANUS in the commit record, per the operator contract.
 */
export const FORGECLAW_ORCHESTRATOR_ID = 'MANUS'

/** Attribution trailer appended to every agent-authored commit message. */
export const MANUS_ATTRIBUTION_TRAILER =
  'Agent: MANUS (autonomous orchestrator) via ForgeClaw — operation attributed per operator contract.'

export interface AttributionInput {
  /** ForgeClaw agent identity, e.g. forgesmith-coding. */
  agentId: string
  /** Human-readable agent label recorded alongside the id. */
  agentLabel: string
  /** The assigned objective, so the commit states why the change exists. */
  task?: string
  /** Verification performed before the commit (build, lint, test, or manual read). */
  verification?: string
  /** Terse description of what changed. Falls back to the task when absent. */
  what?: string
  /** Optional explicit reason. Defaults to the assigned task. */
  why?: string
  /** Target branch, recorded for traceability. */
  branch?: string
  /** Known HEAD before the change, recorded for traceability. */
  headSha?: string
}

function singleLine(value: string, max = 300): string {
  const collapsed = value.replace(/\s+/g, ' ').trim()
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed
}

/**
 * Build a commit message that states the acting agent, what changed, and why.
 * Rejects attribution that would identify the wrong agent.
 */
export function buildAttributedCommitMessage(input: AttributionInput): string {
  const agentId = (input.agentId || '').trim()
  const agentLabel = (input.agentLabel || '').trim()
  if (!agentId || !agentLabel) {
    throw new Error('Attribution requires a non-empty agentId and agentLabel.')
  }

  const what = singleLine(input.what || input.task || 'autonomous repository change')
  const why = singleLine(input.why || input.task || 'Requested by the operator for the assigned ForgeClaw coding task.')

  const lines = [
    `agent: ${FORGECLAW_ORCHESTRATOR_ID} — what: ${what}`,
    '',
    `WHY: ${why}`,
    `AGENT: ${FORGECLAW_ORCHESTRATOR_ID} (orchestrator) / ${agentId} (${agentLabel})`,
  ]

  if (input.headSha) lines.push(`BASE: ${singleLine(input.headSha, 64)}`)
  if (input.branch) lines.push(`BRANCH: ${singleLine(input.branch, 128)}`)
  lines.push(`VALIDATION: ${singleLine(input.verification || 'Tool-level verification performed (result returned to NEXUS).')}`)
  lines.push(MANUS_ATTRIBUTION_TRAILER)

  return lines.join('\n')
}

/**
 * Append the attribution requirement to the tool descriptions handed to the
 * model, so both native tool calling and manual tool mode see it.
 */
export function applyAttributionContract(tools: ToolDef[]): ToolDef[] {
  return tools.map(tool => {
    if (tool.name !== 'github_write_file') return tool
    return {
      ...tool,
      description:
        `${tool.description} Commits are agent-attributed automatically: the dispatcher prefixes ` +
        `"agent: ${FORGECLAW_ORCHESTRATOR_ID} — what: …" and records the acting agent (${FORGECLAW_AGENT_ID}) plus what changed and why. ` +
        `Never pass a generic placeholder message such as "fix" or "update".`,
    }
  })
}

/** True when a commit message satisfies the no-silent / no-generic commit rule. */
export function isAttributedCommitMessage(message: string): boolean {
  const lower = message.toLowerCase()
  if (lower.includes(`agent: ${FORGECLAW_ORCHESTRATOR_ID.toLowerCase()}`)) return true
  return /agent:\s*[a-z0-9._-]{2,}/i.test(message) && /why:/i.test(message)
}

/** Messages that are explicitly forbidden by the operator contract. */
export function isGenericCommitMessage(message: string): boolean {
  const subject = message.split('\n')[0].trim().toLowerCase()
  return ['fix', 'update', 'changes', 'change', 'wip', 'misc', 'patch', 'edit'].includes(subject)
}