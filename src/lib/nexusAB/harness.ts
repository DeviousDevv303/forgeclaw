// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── NEXUS before/after harness ─────────────────────────────────────────────────────────────────────────
// Question it answers: does what NEXUS has learned change what a provider does? For each case it asks the same provider
// the same task twice, once with the owner's rule delivered the way ForgeClaw delivers it ("on") and once without ("off"),
// grades both answers with a mechanical check, and reports pass rates, a paired sign test and a verdict that says
// "no demonstrable effect" when that is what the data shows. The harness never calls a model itself: callers supply an
// `ask`, so the same logic runs against a stub in tests and against real providers in the live runner.

import { AB_CASES, type AbCase } from './cases'
import { signTestP, wilson } from './stats'

export type Arm = 'off' | 'on'

/** What an `ask` returns: the model's answer and the full text that was sent to it (system prompt + context + task). */
export interface AskResult { answer: string; sent: string }
export type Ask = (request: { arm: Arm; kase: AbCase; rep: number }) => Promise<AskResult>

export interface Trial { caseId: string; rep: number; arm: Arm; pass: boolean | null; answer: string; error?: string }

export class ArmIsolationError extends Error {}

/**
 * A broken experiment must not produce numbers. The off arm must not contain the rule anywhere in what was sent (else it
 * is not "off"); the on arm must (else the guidance never arrived, which is exactly the defect this harness exists to catch).
 */
export function assertArmIsolation(arm: Arm, kase: AbCase, sent: string): void {
  const has = sent.includes(kase.rule)
  if (arm === 'off' && has) throw new ArmIsolationError(`off arm for "${kase.id}" already contains the rule`)
  if (arm === 'on' && !has) throw new ArmIsolationError(`on arm for "${kase.id}" did not carry the rule: the guidance never reached the payload`)
}

export interface RunOptions { cases?: readonly AbCase[]; reps: number; ask: Ask; redact?: (text: string) => string }

/** Runs every case `reps` times in both arms, interleaved (off then on) so drift in a provider hits both arms alike. */
export async function runExperiment(options: RunOptions): Promise<Trial[]> {
  const { cases = AB_CASES, reps, ask, redact = (text: string) => text } = options
  const trials: Trial[] = []
  for (const kase of cases) {
    for (let rep = 0; rep < reps; rep++) {
      for (const arm of ['off', 'on'] as const) {
        try {
          const { answer, sent } = await ask({ arm, kase, rep })
          assertArmIsolation(arm, kase, sent)
          trials.push({ caseId: kase.id, rep, arm, pass: kase.check(answer), answer })
        } catch (error) {
          if (error instanceof ArmIsolationError) throw error
          trials.push({ caseId: kase.id, rep, arm, pass: null, answer: '', error: redact(error instanceof Error ? error.message : String(error)) })
        }
      }
    }
  }
  return trials
}

export interface ArmSummary { passes: number; n: number; rate: number; low: number; high: number }
export interface CaseSummary { caseId: string; off: ArmSummary; on: ArmSummary; nonDiscriminating: boolean }
export interface Summary {
  off: ArmSummary
  on: ArmSummary
  pairs: number
  onOnly: number
  offOnly: number
  pValue: number
  errors: number
  perCase: CaseSummary[]
  verdict: string
}

const MIN_PAIRS_FOR_VERDICT = 10

const armSummary = (passes: number, n: number): ArmSummary => ({ passes, n, rate: n ? passes / n : 0, ...wilson(passes, n) })

export function summarize(trials: readonly Trial[]): Summary {
  const key = (t: Trial) => `${t.caseId}#${t.rep}`
  const byKey = new Map<string, { off?: Trial; on?: Trial }>()
  for (const trial of trials) byKey.set(key(trial), { ...byKey.get(key(trial)), [trial.arm]: trial })

  // Only pairs where BOTH arms produced a gradable answer count; a failed call is an error, never a failed rule.
  let pairs = 0, onOnly = 0, offOnly = 0, offPass = 0, onPass = 0
  const perCaseRaw = new Map<string, { offPass: number; onPass: number; n: number }>()
  for (const [k, pair] of byKey) {
    if (pair.off?.pass == null || pair.on?.pass == null) continue
    pairs++
    offPass += pair.off.pass ? 1 : 0
    onPass += pair.on.pass ? 1 : 0
    if (pair.on.pass && !pair.off.pass) onOnly++
    if (pair.off.pass && !pair.on.pass) offOnly++
    const id = k.slice(0, k.lastIndexOf('#'))
    const row = perCaseRaw.get(id) ?? { offPass: 0, onPass: 0, n: 0 }
    row.offPass += pair.off.pass ? 1 : 0
    row.onPass += pair.on.pass ? 1 : 0
    row.n++
    perCaseRaw.set(id, row)
  }
  const perCase: CaseSummary[] = [...perCaseRaw].map(([caseId, r]) => {
    const off = armSummary(r.offPass, r.n)
    return { caseId, off, on: armSummary(r.onPass, r.n), nonDiscriminating: off.rate >= 0.9 }
  })
  const pValue = signTestP(onOnly, offOnly)
  const off = armSummary(offPass, pairs)
  const on = armSummary(onPass, pairs)
  const errors = trials.filter(t => t.pass === null).length
  let verdict: string
  if (pairs < MIN_PAIRS_FOR_VERDICT) verdict = `insufficient data: ${pairs} complete pairs (need ${MIN_PAIRS_FOR_VERDICT}); no verdict`
  else if (pValue < 0.05 && onOnly > offOnly) verdict = 'guidance improved rule compliance'
  else if (pValue < 0.05 && offOnly > onOnly) verdict = 'guidance made rule compliance WORSE'
  else verdict = `no demonstrable effect at ${pairs} pairs (p=${pValue.toFixed(3)}); this is not proof of no effect`
  return { off, on, pairs, onOnly, offOnly, pValue, errors, perCase, verdict }
}

const pct = (r: ArmSummary) => `${(r.rate * 100).toFixed(0)}% (${r.passes}/${r.n}, 95% CI ${(r.low * 100).toFixed(0)}–${(r.high * 100).toFixed(0)}%)`

export function renderReport(provider: string, model: string, summary: Summary, meta: { reps: number; ranAt: string }): string {
  const rows = summary.perCase.map(c => `| ${c.caseId} | ${pct(c.off)} | ${pct(c.on)} | ${c.nonDiscriminating ? 'yes (off arm already ≥90%)' : ''} |`)
  return [
    `## ${provider} · ${model}`,
    '',
    `Ran ${meta.ranAt}, ${meta.reps} repetition(s) per case. **Verdict: ${summary.verdict}.**`,
    '',
    `- Without guidance: ${pct(summary.off)}`,
    `- With guidance: ${pct(summary.on)}`,
    `- Pairs where only the guided answer followed the rule: ${summary.onOnly}; only the unguided one: ${summary.offOnly}; sign-test p = ${summary.pValue.toFixed(3)}`,
    `- Calls that errored and were excluded from the numbers: ${summary.errors}`,
    '',
    '| Case | Without | With | Non-discriminating |',
    '|---|---|---|---|',
    ...rows,
    '',
  ].join('\n')
}
