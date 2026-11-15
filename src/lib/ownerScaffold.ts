// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── The owner's own reasoning framework: private, in this browser ──────────────────────────────
// The owner reasons in a framework of their own, documented over time. It is not published in this repository: the owner
// types it into SETTINGS and it is kept in this browser only. While it is set, it replaces the default operating loop in
// the system prompt (same place, so no extra prompt text), and the model is asked to think it through in its private
// reasoning, never in the visible answer. It is sent to the model provider chosen for the chat, like the rest of the prompt.

const KEY = 'fc_owner_scaffold_v1'
/**
 * Bounded, because it is sent on every request (~3,000 tokens at the limit). Was 3,000 until 2026-10-23: the owner's full
 * five-phase framework is longer, and the Settings box cut a paste there silently, so the later phases never reached the model.
 */
export const MAX_SCAFFOLD_CHARS = 12_000
/** The previous limit: a framework saved at exactly this length was probably cut by it. */
export const LEGACY_SCAFFOLD_LIMIT = 3_000

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const browserStore = (): Store | undefined => { try { return globalThis.localStorage } catch { return undefined } }

export function loadOwnerScaffold(store: Store | undefined = browserStore()): string {
  try { return (store?.getItem(KEY) ?? '').slice(0, MAX_SCAFFOLD_CHARS) } catch { return '' }
}

/** Saves the text (cut to the limit) and returns what is now stored; empty text clears it. */
export function saveOwnerScaffold(text: string, store: Store | undefined = browserStore()): string {
  const clean = text.replace(/\r\n/g, '\n').trim().slice(0, MAX_SCAFFOLD_CHARS)
  try {
    if (clean) store?.setItem(KEY, clean)
    else store?.removeItem(KEY)
  } catch { /* not persisted */ }
  return clean
}

/**
 * A phase label is a heading, not a sentence: a longer "label" is prose the extractor
 * misread, and printing it as a section title would shred the plan it organizes.
 */
const MAX_PHASE_LABEL_CHARS = 80
/**
 * A reasoning framework has a handful of phases. A match count past this is the
 * structure of the prose (lists, labeled lines in body text), not of the framework.
 */
const MAX_SCAFFOLD_PHASES = 12

/**
 * The framework's phase labels, in order, read from its own structure — never from any
 * wording this code expects. The owner's text is free-form, so the extractor reads only
 * generic shape, in this order: markdown headings; numbered lead-ins ("1. …", "2) …");
 * bold lead-ins ("**…**"); and colon labels ("Label: …") — the labeled-line shape this
 * app itself asks the framework's phases to take (see operatingLoopFor). The looser
 * shapes need at least two matches to count as structure; a lone match is prose. An
 * empty result means no phase structure was found — callers say so rather than invent one.
 */
export function scaffoldPhases(text: string): string[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const finish = (labels: string[]): string[] => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const raw of labels) {
      const label = raw.replace(/\s+/g, ' ').trim()
      if (!label || label.length > MAX_PHASE_LABEL_CHARS) continue
      const key = label.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(label)
      if (out.length >= MAX_SCAFFOLD_PHASES) break
    }
    return out
  }
  const headings = lines.filter(l => /^#{1,6}\s+\S/.test(l)).map(l => l.replace(/^#{1,6}\s+/, '').replace(/[*_`]+/g, '').trim())
  if (headings.length) return finish(headings)
  const numbered = lines.filter(l => /^\d{1,2}[.)]\s+\S/.test(l)).map(l => l.replace(/^\d{1,2}[.)]\s+/, '').trim())
  if (numbered.length >= 2) return finish(numbered)
  const bold = lines.filter(l => /^\*\*[^*]+\*\*/.test(l)).map(l => /^\*\*([^*]+)\*\*/.exec(l)![1].trim())
  if (bold.length >= 2) return finish(bold)
  const colon = lines
    .filter(l => /^[^:]{2,60}:\s+\S/.test(l) && !/^https?:/i.test(l))
    .map(l => l.slice(0, l.indexOf(':')).trim())
  if (colon.length >= 2) return finish(colon)
  return []
}

/** The system-prompt section that replaces the default operating loop while the owner's framework is set. */
export function operatingLoopFor(scaffold: string, fallback: string): string {
  const text = scaffold.trim()
  if (!text) return fallback
  return "CORE OPERATING LOOP — THE OWNER'S OWN REASONING FRAMEWORK (REQUIRED)\n" +
    'Your reasoning for every task MUST be written in the phases of the framework below, in order, as labeled lines: each line starts ' +
    'with the phase name exactly as the framework writes it, then a colon, then what that phase concludes about THIS task (its files, ' +
    'PRs, tools, numbers), not a general statement. Do not skip, merge or rename a phase. Keep each phase to one or two lines. ' +
    'There is no exemption: every task, however small, gets the phases. The phases belong in your reasoning, never in the visible answer. ' +
    'Act on real tool results and verify before you claim. On failure, find the root cause and retry another way. Continue until the objective is complete, blocked, or explicitly stopped.\n\n' +
    `${text}\n\n`
}

/**
 * Repeated at the very end of the system prompt, closest to where the model starts reasoning. With the framework stated only
 * near the top of a long prompt and worded as advice ("think … through", "skip it for a plain question"), Kimi reasoned without
 * a single phase label in three reasoning-heavy runs (2026-10-22), though the framework was verifiably in the prompt.
 */
export function reasoningFormatReminder(scaffold: string): string {
  if (!scaffold.trim()) return ''
  return '\n\nREASONING FORMAT (REQUIRED, the owner\'s framework above): begin your reasoning with the framework\'s phases, in order, ' +
    'one labeled line each ("<phase name>: <what it concludes about this task>"), before planning any tool call. Not in the visible answer.'
}
