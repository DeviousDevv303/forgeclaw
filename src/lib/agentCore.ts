// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── ForgeClaw Autonomous Core v1.2 (Unified: KimiClaw + Claude + DeviousDevv) ─
// Merged: KimiClaw execution loop / alternate paths / telemetry
//         Claude anti-drift guardrails
//         DeviousDevv system prompt + Guardian Arbitration

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════
export const MAX_AGENT_ITERATIONS = 40
export const SOFT_REVIEW_ITERS = 30
export const AGENT_CONFIDENCE_THRESHOLD = 0.72

const FORGECLAW_SYSTEM_PROMPT = `You are ForgeClaw, an autonomous execution agent embedded in the ForgeClaw shell.

Your purpose is to complete the user's objective through planning, tool use, verification, adaptation, and persistence. You are not a conversational assistant unless the task explicitly requires conversation.

STOPPING CONDITION
Your stopping condition is not "I answered." Your stopping condition is: "The requested objective has been completed and verified, or execution is blocked by a hard external constraint."

CORE OPERATING LOOP

1. INTERPRET
- Determine the actual objective.
- Extract constraints, authority boundaries, success criteria.
- Identify assumptions.

2. PLAN
Before any tool execution, generate a concise execution plan:
- What will be done
- Why this approach was chosen
- What success looks like
- What dependencies exist
Do not overplan. Plans should be operational, not essay-like.

3. EXECUTE
Use available tools aggressively but deliberately. Take concrete action: read files, write files, fetch data, call APIs, spawn sub-agents, use memory. Action is preferred over speculation.

4. VERIFY
After every meaningful action: inspect outputs, confirm expected state change, detect partial failure, validate assumptions. Never assume success.

5. ADAPT
If failure occurs: classify failure, explain root cause, choose a new strategy, retry. Never silently abandon a failed path.

6. ITERATE
Continue until: objective complete, hard block encountered, or explicit user stop.

EXECUTION RULES
- Do not ask unnecessary questions.
- Do not stop early because partial progress was made.
- Do not confuse explanation with execution.
- Do not claim completion without verification.
- Prefer shortest successful path.
- If multiple approaches exist, choose highest expected utility.
- Preserve user intent. Respect safety constraints.
- Use prior memory only when relevant.

CREATIVE TASK EXCEPTION
For creative or exploratory tasks (art, writing, design, storytelling, music, etc.), preserve style, surprise, and user taste. Use the execution loop lightly: understand intent → produce artifact → review against user direction → refine if needed. Do not over-constrain creative work with excessive planning or rigid verification gates.

FAILURE HANDLING
Failure classes: TOOL_FAILURE, AUTH_FAILURE, NETWORK_FAILURE, DEPENDENCY_FAILURE, INVALID_ASSUMPTION, USER_CONSTRAINT, UNKNOWN.
On failure: classify → diagnose → retry with alternative method.

RETRY AUTHORITY
Safe failed actions (NETWORK_FAILURE, transient TOOL_FAILURE) may be retried automatically up to 3 times.
Require user approval before retrying actions that are: destructive, irreversible, externally visible, costly, or security-sensitive.
Never retry AUTH_FAILURE automatically — always require new credentials.

RESPONSE FORMAT
Always structure responses as:

OBJECTIVE: [what the user wants]
CONSTRAINTS: [limitations, boundaries]
PLAN: [step-by-step approach]
EXECUTION: [what was done / what tool calls are being made]
VERIFICATION: [results checked, assumptions validated]
STATUS: [IN_PROGRESS | BLOCKED | COMPLETE]
NEXT_ACTION: [what happens now]

ANTI-CHAT RULE
Default mode is execution. Do not produce long conversational prose unless the task explicitly requests explanation.

MEASURE OF SUCCESS
Good: User says "build and deploy a site" → ForgeClaw plans, creates files, runs tools, debugs, deploys, verifies URL loads.
Bad: ForgeClaw explains how deployment works and stops.`

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE / STATUS TYPES
// ═══════════════════════════════════════════════════════════════════════════════
export type AgentPhase =
  | 'INTERPRET'
  | 'PLAN'
  | 'EXECUTE'
  | 'VERIFY'
  | 'ADAPT'
  | 'COMPLETE'
  | 'BLOCKED'

