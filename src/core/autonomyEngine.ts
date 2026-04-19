import type { TaskSpec } from '../types/orchestrator'
import type { GuardianDecision, GuardianContext, GuardianLogEntry, GuardianTrace } from '../types/autonomy'

// Configuration — tunable, not truth
const ESCALATION_THRESHOLD = 3
const ESCALATION_WINDOW_MS = 10 * 60 * 1000
const HIGH_IMPACT_ACTIONS = new Set(['deploy', 'Delete'])

// Invariant: CI pass does NOT imply runtime safety.
// Guardian MUST evaluate every task regardless of CI status.

// Invariant: All side-effecting operations MUST be downstream of admitTask()
// No agent may perform I/O, writes, or external calls prior to admission.

const hasContract = (task: TaskSpec, contracts: Record<string, { maxScopes: string[] }>): boolean =>
  !!contracts[task.agentId]

const isIdentityValid = (context: GuardianContext): boolean =>
  context.identityValid

const isScopeAuthorized = (
  task: TaskSpec,
  contracts: Record<string, { maxScopes: string[] }>
): boolean => {
  const contract = contracts[task.agentId]
  if (!contract) return false
  return task.requestedScopes.every(scope => contract.maxScopes.includes(scope))
}

const isEscalationTriggered = (
  task: TaskSpec,
  context: GuardianContext
): boolean => {
  const windowStart = Date.now() - ESCALATION_WINDOW_MS
  const recent = context.errors.filter(e =>
    e.agentId === task.agentId &&
    new Date(e.timestamp).getTime() >= windowStart
  )
  return recent.length >= ESCALATION_THRESHOLD
}

const isHighImpactScope = (task: TaskSpec): boolean =>
  task.requestedScopes.some(scope => HIGH_IMPACT_ACTIONS.has(scope))

export class AutonomyEngine {
  evaluate(
    task: TaskSpec,
    context: GuardianContext
  ): GuardianDecision {
    const trace: GuardianTrace = {
      R0: hasContract(task, context.contracts),
      R1: isIdentityValid(context),
      R2: isScopeAuthorized(task, context.contracts),
      R3: isEscalationTriggered(task, context),
      R4: isHighImpactScope(task),
      R5: true
    }

    let triggeredRule: 0 | 1 | 2 | 3 | 4 | 5 = 5
    if (!trace.R0) triggeredRule = 0
    else if (!trace.R1) triggeredRule = 1
    else if (!trace.R2) triggeredRule = 2
    else if (trace.R3) triggeredRule = 3
    else if (trace.R4) triggeredRule = 4

    const action: 'ALLOW' | 'BLOCK' = triggeredRule === 5 ? 'ALLOW' : 'BLOCK'

    return { action, triggeredRule, trace }
  }

  logDecision(entry: GuardianLogEntry): void {
    // Append to: data/decisions/ledger.jsonl
    // Append-only. Never read by Guardian. Side-channel only.
    console.log('[Guardian]', JSON.stringify(entry))
  }
}
