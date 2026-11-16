/*
 * Copyright (c) 2026 DeviousDevv303 (Cristian)
 * ForgeClaw — Personal AI Assistant
 * Built with love for Cristian Jr., Layla, and Jozae
 */

/**
 * `/intuition`: the owner opens or closes the read-only Synthetic Intuition panel. Owner-typed, no model involved, and it
 * can only show numbers: the intuition layer has no execution authority (forgeclaw #235 verdict).
 */
import { allStats, type IntuitionLedger } from './ledger'
import { resolvePacket } from './packet'
import type { PatternRegistry } from './patternClasses'

export type IntuitionCommand = { kind: 'open' } | { kind: 'close' }

export function parseIntuitionCommand(text: string): IntuitionCommand | null {
  const m = /^\/intuition(?:\s+(open|close))?\s*$/i.exec(text.trim())
  if (!m) return null
  return { kind: m[1]?.toLowerCase() === 'close' ? 'close' : 'open' }
}

export function intuitionSummary(l: IntuitionLedger, registry: PatternRegistry): string {
  const stats = allStats(l)
  const sealed = Object.keys(l.records).length
  const lines = [
    `Synthetic Intuition ledger — registry ${registry.version} (${registry.status}). ${sealed} sealed prediction${sealed === 1 ? '' : 's'}, ${Object.keys(l.grades).length} graded, ${l.journal.length} packet${l.journal.length === 1 ? '' : 's'} journaled.`,
  ]
  if (stats.length === 0) lines.push('No graded evidence yet: every class sits at bucket 0 until real graded records earn more.')
  for (const s of stats) lines.push(`- ${s.patternClassId} / ${s.regime}: ${s.hits}/${s.n} graded, lower bound ${s.lowerBound.toFixed(2)}, bucket ${s.bucket}`)
  const bad = l.journal.filter(j => !resolvePacket(l, registry, j.packetHash).ok).length
  if (bad) lines.push(`${bad} journaled packet${bad === 1 ? '' : 's'} fail${bad === 1 ? 's' : ''} to resolve and would be rejected by the harness.`)
  lines.push('Read-only: this view moves no stake, weight or position.')
  return lines.join('\n')
}