// ═══════════════════════════════════════════════════════════════════════════════
// FAILURE CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════════════════
export type ToolFailureClass =
  | 'TOOL_FAILURE'
  | 'AUTH_FAILURE'
  | 'NETWORK_FAILURE'
  | 'DEPENDENCY_FAILURE'
  | 'INVALID_ASSUMPTION'
  | 'USER_CONSTRAINT'
  | 'UNKNOWN'

export function classifyFailure(error: string): ToolFailureClass {
  const e = error.toLowerCase()
  if (e.includes('401') || e.includes('403') || e.includes('auth') || e.includes('unauthorized') || e.includes('key') || e.includes('token')) return 'AUTH_FAILURE'
  if (e.includes('404') || e.includes('not found') || e.includes('enoent') || e.includes('module')) return 'DEPENDENCY_FAILURE'
  if (e.includes('network') || e.includes('fetch') || e.includes('timeout') || e.includes('econnrefused') || e.includes('etimedout')) return 'NETWORK_FAILURE'
  if (e.includes('invalid') || e.includes('bad request') || e.includes('assumption') || e.includes('schema') || e.includes('validation')) return 'INVALID_ASSUMPTION'
  if (e.includes('user') || e.includes('permission') || e.includes('blocked') || e.includes('forbidden')) return 'USER_CONSTRAINT'
  if (e.includes('tool') || e.includes('execution') || e.includes('failed') || e.includes('error') || e.includes('exception')) return 'TOOL_FAILURE'
  return 'UNKNOWN'
}

// KimiClaw regex-based alternative (used by telemetry for richer classification)
export function classifyToolFailure(errorMsg: string): ToolFailureClass {
  if (/401|403|unauthorized|forbidden|api.?key|invalid.{0,20}key/i.test(errorMsg)) return 'AUTH_FAILURE'
  if (/failed to fetch|network|timeout|econnrefused|enotfound|net::err/i.test(errorMsg)) return 'NETWORK_FAILURE'
  if (/not found|missing|no such|dependency|module|package/i.test(errorMsg)) return 'DEPENDENCY_FAILURE'
  if (/tool error|invalid input|bad request|malformed/i.test(errorMsg)) return 'TOOL_FAILURE'
  if (/assumption|expected.*but got|unexpected.*result/i.test(errorMsg)) return 'INVALID_ASSUMPTION'
  if (/permission denied|access denied|not allowed/i.test(errorMsg)) return 'USER_CONSTRAINT'
  return 'UNKNOWN'
}

// ═══════════════════════════════════════════════════════════════════════════════
// DESTRUCTIVE TOOL CLASSIFICATION (Guardian Gate)
// ═══════════════════════════════════════════════════════════════════════════════

const DESTRUCTIVE_NAMES = new Set([
  'github_write_file',
  'github_run_workflow',
  'shell_exec',
  'gmail_send',
  'calendar_create',
  'send_whatsapp',
  'memory_write',
])

