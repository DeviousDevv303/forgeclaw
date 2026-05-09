import { useCallback } from 'react'
import type { 
  FailureEvent, 
  VerifyUnknownResult, 
  DenialFilterContext,
  DenialFilterResult 
} from '../../forgeclaw/orchestrator/integrity_gate'

// ─── Denial Patterns (identical to canonical gate) ─────────────────────────
const DENIAL_PATTERNS = [
  /\bi\s+(?:do\s+not|don['']?t)\s+know\b/i,
  /\bi\s+(?:can\s+not|can['']?t)\s+(?:find|locate)\b/i,
  /\bi\s+(?:do\s+not|don['']?t)\s+have\b/i,
  /\bno\s+record\s+of\b/i,
  /\bwouldn['']?t\s+tell\s+you\b/i,
  /\bi\s+(?:have\s+not|haven['']?t)\s+(?:seen|heard|found|located)\b/i,
  /\bthat['']?s\s+not\s+(?:something|information)\s+i\s+(?:have|know)\b/i,
]

function hasDenialPattern(output: string): boolean {
  return DENIAL_PATTERNS.some((p) => p.test(output))
}

// ─── Browser verify_unknown (localStorage-backed) ──────────────────────────
async function verify_unknown_browser(
  query: string,
  sessionId: string
): Promise<VerifyUnknownResult> {
  const needle = query.toLowerCase().trim()
  if (!needle) return { found: false, source: null, evidence: null }

  // 1. Session history
  const sessionKey = `forgeclaw_session_${sessionId}`
  const sessionData = localStorage.getItem(sessionKey)
  if (sessionData) {
    const lines = sessionData.split('\n').filter((l) => l.trim())
    for (const line of lines) {
      if (line.toLowerCase().includes(needle)) {
        return { found: true, source: `localStorage:${sessionKey}`, evidence: line }
      }
    }
  }

  // 2. Neutral corpus
  const corpus = localStorage.getItem('forgeclaw_neutral_corpus')
  if (corpus) {
    const lines = corpus.split('\n').filter((l) => l.trim())
    for (const line of lines) {
      if (line.toLowerCase().includes(needle)) {
        return { found: true, source: 'localStorage:corpus', evidence: line }
      }
    }
  }

  return { found: false, source: null, evidence: null }
}

// ─── Browser ledger_append (localStorage-backed, append-only) ────────────────
async function ledger_append_browser(event: FailureEvent): Promise<void> {
  const key = 'forgeclaw_integrity_ledger'
  const existing = localStorage.getItem(key) || ''
  const record = JSON.stringify(event) + '\n'
  localStorage.setItem(key, existing + record)
}

// ─── Browser denial_filter (dual-block, identical logic to canonical) ───────
async function denial_filter_browser(
  candidate_output: string,
  context: DenialFilterContext
): Promise<DenialFilterResult> {
  const isDenial = hasDenialPattern(candidate_output)
  const override = context.user_message.includes('#override')

  // 1. Override
  if (override) {
    const event: FailureEvent = {
      timestamp: new Date().toISOString(),
      agent: context.agent,
      event_type: 'USER_OVERRIDE',
      claim: candidate_output,
      actual: null,
      root_cause: 'OVERRIDE_INVOKED',
      override: true,
      session_id: context.session_id,
      turn_id: context.turn_id,
    }
    await ledger_append_browser(event)
    return { allowed: true, violation: event }
  }

  if (!isDenial) return { allowed: true }

  // 2. Block A — no verification
  if (!context.verify_unknown_called) {
    const event: FailureEvent = {
      timestamp: new Date().toISOString(),
      agent: context.agent,
      event_type: 'DENIAL_WITHOUT_VERIFICATION',
      claim: candidate_output,
      actual: null,
      root_cause: 'NO_MEMORY_CHECK',
      override: false,
      session_id: context.session_id,
      turn_id: context.turn_id,
    }
    await ledger_append_browser(event)
    return {
      allowed: false,
      reason: 'Denial without prior verify_unknown call',
      violation: event,
    }
  }

  // 3. Block B — contradiction despite evidence (Criterion 7)
  if (context.verify_unknown_result?.found === true) {
    const event: FailureEvent = {
      timestamp: new Date().toISOString(),
      agent: context.agent,
      event_type: 'VERIFICATION_CONTRADICTION',
      claim: candidate_output,
      actual: context.verify_unknown_result.evidence,
      root_cause: 'KNOWN_DATA_DENIED',
      override: false,
      session_id: context.session_id,
      turn_id: context.turn_id,
    }
    await ledger_append_browser(event)
    return {
      allowed: false,
      reason: 'Denial contradicts verified evidence',
      violation: event,
    }
  }

  return { allowed: true }
}

// ─── Hook Interface ─────────────────────────────────────────────────────────
export interface IntegrityValidationResult {
  allowed: boolean
  violation?: FailureEvent
  reason?: string
}

export function useIntegrityGate() {
  const validateResponse = useCallback(
    async (
      output: string,
      userMessage: string,
      sessionId: string,
      turnId: string,
      agentId: string
    ): Promise<IntegrityValidationResult> => {
      const verifyResult = await verify_unknown_browser(userMessage, sessionId)

      const context: DenialFilterContext = {
        verify_unknown_called: true,
        verify_unknown_result: verifyResult,
        session_id: sessionId,
        turn_id: turnId,
        agent: agentId,
        user_message: userMessage,
      }

      const result = await denial_filter_browser(output, context)

      return {
        allowed: result.allowed,
        violation: result.violation,
        reason: result.reason,
      }
    },
    []
  )

  const appendSession = useCallback((sessionId: string, entry: string) => {
    const key = `forgeclaw_session_${sessionId}`
    const existing = localStorage.getItem(key) || ''
    localStorage.setItem(key, existing + entry + '\n')
  }, [])

  const getLedger = useCallback((): FailureEvent[] => {
    const raw = localStorage.getItem('forgeclaw_integrity_ledger') || ''
    return raw
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as FailureEvent)
  }, [])

  return { validateResponse, appendSession, getLedger }
}