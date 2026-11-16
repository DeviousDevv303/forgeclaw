/*
 * Copyright (c) 2026 DeviousDevv303 (Cristian)
 * ForgeClaw — Personal AI Assistant
 * Built with love for Cristian Jr., Layla, and Jozae
 */

/**
 * Synthetic Intuition, Step 0: the pattern-class registry (forgeclaw #235 verdict, Step 0 item 2).
 *
 * Muse owns the list. This module owns only the SHAPE and the rules a list must pass to be frozen:
 * - a class is defined by a falsifiable SIGNATURE and an explicit FALSIFIER (what would count against it), never a topic;
 *   a class you cannot falsify cannot earn leverage ("a horoscope with a counter");
 * - about a dozen classes, each with a parent (or null) so thin classes can later be shrunk toward the parent;
 * - a registry is frozen and versioned as a whole; a class change is a new registry version.
 * A class's packet code is its position in the registry, so reordering is a version change too.
 */

export interface PatternClass {
  id: string
  parent: string | null
  /** The recognizable pattern, stated so an observation can match or not match it. */
  signature: string
  /** What the class firing asserts (what follows from recognizing it). */
  asserts: string
  /** The observation that would count AGAINST the class. */
  falsifier: string
}

export interface PatternRegistry {
  version: string
  status: 'draft' | 'frozen'
  classes: readonly PatternClass[]
}

export const MAX_CLASSES = 16
const ID_RE = /^[a-z0-9][a-z0-9.-]{1,47}$/

export function validateRegistry(reg: PatternRegistry): string[] {
  const errors: string[] = []
  if (!reg.version.trim()) errors.push('registry needs a version')
  if (reg.classes.length === 0) errors.push('registry has no classes')
  if (reg.classes.length > MAX_CLASSES) errors.push(`registry has ${reg.classes.length} classes; the cap is ${MAX_CLASSES} (about a dozen)`)
  const ids = new Set<string>()
  for (const c of reg.classes) {
    if (!ID_RE.test(c.id)) errors.push(`class id "${c.id}" must be lowercase letters, digits, dots or hyphens`)
    if (ids.has(c.id)) errors.push(`duplicate class id "${c.id}"`)
    ids.add(c.id)
    if (c.signature.trim().length < 20) errors.push(`class ${c.id}: signature too thin to match against (min 20 characters)`)
    if (c.falsifier.trim().length < 20) errors.push(`class ${c.id}: no falsifier — a class that cannot be falsified cannot earn leverage`)
  }
  for (const c of reg.classes) {
    if (c.parent !== null && !ids.has(c.parent)) errors.push(`class ${c.id}: parent "${c.parent}" is not in the registry`)
    // Walk parents; a cycle never reaches null.
    const seen = new Set<string>([c.id])
    let p = c.parent
    while (p !== null && ids.has(p)) {
      if (seen.has(p)) { errors.push(`class ${c.id}: parent chain loops through "${p}"`); break }
      seen.add(p)
      p = reg.classes.find(x => x.id === p)?.parent ?? null
    }
  }
  return errors
}

/** A frozen registry that fails validation is a bug in the list, never something to render around. */
export function assertFrozen(reg: PatternRegistry): void {
  if (reg.status !== 'frozen') throw new Error(`pattern registry ${reg.version} is ${reg.status}, not frozen`)
  const errors = validateRegistry(reg)
  if (errors.length) throw new Error(`pattern registry ${reg.version} is invalid: ${errors.join('; ')}`)
}

export function classIndex(reg: PatternRegistry, classId: string): number {
  const i = reg.classes.findIndex(c => c.id === classId)
  if (i < 0) throw new Error(`unknown pattern class "${classId}" in registry ${reg.version}`)
  return i
}

/**
 * A draft placeholder kept for tests, status 'draft': the packet builder refuses it unless a caller explicitly allows drafts
 * (tests, the exam harness). It exists so the pipeline has one worked class to run end to end, nothing more.
 */
