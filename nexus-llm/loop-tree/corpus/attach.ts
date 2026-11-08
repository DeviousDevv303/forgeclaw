// WHERE admitted corpus attaches: as RETRIEVED CONTEXT the model reads, never as weights (behavior in weights, facts in CORPUS).
// At inference the runtime would (1) retrieve the few admitted rows relevant to the prompt (selectForPrompt, below), then
// (2) format them here into a bounded Context block prepended before the "User:" frame. In training that block is part of the frame,
// so it is loss-MASKED (common.py masks the frame): the model learns to USE retrieved facts, not to memorize them. That is the whole
// point of the weights/corpus split and the fix for the run-6 memorization failure.
import type { CorpusRow } from './check-corpus'

/** Mirrors the app's nexusGuidance budget (MAX_GUIDANCE_CHARS = 1800 in src/lib/nexusGuidance.ts): retrieved context is bounded so it
 *  cannot evict the task. Rows are added whole, highest-priority first, until the next row would not fit. */
export const CONTEXT_BUDGET_CHARS = 1800

/** One admitted row as a context line, with its evidence tag so a fact stays traceable after admission (Kimi's refinement). */
export function rowToContextLine(r: CorpusRow): string {
  const ev = r.artifact.type === 'pr' ? `PR #${r.artifact.ref}` : `${r.artifact.type}:${r.artifact.ref}`
  return `- ${r.symptom} -> ${r.fix} [${ev}]`
}

/** Bounded Context block from the already-selected, already-admitted rows (selection/ranking happens before this). Admitted-only:
 *  a row with admitted !== true is skipped, so an un-admitted candidate can never reach the model even if retrieval mis-selects it. */
export function formatContext(selected: CorpusRow[], budget = CONTEXT_BUDGET_CHARS): string {
  const lines: string[] = []
  let used = 'Context (verified, admitted facts; use them, do not invent beyond them):\n'.length
  for (const r of selected) {
    if (r.admitted !== true) continue
    const line = rowToContextLine(r)
    if (used + line.length + 1 > budget) break
    lines.push(line); used += line.length + 1
  }
  return lines.length ? `Context (verified, admitted facts; use them, do not invent beyond them):\n${lines.join('\n')}\n` : ''
}

/** The full prefix a budgeted run would send: Context block (if any) then the task. The grammar/transcript is unchanged; this only
 *  adds masked context ahead of the "User:" frame. */
export function attachToPrompt(context: string, prompt: string): string {
  return context ? `${context}\nUser: ${prompt}\n` : `User: ${prompt}\n`
}

// ─── retrieval: which admitted rows to attach for a prompt ────────────────────────────────────────────────────────────
const STOP = new Set(['the','a','an','is','are','to','of','in','on','for','and','or','my','me','i','it','that','this','what','how','do','does','with','was','were','be','been','after','before','not','no'])
/** Content terms of a string: lowercased word tokens >= 3 chars, stopwords removed. Deterministic; no model, no network. */
export function terms(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z0-9_]+/g) ?? []).filter(w => w.length >= 3 && !STOP.has(w)))
}
/** Overlap score of a row against the prompt terms: how many of the row's symptom+fix terms the prompt mentions. A row with zero
 *  overlap is never attached (score 0), so an irrelevant fact cannot be injected just because the budget had room. */
export function scoreRow(promptTerms: Set<string>, r: CorpusRow): number {
  let hits = 0
  for (const t of terms(`${r.symptom} ${r.fix}`)) if (promptTerms.has(t)) hits++
  return hits
}
/** The admitted rows to attach for a prompt: positive-overlap only, highest score first, ties broken by id for determinism, at most k.
 *  Selection never admits: an un-admitted row scores but is filtered, so it can never be returned. Formatting still re-checks admitted. */
export function selectForPrompt(prompt: string, rows: CorpusRow[], k = 5): CorpusRow[] {
  const pt = terms(prompt)
  return rows
    .filter(r => r.admitted === true)
    .map(r => ({ r, s: scoreRow(pt, r) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || a.r.id.localeCompare(b.r.id))
    .slice(0, k)
    .map(x => x.r)
}
/** End to end: select the relevant admitted rows for a prompt, format them within budget, and attach ahead of the task. */
export function contextForPrompt(prompt: string, rows: CorpusRow[], k = 5, budget = CONTEXT_BUDGET_CHARS): string {
  return attachToPrompt(formatContext(selectForPrompt(prompt, rows, k), budget), prompt)
}
