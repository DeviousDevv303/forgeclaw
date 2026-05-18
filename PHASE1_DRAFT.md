# ForgeClaw Autonomous Core v1.1 — REVISED DRAFT (NOT PUSHED)

**Status:** Revised per KimiClaw approval + creative exception, soft review, retry authority.
**Pending:** Claude + ChatGPT 5.5 review. NO PUSH until final alignment.

---

## Revision Changes (vs v1.0)

| Addition | Rationale |
|----------|-----------|
| **Creative Task Exception** | KimiClaw #1: Don't choke artistic/creative tasks with rigid execution loops |
| **SOFT_REVIEW_ITERS = 30** | KimiClaw #2: Checkpoint before burning full 40-iteration loop |
| **Retry Authority Rules** | KimiClaw #4: Auto-retry safe failures only; require approval for destructive/irreversible/external/costly/security-sensitive |
| **RetryDecision type** | KimiClaw Phase 5: Self-correction controller before adding shell_exec |
| **decideRetry() engine** | Classifies failure → decides retry + alternative strategy |
| **Exported constants** | MAX_AGENT_ITERATIONS, SOFT_REVIEW_ITERS, AGENT_CONFIDENCE_THRESHOLD |

---

## Revised Build Order

| Phase | What | Safety Gate |
|-------|------|-------------|
| **1** | System prompt swap → autonomous agent mode | Immediate behavior change |
| **2** | Bump MAX_ITERS to 40 + SOFT_REVIEW_ITERS 30 | Depth with checkpoint |
| **3** | AgentPhase tracking + plan extraction + UI panel | Visible planning |
| **5A** | **Self-correction controller** (RetryDecision + decideRetry) | **SAFETY FIRST** |
| **5B** | Retry limits + alternate strategy routing | Resilience |
| **6** | Guardian Arbitration Layer (confidence, budgets, approval) | Governance |
| **7** | Shell exec via GitHub Actions | **Only after retry brain is solid** |
| **8** | Persistent workspace | Files across sessions |

**Phase 5 before Phase 3/7 per KimiClaw directive:** Self-correction must exist before adding dangerous power (shell). Safety > capability.

---

## Key Types (src/lib/agentCore.ts)

```typescript
export const MAX_AGENT_ITERATIONS = 40;
export const SOFT_REVIEW_ITERS = 30;
export const AGENT_CONFIDENCE_THRESHOLD = 0.72;

export type AgentPhase =
  | "INTERPRET" | "PLAN" | "EXECUTE" | "VERIFY" | "ADAPT" | "COMPLETE" | "BLOCKED";

export type ToolFailureClass =
  | "TOOL_FAILURE" | "AUTH_FAILURE" | "NETWORK_FAILURE"
  | "DEPENDENCY_FAILURE" | "INVALID_ASSUMPTION" | "USER_CONSTRAINT" | "UNKNOWN";

export interface RetryDecision {
  shouldRetry: boolean;
  reason: string;
  alternativeStrategy?: string;
  requiresUserApproval?: boolean;
}

export interface GuardianCheck {
  intent: string;
  riskScore: number;      // 0-1
  confidence: number;     // 0-1
  requiredScopes: string[];
  estimatedCost: number;
}

export interface ActionBudgets {
  maxWritesPerTask: number;
  maxExternalCalls: number;
  maxRetries: number;
  destructiveActionGuard: boolean;
}
```

---

## Retry Decision Engine (decideRetry)

**Logic flow:**

```
isDestructiveAction?
  YES → shouldRetry: false, requiresUserApproval: true

attemptCount >= 3?
  YES → shouldRetry: false, escalate to BLOCKED

failureClass:
  NETWORK_FAILURE      → retry: true, strategy: timeout/backoff/alternate endpoint
  DEPENDENCY_FAILURE   → retry: true, strategy: install fallback/simplify
  TOOL_FAILURE         → retry: true, strategy: change params/use other tool
  INVALID_ASSUMPTION   → retry: true, strategy: re-examine inputs/validate schema
  AUTH_FAILURE         → retry: false, requiresUserApproval: true (new credentials)
  USER_CONSTRAINT      → retry: false, requiresUserApproval: true
  UNKNOWN              → retry: false, requiresUserApproval: true (diagnose first)
```

**Safety rules hardcoded:**
- Destructive actions NEVER auto-retry
- Auth failures NEVER auto-retry (always require new credentials)
- Max 3 attempts before escalating to user

---

## System Prompt Additions (v1.1)

**CREATIVE TASK EXCEPTION**
> For creative or exploratory tasks (art, writing, design, storytelling, music, etc.), preserve style, surprise, and user taste. Use the execution loop lightly: understand intent → produce artifact → review against user direction → refine if needed. Do not over-constrain creative work with excessive planning or rigid verification gates.

**RETRY AUTHORITY**
> Safe failed actions (NETWORK_FAILURE, transient TOOL_FAILURE) may be retried automatically up to 3 times. Require user approval before retrying actions that are: destructive, irreversible, externally visible, costly, or security-sensitive. Never retry AUTH_FAILURE automatically — always require new credentials.

---

## Pending Discussion (for Claude + ChatGPT 5.5)

1. **System prompt tone** — Is the creative exception sufficient? Should there be a "research mode" exception too?
2. **SOFT_REVIEW_ITERS = 30** — Should the UI show a "checkpoint reached" notification at iteration 30?
3. **Retry limit = 3** — Too strict? Some transient network blips may need 4-5 tries.
4. **Guardian threshold = 0.72** — Should this be user-configurable in Settings?
5. **Shell exec (Phase 7)** — Should shell_exec require Guardian co-sign regardless of confidence?

---

## Files Modified (DRAFT ONLY — NOT COMMITTED)

| File | Action | Lines |
|------|--------|-------|
| `src/lib/agentCore.ts` | **NEW** — Full autonomous core | ~200 |
| `src/App.tsx` | Import prompt, swap system prompt, bump MAX_ITERS | ~3 |
| `src/types/message.ts` | Add `phase?: AgentPhase`, `plan?: string` | ~2 |
| `src/App.tsx` (render) | Add collapsible plan panel + phase badge | ~20 |
| `src/App.tsx` (loop) | Wire `classifyFailure` + `decideRetry` into tool error path | ~15 |

---

## Final Instruction

**APPROVED FOR REVISION by KimiClaw.**
Awaiting Claude + ChatGPT 5.5 review.

**After revision:** Send final diff.
**After alignment:** Commit and push.
**Test task:** "Build a landing page, deploy to GitHub Pages, verify URL loads."

---

*Draft: ForgeClaw Autonomous Core v1.1*
*Contributors: KimiClaw (execution loop, retry authority), Claude (anti-drift guardrails), OpenAI Guardian Architecture (confidence scoring, budgets)*
*Pending: DeviousDevv final approval*