export function isDestructiveTool(toolName: string, input?: Record<string, unknown>): boolean {
  if (DESTRUCTIVE_NAMES.has(toolName)) return true

  if (toolName === 'run_js') {
    const code = (input?.code as string) || ''
    return /fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|eval\(|Function\(|document\.write|location\.|window\.open/i.test(code)
  }

  if (toolName === 'http_fetch') {
    const method = ((input?.method as string) || 'GET').toUpperCase()
    return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
  }

  return false
}

export const DESTRUCTIVE_TOOL_DESCRIPTIONS: Record<string, string> = {
  github_write_file: 'modifies repository files',
  github_run_workflow: 'triggers CI/CD pipelines',
  shell_exec: 'executes arbitrary shell commands',
  gmail_send: 'sends emails',
  calendar_create: 'creates calendar events',
  send_whatsapp: 'sends messages',
  memory_write: 'modifies persistent state',
}

export function getDestructiveReason(toolName: string): string {
  return DESTRUCTIVE_TOOL_DESCRIPTIONS[toolName] || 'modifies state or executes commands'
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISCARDED PATHS (Telemetry — alternate paths for Cognitive Archive)
// ═══════════════════════════════════════════════════════════════════════════════
export type DiscardedPath = {
  label: string
  probability: number
}

export function getDiscardedPaths(
  failureClass: ToolFailureClass,
  toolName: string,
): DiscardedPath[] {
  const t = toolName.replace(/_/g, '-')
  switch (failureClass) {
    case 'NETWORK_FAILURE':
      return [
        { label: `${t}/static-fallback`, probability: 12.7 },
        { label: `${t}/alternate-endpoint`, probability: 8.3 },
        { label: `${t}/cached-response`, probability: 5.1 },
        { label: 'wait/retry-backoff', probability: 2.4 },
      ]
    case 'DEPENDENCY_FAILURE':
      return [
        { label: 'install/direct', probability: 14.2 },
        { label: 'simplify/execution', probability: 9.1 },
        { label: 'pin/older-version', probability: 6.3 },
        { label: 'skip/optional-dep', probability: 3.8 },
      ]
    case 'TOOL_FAILURE':
      return [
        { label: `${t}/adjusted-params`, probability: 11.4 },
        { label: `${t}/simplified-input`, probability: 7.6 },
        { label: 'alternate/tool-call', probability: 5.2 },
        { label: 'manual/override', probability: 2.9 },
      ]
    case 'INVALID_ASSUMPTION':
      return [
        { label: 're-read/source-of-truth', probability: 16.3 },
        { label: 'revise/assumption-model', probability: 9.7 },
        { label: 'fallback/heuristic', probability: 4.1 },
      ]
    case 'AUTH_FAILURE':
      return [
        { label: 'refresh/token', probability: 18.5 },
        { label: 'use/alternate-credential', probability: 7.2 },
        { label: 'elevate/scope', probability: 3.3 },
      ]
    case 'USER_CONSTRAINT':
      return [
        { label: 'request/permission', probability: 21.0 },
        { label: 'find/alternate-path', probability: 5.8 },
      ]
    default:
      return [
        { label: 'manual/intervention', probability: 8.1 },
        { label: 'alternate/approach', probability: 4.5 },
        { label: 'defer/to-user', probability: 2.1 },
      ]
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RETRY DECISION ENGINE (Phase 5)
// ═══════════════════════════════════════════════════════════════════════════════
export interface RetryDecision {
  shouldRetry: boolean
  reason: string
  alternativeStrategy?: string
  requiresUserApproval?: boolean
}

export function decideRetry(
  failureClass: ToolFailureClass,
  attemptCount: number,
  isDestructiveAction: boolean,
): RetryDecision {
  // Destructive actions never auto-retry
  if (isDestructiveAction) {
    return {
      shouldRetry: false,
      reason: 'Destructive action requires user approval before retry.',
      requiresUserApproval: true,
    }
  }

  // Hard limit reached
  if (attemptCount >= 3) {
    return {
      shouldRetry: false,
      reason: `Retry limit reached after ${attemptCount} attempts. Escalating to BLOCKED.`,
      requiresUserApproval: true,
    }
  }

  switch (failureClass) {
    case 'NETWORK_FAILURE':
      return {
        shouldRetry: true,
        reason: `Network failure may be transient (attempt ${attemptCount}/3).`,
        alternativeStrategy: 'Retry with increased timeout, alternate endpoint, or cached result if available.',
      }

    case 'DEPENDENCY_FAILURE':
      return {
        shouldRetry: true,
        reason: `Dependency failure may be repairable (attempt ${attemptCount}/3).`,
        alternativeStrategy: 'Install missing dependency, use fallback package, or simplify execution path.',
      }

    case 'TOOL_FAILURE':
      return {
        shouldRetry: true,
        reason: `Tool execution failed (attempt ${attemptCount}/3).`,
        alternativeStrategy: 'Change parameters, simplify input, or use another available tool.',
      }

    case 'INVALID_ASSUMPTION':
      return {
        shouldRetry: true,
        reason: `Invalid assumption detected (attempt ${attemptCount}/3).`,
        alternativeStrategy: 'Re-examine inputs, validate schema, or gather more context before retry.',
      }

    case 'AUTH_FAILURE':
      return {
        shouldRetry: false,
        reason: 'Authentication failure requires new credentials or elevated permission.',
        requiresUserApproval: true,
      }

    case 'USER_CONSTRAINT':
      return {
        shouldRetry: false,
        reason: 'Blocked by user-defined constraint or permission boundary.',
        requiresUserApproval: true,
      }

    case 'UNKNOWN':
    default:
      return {
        shouldRetry: false,
        reason: `Unknown failure on attempt ${attemptCount}/3. Requires diagnosis before retry.`,
        requiresUserApproval: true,
      }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTENT EXTRACTORS
// ═══════════════════════════════════════════════════════════════════════════════
export function extractPlan(content: string): string | null {
  const match = content.match(/PLAN:\s*([\s\S]*?)(?=\n[A-Z_ ]+:|$)/i)
  return match ? match[1].trim() : null
}

export function extractStatus(content: string): AgentPhase | null {
  const match = content.match(/STATUS:\s*(\w+)/i)
  if (!match) return null
  const status = match[1].toUpperCase()
  const valid: AgentPhase[] = ['INTERPRET', 'PLAN', 'EXECUTE', 'VERIFY', 'ADAPT', 'COMPLETE', 'BLOCKED']
  return valid.includes(status as AgentPhase) ? (status as AgentPhase) : null
}

export function extractObjective(content: string): string | null {
  const match = content.match(/OBJECTIVE:\s*([\s\S]*?)(?=\n[A-Z_ ]+:|$)/i)
  return match ? match[1].trim() : null
}

export function extractNextAction(content: string): string | null {
  const match = content.match(/NEXT_ACTION:\s*([\s\S]*?)(?=\n[A-Z_ ]+:|$)/i)
  return match ? match[1].trim() : null
}

// ═══════════════════════════════════════════════════════════════════════════════
// GUARDIAN ARBITRATION LAYER (Phase 6+)
// ═══════════════════════════════════════════════════════════════════════════════
export interface GuardianCheck {
  intent: string
  riskScore: number
  confidence: number
  requiredScopes: string[]
  estimatedCost: number
}

export interface ActionBudgets {
  maxWritesPerTask: number
  maxExternalCalls: number
  maxRetries: number
  destructiveActionGuard: boolean
}

export const DEFAULT_BUDGETS: ActionBudgets = {
  maxWritesPerTask: 20,
  maxExternalCalls: 50,
  maxRetries: 3,
  destructiveActionGuard: true,
}

export function requiresGuardianApproval(
  check: GuardianCheck,
  _budgets: ActionBudgets = DEFAULT_BUDGETS,
  threshold: number = AGENT_CONFIDENCE_THRESHOLD,
): { approved: boolean; reason?: string } {
  if (check.confidence < threshold) {
    return {
      approved: false,
      reason: `Confidence ${(check.confidence * 100).toFixed(0)}% below threshold ${(threshold * 100).toFixed(0)}%. Requires verification.`,
    }
  }
  if (check.riskScore > 0.7) {
    return {
      approved: false,
      reason: `Risk score ${(check.riskScore * 100).toFixed(0)}% exceeds 70%. Requires co-sign approval.`,
    }
  }
  return { approved: true }
}

export { FORGECLAW_SYSTEM_PROMPT }
