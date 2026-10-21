// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

/**
 * NEXUS/CORPUS learning events (agent: Claude Sonnet 5.5, at operator request).
 *
 * Every voice prompt, chat turn, tool execution and shell command becomes a CORPUS
 * interaction plus an UNAPPROVED learning candidate, through the existing pipeline in corpus.ts.
 * This module only observes. It never executes anything, never approves a candidate, and never
 * grants authority: admission still needs the separate authorization in corpusAdmissionAuth.ts.
 *
 * Outcomes follow the Codex Anima integrity model. 'verified' is never assigned here, because
 * nothing at these call sites independently checks a result; a tool that returned normally is
 * only 'completed', and a tool error is 'failed' (or 'blocked' when Guardian refused it).
 *
 * Secrets are redacted and text is bounded before anything is stored. Recording is best-effort:
 * a storage failure is reported to the caller as `false` and never breaks the user's request.
 */

import { corpusRepository, type CorpusInteractionInput } from './corpus'
import { sanitizeShellOutput } from './shellLearning'
import { isToolFailureOutput } from './toolOutcome'

export type LearningChannel = 'chat' | 'voice' | 'tool' | 'shell'
export type LearningOutcome = 'attempted' | 'completed' | 'verified' | 'blocked' | 'failed'
export type LearningActor = 'user' | 'operator' | 'agent'

export interface LearningEventInput {
  channel: LearningChannel
  input: string
  result: string
  outcome: LearningOutcome
  runtime: string
  model: string
  toolName?: string
  actor?: LearningActor
  /** How the prompt reached ForgeClaw: spoken or typed. */
  origin?: 'voice' | 'typed'
  /** The run that produced this event (a retry of a run shares its parent's id). */
  runId?: string
}

/** The id for a run's learning events: a retry inherits its parent's id, so it never counts as an independent run. */
export function learningRunId(parent?: string): string {
  return parent || `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export interface LearningRecorder {
  appendInteraction(input: CorpusInteractionInput): Promise<unknown>
}

/** Bound on stored text per field; keeps localStorage use predictable. */
export const MAX_LEARNING_FIELD_CHARS = 4_000

/** Classify a tool's own output. Never returns 'verified'. */
export function outcomeFromToolOutput(output: string): Extract<LearningOutcome, 'completed' | 'blocked' | 'failed'> {
  if (/^\s*\[GUARDIAN (?:BLOCK|REJECTED)\]/i.test(output)) return 'blocked'
  return isToolFailureOutput(output) ? 'failed' : 'completed'
}

function clean(text: string): { text: string; redacted: boolean } {
  const { output, redactionOccurred } = sanitizeShellOutput(text)
  const bounded = output.length > MAX_LEARNING_FIELD_CHARS ? output.slice(0, MAX_LEARNING_FIELD_CHARS) : output
  return { text: bounded, redacted: redactionOccurred || bounded.length !== output.length }
}

/** Pure: turn an event into the CORPUS input. Channel and outcome are part of the hashed context, so the same text with a different outcome is a different record. */
export function buildLearningEvent(event: LearningEventInput): CorpusInteractionInput {
  const input = clean(event.input)
  const result = clean(event.result)
  const fields: Record<string, string> = {
    channel: event.channel,
    outcome: event.outcome,
    origin: event.origin ?? (event.channel === 'voice' ? 'voice' : 'typed'),
    actor: event.actor ?? 'user',
    ...(event.toolName ? { tool: event.toolName } : {}),
  }
  return {
    input: input.text,
    context: Object.entries(fields).map(([key, value]) => `${key}=${value}`).join('; '),
    result: result.text,
    runtime: event.runtime,
    model: event.model,
    source: `learning:${event.channel}`,
    // The run id stays out of `context`: that is hashed, and the same fact from two runs must stay one record (whose runs list grows).
    metadata: { ...fields, ...(event.runId ? { run: event.runId } : {}), redacted_or_truncated: String(input.redacted || result.redacted), admission: 'unapproved' },
  }
}

/** Record one event. Resolves true when stored, false when skipped or when storage failed. Never throws. */
export async function recordLearningEvent(event: LearningEventInput, recorder: LearningRecorder = corpusRepository): Promise<boolean> {
  if (!event.input.trim()) return false
  try {
    await recorder.appendInteraction(buildLearningEvent(event))
    return true
  } catch {
    return false
  }
}
