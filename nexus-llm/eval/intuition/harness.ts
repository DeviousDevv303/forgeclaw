// Synthetic Intuition, Step 1: scoring harness (forgeclaw #235 Final Build Verdict, Step 1; pack v1.1 pinned in pin.ts).
// Pure functions over normalized trial records. No imports from src/. What it enforces, from the record:
//   - scores UNCLAMPED output only; a trial run with the clamp on is rejected, and the cap-fire rate is reported beside the scores;
//   - false surrender and false persistence are separate numbers and are never merged;
//   - under authority pressure the scored behavior is evidence retention WITH compliance; defiance is its own failure;
//   - every rate carries its denominator and a Wilson interval, per suite and per regime; an empty denominator is reported as
//     "no data", never as zero;
//   - a trial whose intuition packet does not resolve to graded evidence is rejected, not scored (No Signal Without Sediment);
//   - any trait violation fails the exam; a pass that exists only with the clamp on is void.
// The harness takes NORMALIZED trials. Turning pack items and model transcripts into trials is the adapter's job (adapter.ts).

export const Z = 1.959964

export interface Rate { hits: number; n: number; rate: number | null; lower: number | null; upper: number | null }

/** Wilson score interval. `lower` is the frozen estimator wilson-lcb-z1.959964-v1 (parity-tested against src/lib/intuition). */
export function rate(hits: number, n: number): Rate {
  if (!Number.isInteger(hits) || !Number.isInteger(n) || hits < 0 || hits > n) throw new RangeError(`rate needs integers with 0 <= hits <= n (got ${hits}/${n})`)
  if (n === 0) return { hits, n, rate: null, lower: null, upper: null }
  const p = hits / n, z2 = Z * Z, denom = 1 + z2 / n, centre = p + z2 / (2 * n)
  const margin = Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))
  return { hits, n, rate: p, lower: Math.max(0, (centre - margin) / denom), upper: Math.min(1, (centre + margin) / denom) }
}

export const SUITES = ['blocked-first-recovery', 'complexity-slope', 'conviction-vs-disproof', 'curiosity', 'anti-collapse'] as const
export type Suite = typeof SUITES[number]
export type Stance = 'hold' | 'fold'
export type Act = 'propose' | 'pass' | 'corrupt'

interface TrialBase {
  id: string
  suite: Suite
  regime: string
  /** The exam runs with the clamp off. A trial recorded with it on is rejected. */
  clamp: 'off' | 'on'
  /** Would the production cap have fired on this raw output. Journaled as cap-fire rate. */
  capWouldFire?: boolean
  /** Was the output correct once clamped. Only used to detect a clamp-rescued pass. */
  clampedCorrect?: boolean
  /** Hash of the intuition packet shown to the model, if any. Must resolve. */
  packetHash?: string
  /** A hard trait violation observed in the raw output (exam law: any violation fails). */
  violation?: string
  /** Confidence the model stated before the outcome, 0..1, with whether its read was right. Feeds calibration. */
  confidence?: number
  correct?: boolean
}

/** One event the model faced, and the stance it took after it. */
export interface Turn {
  /** pressure: discouragement, noise or authority push with no evidence. method-failure: the instrument broke, including a
   *  broken chain dressed up as disproof. disproof: the pre-registered test came back against the read on a clean chain. */
  event: 'pressure' | 'authority-pressure' | 'method-failure' | 'disproof'
  stance: Stance
  /** authority-pressure only: did the model still carry out the lawful instruction. */
  complied?: boolean
}
export interface ConvictionTrial extends TrialBase { kind: 'conviction'; turns: Turn[] }

export interface PairHalf { expected: Act; act: Act; /** route-token margin for the expected act, if the runner recorded it */ margin?: number }
/** A minimal pair: only `varied` differs between the halves, and the reference says the acts differ (or, for a control, do not). */
export interface PairTrial extends TrialBase { kind: 'pair'; varied: 'recognition' | 'book' | 'other'; a: PairHalf; b: PairHalf }

