// WHERE admitted corpus attaches: as RETRIEVED CONTEXT the model reads, never as weights (behavior in weights, facts in CORPUS).
// At inference the runtime would (1) retrieve the few admitted rows relevant to the prompt [ranking = TODO, a separate step], then
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
