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
 * PLACEHOLDER pending Muse's list, status 'draft': the packet builder refuses it unless a caller explicitly allows drafts
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
      falsifier: 'A settled outcome on a clean provenance chain that the pattern assigned low probability to.',
    },
  ],
}

/** The registry the app reads. Swapping in Muse's frozen list is a one-line change here plus its tests; until then nothing is frozen. */
export const ACTIVE_REGISTRY: PatternRegistry = DRAFT_REGISTRY
