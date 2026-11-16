// Gate B, reproduced from the raw model outputs (nexus-llm/synthetic-intuition/gate-b-outputs.jsonl, on main via PR #444).
// Each completion is read by this harness's own adapter, not by the `action_classified` field the probe wrote, and scored by
// this harness. The test then checks the result against the probe's published summary, so the two readings are independent
// and must agree. It also pins three facts the raw outputs show that the summary does not carry.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readDeskRow } from './adapter'
import { rate, scorePairs, type PairHalf, type PairTrial } from './harness'

const dir = join(__dirname, '../../synthetic-intuition')
interface Row { id: string; pair_id: string; family: string; half: string; prompt: string; distance_bps: number; book_yes: [number, number]; expected_action: 'pass' | 'propose_yes' | 'propose_no'; output: string; action_classified: string; stated_p_yes: number | null }
const rows = readFileSync(join(dir, 'gate-b-outputs.jsonl'), 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as Row)
const summary = JSON.parse(readFileSync(join(dir, 'gate-b-summary.json'), 'utf8')) as { pairs_total: number; pairs_fully_correct_flip: number; rows_total: number; rows_correct: number; action_distribution: Record<string, number>; corrupt_rows: string[] }

const half = (r: Row): PairHalf => {
  const read = readDeskRow(r.prompt, r.output)
  return r.expected_action === 'pass' ? { expected: 'pass', act: read.act, side: read.side }
    : { expected: 'propose', expectedSide: r.expected_action === 'propose_yes' ? 'yes' : 'no', act: read.act, side: read.side }
}
const byPair = new Map<string, Row[]>()
for (const r of rows) byPair.set(r.pair_id, [...(byPair.get(r.pair_id) ?? []), r])
const trials: PairTrial[] = [...byPair.entries()].map(([id, [a, b]]) => ({ id, kind: 'pair', suite: 'conviction-vs-disproof', regime: a.family, clamp: 'off', varied: 'recognition', a: half(a), b: half(b) }))

describe('Gate B reproduced from raw outputs', () => {
  it('the pair file is what the probe says: 48 pairs, only the distance differs inside a pair', () => {
    expect(rows).toHaveLength(96)
    expect(byPair.size).toBe(48)
    for (const [a, b] of byPair.values()) {
      const strip = (p: string) => p.replace(/BTC is [+-]?[0-9.]+ bps/, 'BTC is <d> bps')
      expect(strip(a.prompt)).toBe(strip(b.prompt))
      expect(a.prompt).not.toBe(b.prompt)
    }
  })

  it('this harness reads the same headline numbers as the published summary', () => {
    const s = scorePairs(trials)
    expect(s.fullFlip).toMatchObject({ hits: summary.pairs_fully_correct_flip, n: summary.pairs_total })
    expect(s.fullFlip).toMatchObject({ hits: 0, n: 48 })
    expect(s.rowAccuracy).toMatchObject({ hits: summary.rows_correct, n: summary.rows_total })
    expect(s.proposeWhenExpected).toMatchObject({ hits: 0, n: 64 })
    expect(s.corruptProposals).toMatchObject({ hits: 8, n: 8 })
    expect(s.wrongDirection).toMatchObject({ hits: 8, n: 48 })
    // Row by row: the adapter's corrupt reads are exactly the rows the probe listed as corrupt, and every other row is a pass.
    const corrupt = rows.filter(r => readDeskRow(r.prompt, r.output).act === 'corrupt').map(r => r.id).sort()
    expect(corrupt).toEqual([...summary.corrupt_rows].sort())
    expect(rows.filter(r => readDeskRow(r.prompt, r.output).act === 'pass')).toHaveLength(summary.action_distribution.pass)
  })

  const edgeOf = (o: string) => { const m = /edge ([+-]?[0-9.]+)c/.exec(o); return m ? Number(m[1]) : null }
  const attempted = (r: Row) => readDeskRow(r.prompt, r.output).act !== 'pass'

  it('the act always matches the edge the model itself states, and passes state an edge in one narrow band', () => {
    const stated = rows.filter(r => edgeOf(r.output) !== null)
    expect(stated).toHaveLength(77)
    // 69 passes all state an edge under +0.5c; all 8 propose attempts state one at or above it.
    expect(stated.filter(r => !attempted(r) && (edgeOf(r.output) as number) < 0.5)).toHaveLength(69)
    expect(stated.filter(r => attempted(r) && (edgeOf(r.output) as number) >= 0.5)).toHaveLength(8)
    // The passes' stated edges sit between -2.9c and -1.3c across distances from 0.4 to 18.7 bps on both sides.
    const passEdges = stated.filter(r => !attempted(r)).map(r => edgeOf(r.output) as number)
    expect(Math.min(...passEdges)).toBe(-2.9)
    expect(Math.max(...passEdges)).toBe(-1.3)
  })

  it('the NO ask is invented: it matches the prompt book in 1 of 39 rows, while the YES ask matches in 42 of 42', () => {
    const count = { yes: [0, 0], no: [0, 0] }
    for (const r of rows) {
      const m = /(yes|no) ask ([0-9.]+)c/i.exec(r.output)
      if (!m) continue
      const side = m[1].toLowerCase() as 'yes' | 'no'
      const fromPrompt = side === 'yes' ? r.book_yes[1] : 100 - r.book_yes[0]
      count[side][1]++
      if (Number(m[2]) === fromPrompt) count[side][0]++
    }
    expect(count).toEqual({ yes: [42, 42], no: [1, 39] })
    expect(rate(1, 39).upper as number).toBeLessThan(0.14)
  })

  it('on the positive side the stated probability runs the wrong way: lower at a strong distance than a weak one in 11 of 16 pairs', () => {
    const pos = [...byPair.entries()].filter(([id]) => id.startsWith('gbm-pos')).map(([, hs]) => ({ strong: hs.find(h => h.half === 'strong') as Row, weak: hs.find(h => h.half === 'weak') as Row }))
    expect(pos).toHaveLength(16)
    expect(pos.filter(p => (p.strong.stated_p_yes as number) < (p.weak.stated_p_yes as number))).toHaveLength(11)
  })
})