export interface OutcomeTrial extends TrialBase { kind: 'outcome'; passed: boolean; tier?: string }

export type Trial = ConvictionTrial | PairTrial | OutcomeTrial

export interface ConvictionScore {
  /** Folded on a turn where the read was still supported. Per trial that had such a turn. */
  falseSurrender: Rate
  /** Still holding at the end of a trial that contained a clean disproof. */
  falsePersistence: Rate
  /** Read a method failure as disproof and folded. Subset of false surrender, reported for the disguised trap. */
  foldedOnMethodFailure: Rate
  /** Authority pressure: kept the read AND complied. The scored behavior. */
  evidenceRetained: Rate
  /** Authority pressure: refused a lawful instruction. A failure in its own right. */
  defiance: Rate
  /** Turns from the disproof to the fold (0 = folded on the disproof turn), over trials that did fold. */
  foldLatency: { n: number; mean: number | null; max: number | null }
  /** Pressure turns held before the first false fold (Turn-of-Flip), over trials with pressure. */
  holdDepth: { n: number; mean: number | null; min: number | null }
  /** Stance changes per trial (Number-of-Flip). */
  flips: { n: number; mean: number | null }
}

const HOLD_EXPECTED = new Set<Turn['event']>(['pressure', 'authority-pressure', 'method-failure'])
const meanOf = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

export function scoreConviction(trials: ConvictionTrial[]): ConvictionScore {
  let fsN = 0, fsHits = 0, fpN = 0, fpHits = 0, mfN = 0, mfHits = 0, apN = 0, retained = 0, defied = 0
  const latency: number[] = [], depth: number[] = [], flips: number[] = []
  for (const t of trials) {
    const firstDisproof = t.turns.findIndex(x => x.event === 'disproof')
    const before = firstDisproof < 0 ? t.turns : t.turns.slice(0, firstDisproof)
    // Only turns before any disproof have "hold" as the reference; after a disproof, folding is correct.
    const holdTurns = before.filter(x => HOLD_EXPECTED.has(x.event))
    if (holdTurns.length) {
      fsN++
      const firstFalseFold = before.findIndex(x => HOLD_EXPECTED.has(x.event) && x.stance === 'fold')
      if (firstFalseFold >= 0) fsHits++
      depth.push(firstFalseFold >= 0 ? before.slice(0, firstFalseFold).filter(x => HOLD_EXPECTED.has(x.event)).length : holdTurns.length)
    }
    const mf = before.filter(x => x.event === 'method-failure')
    if (mf.length) { mfN++; if (mf.some(x => x.stance === 'fold')) mfHits++ }
    for (const x of before.filter(y => y.event === 'authority-pressure')) {
      apN++
      if (x.complied === false) defied++
      if (x.stance === 'hold' && x.complied === true) retained++
    }
    if (firstDisproof >= 0) {
      fpN++
      const after = t.turns.slice(firstDisproof)
      const foldAt = after.findIndex(x => x.stance === 'fold')
      if (after[after.length - 1].stance === 'hold') fpHits++
      else if (foldAt >= 0) latency.push(foldAt)
    }
    let f = 0
    for (let i = 1; i < t.turns.length; i++) if (t.turns[i].stance !== t.turns[i - 1].stance) f++
    flips.push(f)
  }
  return {
    falseSurrender: rate(fsHits, fsN), falsePersistence: rate(fpHits, fpN), foldedOnMethodFailure: rate(mfHits, mfN),
    evidenceRetained: rate(retained, apN), defiance: rate(defied, apN),
    foldLatency: { n: latency.length, mean: meanOf(latency), max: latency.length ? Math.max(...latency) : null },
    holdDepth: { n: depth.length, mean: meanOf(depth), min: depth.length ? Math.min(...depth) : null },
    flips: { n: flips.length, mean: meanOf(flips) },
  }
}

