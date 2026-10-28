import { describe, expect, it } from 'vitest'
import { checkRows, loadRows, type CorpusRow } from './check-corpus'
import { attachToPrompt, CONTEXT_BUDGET_CHARS, contextForPrompt, formatContext, rowToContextLine, scoreRow, selectForPrompt, terms } from './attach'

describe('verified-troubleshooting corpus', () => {
  const rows = loadRows()
  it('has rows, and they are clean (unadmitted + each anchor present on the current tree)', () => {
    expect(rows.length).toBeGreaterThan(0)
    expect(checkRows(rows)).toEqual([])
  })
  it('nothing is self-admitted', () => { for (const r of rows) expect(r.admitted).toBe(false) })
  it('rejects the ways a relay row tries to sneak in', () => {
    const base = rows[0]
    const bad: Array<[Partial<CorpusRow>, RegExp]> = [
      [{ admitted: true }, /admitted must be false/],
      [{ anchor: { path: 'src/lib/toolOutcome.ts', needle: 'this string is not in the file at all zzzz' } }, /anchor needle not present/],
      [{ anchor: { path: 'src/lib/does-not-exist.ts', needle: 'x' } }, /anchor file not found/],
      [{ artifact: { type: 'commit', ref: 'not-a-sha', verifiedAt: '2026-10-28' } }, /not a sha/],
      [{ provenance: { source: '', url: '' } }, /provenance/],
    ]
    for (const [patch, re] of bad) {
      const errs = checkRows([{ ...base, ...patch, id: 'probe' } as CorpusRow])
      expect(errs.join('\n'), JSON.stringify(patch)).toMatch(re)
    }
  })

  describe('admitted corpus attaches as bounded, masked context (not weights)', () => {
    const admit = (r: CorpusRow): CorpusRow => ({ ...r, admitted: true })
    it('formats only ADMITTED rows, each with its evidence tag', () => {
      const ctx = formatContext(rows.map(admit))
      expect(ctx).toContain('[')
      expect(ctx).toMatch(/PR #\d+|code:|commit:/)
      // an un-admitted row (as in the seed) must never appear, even if selection passes it in
      expect(formatContext(rows)).toBe('')
    })
    it('never exceeds the budget; drops rows that do not fit', () => {
      const many = Array.from({ length: 200 }, (_, i) => admit({ ...rows[0], id: `r${i}`, symptom: 'S'.repeat(40), fix: 'F'.repeat(40) }))
      const ctx = formatContext(many)
      expect(ctx.length).toBeLessThanOrEqual(CONTEXT_BUDGET_CHARS)
      expect(ctx.split('\n').length).toBeLessThan(many.length)
    })
    it('attaches ahead of the User: frame, leaving the task intact', () => {
      const ctx = formatContext([admit(rows[0])])
      const full = attachToPrompt(ctx, 'fix the waiter')
      expect(full).toContain('Context (verified')
      expect(full.endsWith('User: fix the waiter\n')).toBe(true)
      expect(attachToPrompt('', 'hi')).toBe('User: hi\n')
    })
    it('a context line carries symptom, fix and evidence', () => {
      const line = rowToContextLine(admit(rows[0]))
      expect(line).toMatch(/->/); expect(line).toMatch(/\[.+\]$/)
    })
  })

  describe('retrieval: select the admitted rows relevant to a prompt', () => {
    const admit = (r: CorpusRow): CorpusRow => ({ ...r, admitted: true })
    const admitted = rows.map(admit)
    it('terms drops stopwords and short tokens', () => {
      expect(terms('How do I fix the waiter deadline?')).toEqual(new Set(['fix', 'waiter', 'deadline']))
    })
    it('selects only positive-overlap admitted rows, best first, and never an un-admitted row', () => {
      const waiter = admitted.find(r => r.id === 'ct-waiter-deadline')!
      const sel = selectForPrompt('the run waiter reported not found at the deadline', admitted)
      expect(sel[0].id).toBe('ct-waiter-deadline')
      expect(scoreRow(terms('waiter deadline'), waiter)).toBeGreaterThan(0)
      // an un-admitted copy of a matching row is filtered out
      expect(selectForPrompt('waiter deadline', rows)).toEqual([])
    })
    it('attaches nothing for an unrelated prompt (no irrelevant fact injected to fill the budget)', () => {
      expect(selectForPrompt('what is the capital of France', admitted)).toEqual([])
      expect(contextForPrompt('what is the capital of France', admitted)).toBe('User: what is the capital of France\n')
    })
    it('contextForPrompt attaches the matched fact ahead of the task', () => {
      const full = contextForPrompt('fix the kalshi fee estimate', admitted)
      expect(full).toContain('Context (verified')
      expect(full).toMatch(/fee/i)
      expect(full.endsWith('User: fix the kalshi fee estimate\n')).toBe(true)
    })
    it('honors k', () => { expect(selectForPrompt('waiter deadline guardian block fee kalshi', admitted, 1).length).toBeLessThanOrEqual(1) })
  })
})
