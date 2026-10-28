import { describe, expect, it } from 'vitest'
import { checkRows, loadRows, type CorpusRow } from './check-corpus'

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
})