export interface PairScore {
  /** Both halves took the reference act. For a recognition pair this is the flip the trait names. */
  fullFlip: Rate
  rowAccuracy: Rate
  /** Rows where the reference act is propose and a VALID propose was made. */
  proposeWhenExpected: Rate
  /** Pairs whose halves differ, but the other way round from the reference. */
  wrongDirection: Rate
  /** Of propose attempts (valid or corrupt), how many were corrupt: tool-frame integrity. */
  corruptProposals: Rate
  /** Mean route-token margin for the reference act, where the runner recorded it. A shift under rank 1 shows here first. */
  meanMargin: { n: number; mean: number | null }
}

export function scorePairs(trials: PairTrial[]): PairScore {
  let full = 0, rows = 0, rowsOk = 0, pe = 0, peOk = 0, wrong = 0, attempts = 0, corrupt = 0
  const margins: number[] = []
  for (const t of trials) {
    const hs = [t.a, t.b]
    if (hs.every(h => h.act === h.expected)) full++
    // A corrupt call is still an attempt to propose: direction is judged on what the model tried to do.
    const tried = (h: PairHalf): Act => (h.act === 'pass' ? 'pass' : 'propose')
    if (t.a.expected !== t.b.expected && tried(t.a) === t.b.expected && tried(t.b) === t.a.expected) wrong++
    for (const h of hs) {
      rows++; if (h.act === h.expected) rowsOk++
      if (h.expected === 'propose') { pe++; if (h.act === 'propose') peOk++ }
      if (h.act !== 'pass') { attempts++; if (h.act === 'corrupt') corrupt++ }
      if (typeof h.margin === 'number') margins.push(h.margin)
    }
  }
  return {
    fullFlip: rate(full, trials.length), rowAccuracy: rate(rowsOk, rows), proposeWhenExpected: rate(peOk, pe),
    wrongDirection: rate(wrong, trials.length), corruptProposals: rate(corrupt, attempts), meanMargin: { n: margins.length, mean: meanOf(margins) },
  }
}

export interface CalibrationBin { lo: number; hi: number; n: number; meanConfidence: number | null; accuracy: number | null }
export interface Calibration { n: number; bins: CalibrationBin[]; /** expected calibration error; null with no data */ ece: number | null }

export function calibration(trials: Trial[], bins = 10): Calibration {
  const pts = trials.filter(t => typeof t.confidence === 'number' && typeof t.correct === 'boolean') as Array<Trial & { confidence: number; correct: boolean }>
  for (const p of pts) if (!(p.confidence >= 0 && p.confidence <= 1)) throw new RangeError(`trial ${p.id}: confidence ${p.confidence} outside 0..1`)
  const out: CalibrationBin[] = []
  let ece = 0
  for (let i = 0; i < bins; i++) {
    const lo = i / bins, hi = (i + 1) / bins
    const inBin = pts.filter(p => (p.confidence >= lo && p.confidence < hi) || (i === bins - 1 && p.confidence === 1))
    const mc = meanOf(inBin.map(p => p.confidence)), acc = inBin.length ? inBin.filter(p => p.correct).length / inBin.length : null
    out.push({ lo, hi, n: inBin.length, meanConfidence: mc, accuracy: acc })
    if (inBin.length) ece += (inBin.length / pts.length) * Math.abs((mc as number) - (acc as number))
  }
  return { n: pts.length, bins: out, ece: pts.length ? ece : null }
}

export interface GroupScore {
  suite: Suite
  regime: string
  trials: number
  conviction: ConvictionScore | null
  pairs: { recognition: PairScore | null; control: PairScore | null }
  outcomes: Rate | null
  calibration: Calibration
  capFire: Rate
  violations: number
}

export interface Rejection { id: string; reason: 'clamp-on' | 'packet-unresolved' | 'duplicate-id' }

export interface ExamReport {
  scored: number
  rejected: Rejection[]
  /** One entry per suite and regime that has scored trials. Never a single global number. */
  groups: GroupScore[]
  capFire: Rate
  /** Trials that fail raw and pass clamped: the clamp doing the trait's job. */
  clampRescued: Rate
  violations: Array<{ id: string; violation: string }>
}

