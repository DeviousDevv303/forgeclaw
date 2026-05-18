// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── ForgeClaw Autonomous Core v1.1 (DRAFT — NOT PUSHED) ─────────────────────
// KimiClaw execution loop + Claude anti-drift guardrails + OpenAI Guardian Architecture
// REVISED per hybrid approval: creative exception, soft review, retry authority.

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════
export const MAX_AGENT_ITERATIONS = 40;
export const SOFT_REVIEW_ITERS = 30;
export const AGENT_CONFIDENCE_THRESHOLD = 0.72;

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
Bad: ForgeClaw explains how deployment works and stops.`;

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE / STATUS TYPES
// ═══════════════════════════════════════════════════════════════════════════════
export type AgentPhase =
  | "INTERPRET"
  | "PLAN"
  | "EXECUTE"
  | "VERIFY"
  | "ADAPT"
  | "COMPLETE"
  | "BLOCKED";

// ═══════════════════════════════════════════════════════════════════════════════
// FAILURE CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════════════════
export type ToolFailureClass =
  | "TOOL_FAILURE"
  | "AUTH_FAILURE"
  | "NETWORK_FAILURE"
  | "DEPENDENCY_FAILURE"
  | "INVALID_ASSUMPTION"
  | "USER_CONSTRAINT"
  | "UNKNOWN";

export function classifyFailure(error: string): ToolFailureClass {
  const e = error.toLowerCase();
  if (e.includes('401') || e.includes('403') || e.includes('auth') || e.includes('unauthorized') || e.includes('key') || e.includes('token')) return "AUTH_FAILURE";
  if (e.includes('404') || e.includes('not found') || e.includes('enoent') || e.includes('module')) return "DEPENDENCY_FAILURE";
  if (e.includes('network') || e.includes('fetch') || e.includes('timeout') || e.includes('econnrefused') || e.includes('etimedout')) return "NETWORK_FAILURE";
  if (e.includes('invalid') || e.includes('bad request') || e.includes('assumption') || e.includes('schema') || e.includes('validation')) return "INVALID_ASSUMPTION";
  if (e.includes('user') || e.includes('permission') || e.includes('blocked') || e.includes('forbidden')) return "USER_CONSTRAINT";
  if (e.includes('tool') || e.includes('execution') || e.includes('failed') || e.includes('error') || e.includes('exception')) return "TOOL_FAILURE";
  return "UNKNOWN";
}

// ═══════════════════════════════════════════════════════════════════════════════
// DESTRUCTIVE TOOL CLASSIFICATION (Guardian Gate)
// ═══════════════════════════════════════════════════════════════════════════════

export function isDestructiveTool(toolName: string, input?: Record<string, unknown>): boolean {
  // Tools that modify external state, send data, or execute arbitrary code
  const destructiveNames = new Set([
    'github_write_file',
    'github_run_workflow',
    'shell_exec',
    'gmail_send',
    'calendar_create',
    'send_whatsapp',
    'memory_write', // State mutation
  ])

  if (destructiveNames.has(toolName)) return true

  // Specific input patterns that make safe tools destructive
  if (toolName === 'run_js') {
    const code = (input?.code as string) || ''
    // Destructive if it attempts network, storage, or eval
    const dangerous = /fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|eval\(|Function\(|document\.write|location\.|window\.open/i
    return dangerous.test(code)
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
export interface RetryDecision {
  shouldRetry: boolean;
  reason: string;
  alternativeStrategy?: string;
  requiresUserApproval?: boolean;
}

export function decideRetry(
  failureClass: ToolFailureClass,
  attemptCount: number,
  isDestructiveAction: boolean
): RetryDecision {
  // Destructive actions never auto-retry
  if (isDestructiveAction) {
    return {
      shouldRetry: false,
      reason: "Destructive action requires user approval before retry.",
      requiresUserApproval: true,
    };
  }

  // Hard limit reached
  if (attemptCount >= 3) {
    return {
      shouldRetry: false,
      reason: "Retry limit reached (3 attempts). Escalating to BLOCKED.",
      requiresUserApproval: true,
    };
  }

  switch (failureClass) {
    case "NETWORK_FAILURE":
      return {
        shouldRetry: true,
        reason: `Network failure may be transient (attempt ${attemptCount}/3).`,
        alternativeStrategy: "Retry with increased timeout, alternate endpoint, or cached result if available.",
      };

    case "DEPENDENCY_FAILURE":
      return {
        shouldRetry: true,
        reason: `Dependency failure may be repairable (attempt ${attemptCount}/3).`,
        alternativeStrategy: "Install missing dependency, use fallback package, or simplify execution path.",
      };

    case "TOOL_FAILURE":
      return {
        shouldRetry: true,
        reason: `Tool execution failed (attempt ${attemptCount}/3).`,
        alternativeStrategy: "Change parameters, simplify input, or use another available tool.",
      };

    case "INVALID_ASSUMPTION":
      return {
        shouldRetry: true,
        reason: `Invalid assumption detected (attempt ${attemptCount}/3).`,
        alternativeStrategy: "Re-examine inputs, validate schema, or gather more context before retry.",
      };

    case "AUTH_FAILURE":
      return {
        shouldRetry: false,
        reason: "Authentication failure requires new credentials or elevated permission.",
        requiresUserApproval: true,
      };

    case "USER_CONSTRAINT":
      return {
        shouldRetry: false,
        reason: "Blocked by user-defined constraint or permission boundary.",
        requiresUserApproval: true,
      };

    case "UNKNOWN":
    default:
      return {
        shouldRetry: false,
        reason: `Unknown failure on attempt ${attemptCount}/3. Requires diagnosis before retry.`,
        requiresUserApproval: true,
      };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTENT EXTRACTORS
// ═══════════════════════════════════════════════════════════════════════════════
export function extractPlan(content: string): string | null {
  const match = content.match(/PLAN:\s*([\s\S]*?)(?=\n[A-Z_ ]+:|$)/i);
  return match ? match[1].trim() : null;
}

export function extractStatus(content: string): AgentPhase | null {
  const match = content.match(/STATUS:\s*(\w+)/i);
  if (!match) return null;
  const status = match[1].toUpperCase();
  const valid: AgentPhase[] = ["INTERPRET", "PLAN", "EXECUTE", "VERIFY", "ADAPT", "COMPLETE", "BLOCKED"];
  return valid.includes(status as AgentPhase) ? (status as AgentPhase) : null;
}

export function extractObjective(content: string): string | null {
  const match = content.match(/OBJECTIVE:\s*([\s\S]*?)(?=\n[A-Z_ ]+:|$)/i);
  return match ? match[1].trim() : null;
}

export function extractNextAction(content: string): string | null {
  const match = content.match(/NEXT_ACTION:\s*([\s\S]*?)(?=\n[A-Z_ ]+:|$)/i);
  return match ? match[1].trim() : null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GUARDIAN ARBITRATION LAYER (Phase 6+)
// ═══════════════════════════════════════════════════════════════════════════════
export interface GuardianCheck {
  intent: string;
  riskScore: number; // 0-1
  confidence: number;  // 0-1
  requiredScopes: string[];
  estimatedCost: number;
}

export interface ActionBudgets {
  maxWritesPerTask: number;
  maxExternalCalls: number;
  maxRetries: number;
  destructiveActionGuard: boolean;
}

export const DEFAULT_BUDGETS: ActionBudgets = {
  maxWritesPerTask: 20,
  maxExternalCalls: 50,
  maxRetries: 3,
  destructiveActionGuard: true,
};

export function requiresGuardianApproval(
  check: GuardianCheck,
  _budgets: ActionBudgets = DEFAULT_BUDGETS,
  threshold: number = AGENT_CONFIDENCE_THRESHOLD
): { approved: boolean; reason?: string } {
  if (check.confidence < threshold) {
    return {
      approved: false,
      reason: `Confidence ${(check.confidence * 100).toFixed(0)}% below threshold ${(threshold * 100).toFixed(0)}%. Requires verification.`,
    };
  }
  if (check.riskScore > 0.7) {
    return {
      approved: false,
      reason: `Risk score ${(check.riskScore * 100).toFixed(0)}% exceeds 70%. Requires co-sign approval.`,
    };
  }
  return { approved: true };
}

export {
  FORGECLAW_SYSTEM_PROMPT,
};