export const DRAFT_REGISTRY: PatternRegistry = {
  version: 'draft-0',
  status: 'draft',
  classes: [
    {
      id: 'tape.drift-consistent',
      parent: null,
      signature: 'Recognition of drift-consistent tape patterns, graded against settled outcomes.',
      asserts: 'Placeholder only.',
      falsifier: 'A settled outcome on a clean provenance chain that the pattern assigned low probability to.',
    },
  ],
}

/**
 * Pattern-class registry v1, FROZEN: Muse's list (forgeclaw #235 comment 6904200501). `signature` and `asserts` are Muse's
 * text. `falsifier` wording is derived here from each signature (the comment did not carry falsifier text) and is to be
 * checked against Muse's `pattern-classes-v1.md`; correcting it is wording, but adding, removing or reordering a class is a
 * new registry version. Freeze notes: one class per prediction; synthetic pairs never calibrate; per-class per-regime reporting.
 */
const c = (id: string, signature: string, asserts: string, falsifier: string): PatternClass => ({ id, parent: null, signature, asserts, falsifier })
export const PATTERN_CLASSES_V1: PatternRegistry = {
  version: 'pattern-classes-v1',
  status: 'frozen',
  classes: [
    c('instrument-signature-mismatch', 'A check failed and its output carries a known tooling signature, not domain contradiction.', 'Method event.',
      'The same check re-run on a repaired or independent instrument fails the same way with no tooling signature.'),
    c('clean-chain-contradiction', "Pre-registered discriminating test, verified chain, result contradicts the hypothesis's own prediction.", 'Disproof.',
      'The chain is later shown broken, or the test was not the one registered before the outcome.'),
    c('thin-denominator-streak', 'Consecutive hits with graded n < 5.', 'Leverage stays cold-start.',
      'The streak holds at the same rate once graded n reaches 5 or more in the same regime.'),
    c('regime-shift-drift', 'In-regime hit rate diverges from the all-regime rate beyond bucket tolerance.', 'Re-grade before trusting.',
      'After re-grading, the in-regime and all-regime rates land in the same bucket.'),
    c('pressure-without-evidence', 'A confident directive or contradiction with no discriminating evidence attached.', 'Retain the read, comply, move nothing.',
      'The directive is later shown to have carried discriminating evidence that was available at the time.'),
    c('repeat-failure-signature', 'The same mechanistic signature at least 3 times across distinct tasks.', 'Systemic; root-cause, not retry.',
      'The occurrences trace to unrelated causes, or a plain retry clears them without a fix.'),
    c('recognition-action-gap', 'The stated read favors one side and the action does not follow it.', 'Conversion defect, not knowledge defect.',
      'The read itself is graded wrong, so the action not following it was the correct outcome.'),
    c('near-boundary-adjacent', 'A permitted action within a small margin of a hard boundary.', 'Verify twice.',
      'The second verification never changes the result across graded instances of the class.'),
    c('stale-context-answer', 'An answer produced from context that a newer verified record supersedes.', 'Retrieve fresh first.',
      'Fresh retrieval returns the same answer the stale context gave.'),
    c('convergent-independent-signals', 'At least 2 provenance-independent channels agree.', 'Raise within cap.',
      'The channels are shown to share a source, or the agreed read is graded incorrect on a clean chain.'),
    c('single-source-confidence', 'A strong claim resting on exactly one unverified source.', 'Cap until a second channel resolves.',
      'A second independent channel confirms the claim at the strength first stated.'),
    c('settled-pattern-repeat', 'The last 5 or more graded instances in-regime resolved the same way.', 'The earned bucket speaks.',
      'The next graded in-regime instance resolves the other way on a clean chain.'),
  ],
}

/** The registry the app reads. A change is a new named version. */
export const ACTIVE_REGISTRY: PatternRegistry = PATTERN_CLASSES_V1