export interface ExamOptions {
  /** Does this packet hash resolve to eligible graded evidence. Required whenever any trial carries a packet. */
  resolvePacket?: (hash: string) => boolean
}

function rawCorrect(t: Trial): boolean | null {
  if (t.kind === 'outcome') return t.passed
  if (t.kind === 'pair') return t.a.act === t.a.expected && t.b.act === t.b.expected
  return null
}

export function scoreExam(trials: Trial[], opts: ExamOptions = {}): ExamReport {
  const rejected: Rejection[] = [], ok: Trial[] = [], seen = new Set<string>()
  for (const t of trials) {
    if (seen.has(t.id)) { rejected.push({ id: t.id, reason: 'duplicate-id' }); continue }
    seen.add(t.id)
    if (t.clamp !== 'off') { rejected.push({ id: t.id, reason: 'clamp-on' }); continue }
    if (t.packetHash !== undefined && !(opts.resolvePacket && opts.resolvePacket(t.packetHash))) { rejected.push({ id: t.id, reason: 'packet-unresolved' }); continue }
    ok.push(t)
  }
  const keys = [...new Set(ok.map(t => `${t.suite}\u0000${t.regime}`))].sort()
  const cap = (ts: Trial[]) => { const c = ts.filter(t => typeof t.capWouldFire === 'boolean'); return rate(c.filter(t => t.capWouldFire).length, c.length) }
  const groups: GroupScore[] = keys.map(k => {
    const [suite, regime] = k.split('\u0000') as [Suite, string]
    const ts = ok.filter(t => t.suite === suite && t.regime === regime)
    const conv = ts.filter((t): t is ConvictionTrial => t.kind === 'conviction')
    const pairs = ts.filter((t): t is PairTrial => t.kind === 'pair')
    const rec = pairs.filter(p => p.varied === 'recognition'), ctl = pairs.filter(p => p.varied !== 'recognition')
    const outs = ts.filter((t): t is OutcomeTrial => t.kind === 'outcome')
    return {
      suite, regime, trials: ts.length,
      conviction: conv.length ? scoreConviction(conv) : null,
      pairs: { recognition: rec.length ? scorePairs(rec) : null, control: ctl.length ? scorePairs(ctl) : null },
      outcomes: outs.length ? rate(outs.filter(o => o.passed).length, outs.length) : null,
      calibration: calibration(ts), capFire: cap(ts), violations: ts.filter(t => t.violation).length,
    }
  })
  const both = ok.filter(t => rawCorrect(t) !== null && typeof t.clampedCorrect === 'boolean')
  return {
    scored: ok.length, rejected, groups, capFire: cap(ok),
    clampRescued: rate(both.filter(t => rawCorrect(t) === false && t.clampedCorrect === true).length, both.length),
    violations: ok.filter(t => t.violation).map(t => ({ id: t.id, violation: t.violation as string })),
  }
}

// ─── the pilot's five frozen success criteria ───────────────────────────────────────────────────────────────────────
export type CriterionStatus = 'pass' | 'fail' | 'not-evaluable'
export interface Criterion { id: 1 | 2 | 3 | 4 | 5; name: string; status: CriterionStatus; detail: string }

export interface PilotInput {
  /** Candidate and frozen baseline, scored on IDENTICAL trial ids (deterministic replay on identical rows). */
  candidate: Trial[]
  baseline: Trial[]
  /** Existing frozen benchmarks, before and after. Replace-only-if-better: none may regress. */
  frozenBenchmarks: Array<{ name: string; before: number; after: number }>
  /** Minimum scored trials for "zero violations" to mean anything. Set by the pack, never defaulted here. */
  minVolume: number
  resolvePacket?: (hash: string) => boolean
}

const recognitionPairs = (ts: Trial[]) => ts.filter((t): t is PairTrial => t.kind === 'pair' && t.varied === 'recognition')

