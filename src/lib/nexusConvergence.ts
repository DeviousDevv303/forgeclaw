// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── NEXUS convergence: the loop closes by itself ────────────────────────────────────────────────
// NEXUS learns on the owner's five-phase scaffolding (Assumptions → Heuristics → First Principles → Extension →
// Convergence; the owner keeps the full framework private). The last phase is where the loop closes. Until 2026-10-21 it closed only
// by hand: a record became knowledge solely through a signed admission that no key in the app could sign, so approved
// knowledge stayed at zero, browser playbooks never reached a prompt, and DeepSeek's "approved knowledge" was always
// empty. The owner asked for NEXUS to learn without manual approval. What converges, with no one approving it:
//   • First Principles: the owner's own task answered with evidence (a final answer that passed ForgeClaw's evidence
//     gate with at least one successful tool result, recorded as outcome "verified");
//   • Extension: a browsing playbook whose steps all worked (steps only, never typed text);
//   • Heuristics: the owner's own rules, mined from what the owner typed (nexusHeuristics.ts);
//   • Assumptions: recurring failures, which already reach prompts as lessons without approval.
// Never: visitors' input, failed or blocked runs, model answers with no evidence behind them. Converged records are
// marked (admittedBy) so they inform guidance and count as training data, but are never served verbatim as an answer.

import type { CorpusInteractionInput } from './corpus'

export type NexusPhase = 'assumptions' | 'heuristics' | 'first_principles' | 'extension' | 'convergence'
export const NEXUS_PHASES: ReadonlyArray<{ phase: NexusPhase; label: string; icon: string }> = [
  { phase: 'assumptions', label: 'Assumptions', icon: '◈' },
  { phase: 'heuristics', label: 'Heuristics', icon: '⟳' },
  { phase: 'first_principles', label: 'First Principles', icon: '∴' },
  { phase: 'extension', label: 'Extension', icon: '⤳' },
  { phase: 'convergence', label: 'Convergence', icon: '⊕' },
]

/** Marks knowledge admitted by the convergence rule rather than a signed admission. */
export const CONVERGED_BY = 'nexus-convergence'

/**
 * Marks knowledge auto-admitted from Stage 3b external intake under the owner's criteria
 * (Cristian, 2026-10-24): a fallacy-audit record whose loop closed — a confirmed finding or a
 * suspect verified cleared, with its run_id and ref — is verified knowledge, because the lanes
 * tag-teamed and resolved it before the audit lane filed it. Canary records never carry this
 * marker: a sensor tripping is a claim, not an adjudication.
 */
export const INTAKE_ADMITTED_BY = 'nexus-intake:audit-loop-closed'

/**
 * Marks knowledge auto-admitted from Stage 3b external intake under the owner's SECOND
 * auto-admission class (Cristian, directed 2026-10-24 over his settled Yan position): an
 * owner-decision record — the owner's own call, its reasoning, and its verified outcome,
 * filed by the owner himself with run_id and ref — is admitted on arrival under its own
 * marker, never the audit marker: the owner attested it, no lane adjudicated it, and the
 * label in the Nexus tab says exactly that.
 */
export const OWNER_ADMITTED_BY = 'nexus-intake:owner-directed'
// Same strings as browserLearning.ts and nexusLearning.ts; repeated here because corpus.ts imports this module and
// those import corpus.ts (a test pins them equal).
export const PLAYBOOK_SOURCE = 'learning:browser'
export const VISITOR_SOURCE_ID = 'learning:visitor'

function field(input: CorpusInteractionInput, key: string): string {
  return input.metadata?.[key] ?? new RegExp(`(?:^|; )${key}=([^;]+)`).exec(input.context || '')?.[1] ?? ''
}

/** The phase a new record converges into, or null when it stays a candidate. */
export function convergencePhase(input: CorpusInteractionInput): Extract<NexusPhase, 'first_principles' | 'extension'> | null {
  if (input.source === VISITOR_SOURCE_ID || field(input, 'channel') === 'visitor' || field(input, 'visitor')) return null
  if (!input.input.trim() || !input.result.trim()) return null
  const outcome = field(input, 'outcome')
  if (input.source === PLAYBOOK_SOURCE) return outcome === 'completed' ? 'extension' : null
  const channel = field(input, 'channel')
  if ((channel === 'chat' || channel === 'voice') && field(input, 'actor') === 'user' && outcome === 'verified') {
    // Machines do not promote machines (owner, 2026-11-01): a successful evidence tool proves the tool ran, not that Qwen's
    // claims are true, so an answer with Qwen lineage stays a candidate. The owner's approval (or CURATOR, once live) is its
    // only way in. Answers from other providers backed by evidence still converge, as before.
    return hasQwenLineage(input) ? null : 'first_principles'
  }
  return null
}

