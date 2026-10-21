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
  if ((channel === 'chat' || channel === 'voice') && field(input, 'actor') === 'user' && outcome === 'verified') return 'first_principles'
  return null
}