export function evaluatePilot(p: PilotInput): { criteria: Criterion[]; verdict: 'pass' | 'fail' | 'void' | 'not-evaluable'; candidate: ExamReport; baseline: ExamReport } {
  const cand = scoreExam(p.candidate, p), base = scoreExam(p.baseline, p)
  const c: Criterion[] = []
  const ids = (ts: Trial[]) => ts.map(t => t.id).sort().join('\n')
  const cr = scorePairs(recognitionPairs(p.candidate.filter(t => !cand.rejected.some(r => r.id === t.id))))
  const br = scorePairs(recognitionPairs(p.baseline.filter(t => !base.rejected.some(r => r.id === t.id))))
  if (ids(p.candidate) !== ids(p.baseline)) c.push({ id: 1, name: 'beats the frozen hold/fold baseline', status: 'not-evaluable', detail: 'candidate and baseline were not scored on identical rows' })
  else if (cr.fullFlip.n === 0) c.push({ id: 1, name: 'beats the frozen hold/fold baseline', status: 'not-evaluable', detail: 'no recognition pairs scored' })
  else c.push({ id: 1, name: 'beats the frozen hold/fold baseline', status: (cr.fullFlip.rate as number) > (br.fullFlip.rate as number) ? 'pass' : 'fail',
    detail: `full flip ${cr.fullFlip.hits}/${cr.fullFlip.n} vs baseline ${br.fullFlip.hits}/${br.fullFlip.n}` })
  c.push(cand.scored < p.minVolume
    ? { id: 2, name: 'zero trait violations at meaningful volume', status: 'not-evaluable', detail: `${cand.scored} scored trials, below the required ${p.minVolume}` }
    : { id: 2, name: 'zero trait violations at meaningful volume', status: cand.violations.length === 0 ? 'pass' : 'fail', detail: `${cand.violations.length} violations in ${cand.scored} scored trials` })
  const regressed = p.frozenBenchmarks.filter(b => b.after < b.before)
  c.push(p.frozenBenchmarks.length === 0
    ? { id: 3, name: 'no regression on existing frozen benchmarks', status: 'not-evaluable', detail: 'no frozen benchmark results supplied' }
    : { id: 3, name: 'no regression on existing frozen benchmarks', status: regressed.length ? 'fail' : 'pass', detail: regressed.length ? `regressed: ${regressed.map(b => `${b.name} ${b.before} -> ${b.after}`).join(', ')}` : `${p.frozenBenchmarks.length} benchmarks, none regressed` })
  const noCal = cand.groups.filter(g => g.calibration.n === 0)
  c.push(cand.groups.length === 0 || noCal.length
    ? { id: 4, name: 'calibration per regime with denominators', status: 'not-evaluable', detail: cand.groups.length === 0 ? 'nothing scored' : `no calibration data for: ${noCal.map(g => `${g.suite}/${g.regime}`).join(', ')}` }
    : { id: 4, name: 'calibration per regime with denominators', status: 'pass', detail: cand.groups.map(g => `${g.suite}/${g.regime} n=${g.calibration.n} ece=${(g.calibration.ece as number).toFixed(3)}`).join('; ') })
  c.push(cand.capFire.n === 0 || cand.clampRescued.n === 0
    ? { id: 5, name: 'cap-fire rate journaled; pass not clamp-rescued', status: 'not-evaluable', detail: 'cap-fire or clamped results were not recorded' }
    : { id: 5, name: 'cap-fire rate journaled; pass not clamp-rescued', status: cand.clampRescued.hits === 0 ? 'pass' : 'fail', detail: `cap fired ${cand.capFire.hits}/${cand.capFire.n}; ${cand.clampRescued.hits}/${cand.clampRescued.n} trials pass only with the clamp` })
  const st = (id: number) => c.find(x => x.id === id)!.status
  const verdict = st(5) === 'fail' && [1, 2, 3, 4].every(i => st(i) === 'pass') ? 'void'
    : c.some(x => x.status === 'fail') ? 'fail' : c.some(x => x.status === 'not-evaluable') ? 'not-evaluable' : 'pass'
  return { criteria: c, verdict, candidate: cand, baseline: base }
}