/** Tools whose output is Qwen's own text (the Qwen/Qwen3-8B workflow). */
export const QWEN_LINEAGE_TOOLS: ReadonlySet<string> = new Set(['deepseek_reason', 'ask_deepseek'])
/** Provider ids that answer through the Qwen workflow (providerRouter.isDeepSeekProvider). */
const QWEN_RUNTIMES: ReadonlySet<string> = new Set(['deepseek', 'corpus'])

/** 'qwen' when a turn's answer may carry Qwen's own text: the Qwen provider answered, or a Qwen tool ran in the turn. */
export function answerLineage(provider: string, results: ReadonlyArray<{ name: string }>): 'qwen' | 'none' {
  return QWEN_RUNTIMES.has(provider) || results.some(result => QWEN_LINEAGE_TOOLS.has(result.name)) ? 'qwen' : 'none'
}

/**
 * Whether a record (a new interaction, or one stored before the lineage marker existed) carries Qwen lineage: the explicit
 * marker, a Qwen runtime, a DeepSeek/Qwen model id, or the deepseek learning source. Errs toward "yes": the cost of a false
 * yes is that a record waits for the owner instead of admitting itself.
 */
export function hasQwenLineage(record: { source?: string; runtime?: string; model?: string; context?: string; metadata?: Record<string, string> }): boolean {
  const metadata = record.metadata ?? {}
  const marker = metadata.lineage ?? new RegExp('(?:^|; )lineage=([^;]+)').exec(record.context || '')?.[1]
  const runtime = record.runtime ?? metadata.runtime ?? ''
  const model = record.model ?? metadata.model ?? ''
  return marker === 'qwen' || QWEN_RUNTIMES.has(runtime) || /deepseek|qwen/i.test(model) || (record.source ?? '').startsWith('deepseek:')
}

/** Before this date, chat answers given while the provider was "corpus" were admitted with no signature or review (a8276fa, removed by #61). */
export const UNSIGNED_ADMISSION_UNTIL = '2026-10-14'

/** Where a knowledge record came from, for the NEXUS page. */
export function knowledgeOrigin(record: { timestamp: string; metadata: Record<string, string> }): string {
  if (record.metadata.admittedBy === CONVERGED_BY) return 'AUTO-ADDED'
  if (record.metadata.admittedBy === INTAKE_ADMITTED_BY) return 'AUTO-ADDED · AUDIT-ADJUDICATED'
  if (record.metadata.admittedBy === OWNER_ADMITTED_BY) return 'AUTO-ADDED · OWNER-DIRECTED'
  if (record.timestamp < UNSIGNED_ADMISSION_UNTIL) return 'LEGACY · admitted without review (Sep 24 – Oct 13)'
  return 'ADMITTED · origin not recorded'
}

/**
 * Tools whose result is a model's own output or the app's own bookkeeping, not evidence about the world. On 2026-10-22 a
 * DeepSeek answer that admitted "the context does not provide details about PR #223" still claimed "there are no pending
 * PRs"; because its deepseek_reason call had succeeded, the answer counted as tool-backed and could converge as First
 * Principles knowledge. A model's reasoning, review or vision reading is not evidence of a fact.
 */
export const NOT_EVIDENCE_TOOLS: ReadonlySet<string> = new Set([
  'deepseek_reason', 'ask_deepseek', 'review_code', 'spawn_agent', 'analyze_image',
  'coding_task_update', 'memory_write', 'memory_read', 'memory_list',
  // The funds ledger is the app's own record, not evidence about the world (funds_settle reads Kalshi and is).
  'funds_status', 'funds_propose',
  // Prices the owner typed, not read from Kalshi: usable for research, never evidence (owner condition, 2026-10-23).
  'kalshi_owner_prices',
  // A MiroFish sim's poll measures simulated personas built from a packet; it is never evidence about a fight.
  'mirofish_sim', 'mirofish_sim_result',
])

/** How a final answer is recorded: blocked, verified (a successful evidence tool backs it), or merely completed. */
export function answerOutcome(blocked: boolean, results: ReadonlyArray<{ name: string; isError?: boolean }>): 'blocked' | 'verified' | 'completed' {
  if (blocked) return 'blocked'
  return results.some(result => !result.isError && !NOT_EVIDENCE_TOOLS.has(result.name)) ? 'verified' : 'completed'
}
