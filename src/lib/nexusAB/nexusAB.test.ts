import { describe, expect, it } from 'vitest'
import { AB_CASES } from './cases'
import { ArmIsolationError, renderReport, runExperiment, summarize, type Ask } from './harness'
import { signTestP, wilson } from './stats'

const byId = Object.fromEntries(AB_CASES.map(c => [c.id, c]))
const COMPLIANT: Record<string, string> = {
  'tldr-first-line': 'TL;DR: Buckets chain or probe.\nMore detail follows.',
  'sign-off-line': 'Cats nap in sun.\n— ForgeClaw',
  'forty-words': 'Your browser resolves DNS, opens a connection, sends the request, and renders the reply.',
  'numbered-only': '1. Blue light delays melatonin.\n2. Scrolling keeps the mind alert.',
  'all-lowercase': 'stretch first. pace yourself. rest between runs.',
  'no-the-word': 'The Pacific is the largest ocean on Earth.',
}
const NONCOMPLIANT: Record<string, string> = {
  'tldr-first-line': 'A hash table uses buckets.',
  'sign-off-line': 'Cats nap in sun.',
  'forty-words': Array.from({ length: 80 }, () => 'word').join(' '),
  'numbered-only': 'Because blue light delays melatonin.',
  'all-lowercase': 'Stretch First.',
  'no-the-word': 'The Pacific is very large.',
}
const system = 'You are ForgeClaw.'

/** A model that follows a rule exactly when the rule is in what it was sent. */
const obedient: Ask = async ({ arm, kase }) => {
  const sent = `${system}${arm === 'on' ? `\n${kase.rule}` : ''}\n${kase.task}`
  return { sent, answer: (arm === 'on' ? COMPLIANT : NONCOMPLIANT)[kase.id] }
}
/** A model that ignores the guidance entirely. */
const deaf: Ask = async ({ arm, kase }) => ({ sent: `${system}${arm === 'on' ? `\n${kase.rule}` : ''}\n${kase.task}`, answer: NONCOMPLIANT[kase.id] })

describe('the cases are well formed', () => {
  it('pass on a compliant answer, fail on a non-compliant one, and never mention the rule in the task', () => {
    for (const kase of AB_CASES) {
      expect(kase.check(COMPLIANT[kase.id]), kase.id).toBe(true)
      expect(kase.check(NONCOMPLIANT[kase.id]), kase.id).toBe(false)
      expect(kase.task.includes(kase.rule), kase.id).toBe(false)
    }
    expect(byId['all-lowercase'].check('')).toBe(false)
  })
})

describe('statistics', () => {
  it('exact sign test', () => {
    expect(signTestP(0, 0)).toBe(1)
    expect(signTestP(12, 0)).toBeCloseTo(2 / 4096, 6)
    expect(signTestP(5, 5)).toBe(1)
    expect(signTestP(9, 3)).toBeCloseTo(0.146, 3)
  })
  it('Wilson interval stays in 0..1 and widens at small n', () => {
    expect(wilson(0, 0)).toEqual({ low: 0, high: 1 })
    const small = wilson(3, 3), large = wilson(30, 30)
    expect(small.high).toBeLessThanOrEqual(1)
    expect(small.low).toBeLessThan(large.low)
  })
})

describe('the experiment', () => {
  it('reports an improvement when the guidance changes the answers', async () => {
    const s = summarize(await runExperiment({ reps: 2, ask: obedient }))
    expect(s.off.rate).toBe(0)
    expect(s.on.rate).toBe(1)
    expect(s.pairs).toBe(12)
    expect(s.verdict).toBe('guidance improved rule compliance')
  })
  it('says "no demonstrable effect" when the model ignores the guidance', async () => {
    const s = summarize(await runExperiment({ reps: 2, ask: deaf }))
    expect(s.onOnly + s.offOnly).toBe(0)
    expect(s.verdict).toMatch(/^no demonstrable effect/)
  })
  it('refuses to give a verdict on too little data', async () => {
    const s = summarize(await runExperiment({ reps: 1, cases: [AB_CASES[0]], ask: obedient }))
    expect(s.verdict).toMatch(/^insufficient data/)
  })
  it('detects guidance that never reached the payload instead of reporting a null result', async () => {
    const lost: Ask = async ({ kase }) => ({ sent: `${system}\n${kase.task}`, answer: NONCOMPLIANT[kase.id] })
    await expect(runExperiment({ reps: 1, ask: lost })).rejects.toBeInstanceOf(ArmIsolationError)
  })
  it('detects an off arm that already carries the rule', async () => {
    const leaky: Ask = async ({ kase }) => ({ sent: `${kase.rule}\n${kase.task}`, answer: COMPLIANT[kase.id] })
    await expect(runExperiment({ reps: 1, ask: leaky })).rejects.toBeInstanceOf(ArmIsolationError)
  })
  it('excludes failed calls from the numbers and redacts their messages', async () => {
    let calls = 0
    const flaky: Ask = async request => {
      if (calls++ === 1) throw new Error('401 for key sk-secret-123')
      return obedient(request)
    }
    const trials = await runExperiment({ reps: 1, ask: flaky, redact: t => t.replace(/sk-[\w-]+/g, '[redacted]') })
    const s = summarize(trials)
    expect(s.errors).toBe(1)
    expect(s.pairs).toBe(AB_CASES.length - 1)
    expect(JSON.stringify(trials)).not.toContain('sk-secret')
  })
  it('flags cases the unguided model already passes', async () => {
    const already: Ask = async ({ arm, kase }) => ({ sent: `${arm === 'on' ? kase.rule : ''}${kase.task}`, answer: COMPLIANT[kase.id] })
    const s = summarize(await runExperiment({ reps: 2, ask: already }))
    expect(s.perCase.every(c => c.nonDiscriminating)).toBe(true)
  })
  it('renders a report with the verdict and per-case rows', async () => {
    const report = renderReport('stub', 'm', summarize(await runExperiment({ reps: 2, ask: obedient })), { reps: 2, ranAt: '2026-10-26' })
    expect(report).toContain('## stub · m')
    expect(report).toContain('guidance improved rule compliance')
    expect(report).toContain('| tldr-first-line |')
  })
})
