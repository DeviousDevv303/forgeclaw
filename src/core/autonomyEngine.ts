// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
import type { TaskSpec } from '../types/orchestrator'
import type { GuardianDecision, GuardianContext, GuardianLogEntry, GuardianTrace } from '../types/autonomy'

// Configuration — tunable, not truth
const ESCALATION_THRESHOLD = 3
const ESCALATION_WINDOW_MS = 10 * 60 * 1000
// Scopes use the namespaced AuthorityScope vocabulary (see types/orchestrator.ts).
// The legacy bare names are kept so older task specs still match.
const HIGH_IMPACT_ACTIONS = new Set<string>(['github:write', 'github:dispatch', 'deploy', 'delete'])

export const GUARDIAN_LEDGER_KEY = 'forgeclaw_guardian_ledger'
export const GUARDIAN_LEDGER_MAX = 500

type LedgerStorage = Pick<Storage, 'getItem' | 'setItem'>

function defaultLedgerStorage(): LedgerStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** Read the persisted Guardian decision ledger (oldest first). Corrupt data reads as empty. */
export function readGuardianLedger(storage: LedgerStorage | null = defaultLedgerStorage()): GuardianLogEntry[] {
  try {
    const parsed = JSON.parse(storage?.getItem(GUARDIAN_LEDGER_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed as GuardianLogEntry[] : []
  } catch {
    return []
  }
}

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

  /**
   * Record a Guardian decision. Append-only, bounded to GUARDIAN_LEDGER_MAX entries,
   * and never read by Guardian evaluation. Persistence failure is reported with
   * console.error rather than swallowed, so a missing audit trail is visible.
   */
  logDecision(entry: GuardianLogEntry, storage: LedgerStorage | null = defaultLedgerStorage()): void {
    console.log('[Guardian]', JSON.stringify(entry))
    if (!storage) {
      console.error('[Guardian] ledger not persisted: no storage available', entry.taskId)
      return
    }
    try {
      const ledger = readGuardianLedger(storage)
      ledger.push(entry)
      storage.setItem(GUARDIAN_LEDGER_KEY, JSON.stringify(ledger.slice(-GUARDIAN_LEDGER_MAX)))
    } catch (error) {
      console.error('[Guardian] ledger not persisted:', error instanceof Error ? error.message : String(error), entry.taskId)
    }
  }
}
