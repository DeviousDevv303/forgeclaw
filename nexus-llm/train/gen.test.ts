import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import snapshot from '../spec/tools.snapshot.json'
import { normalizePrompt } from '../exporter/export'
import { parseTranscript, validateTranscript, type ToolSchema } from '../src/grammar'
import { frozenPrompts } from '../eval/frozen-prompts'
import { canonicalEvidence } from '../eval/score'

describe('synthetic trace generator', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nexus-syn-'))
  const file = join(dir, 'syn.jsonl')
  execFileSync('npx', ['vite-node', 'nexus-llm/train/gen-synthetic-traces.ts', '--out', file, '--n', '400', '--seed', '3'], { stdio: 'pipe' })
  const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as { id: string; synthetic: boolean; prompt: string; text: string; kind: string })
  rmSync(dir, { recursive: true, force: true })
  const evalPrompts = frozenPrompts()
  const notEvidence = new Set(snapshot.notEvidenceTools)
  const tools = snapshot.tools as unknown as ToolSchema[]

  it('labels every row synthetic', () => { expect(rows.length).toBe(400); expect(rows.every(r => r.synthetic === true)).toBe(true) })
  it('filters against every frozen suite, not only v1', () => { expect(evalPrompts.size).toBeGreaterThan(84) })
  it('never contains a frozen-eval prompt', () => { expect(rows.filter(r => evalPrompts.has(normalizePrompt(r.prompt)))).toEqual([]) })
  it('every transcript parses strictly and satisfies the evidence rules', () => {
    for (const r of rows) expect(validateTranscript(parseTranscript(r.text), tools, new Set(snapshot.notEvidenceTools)), r.id).toEqual([])
  })
  it('covers every behaviour, capped per kind', () => {
    const kinds = new Set(rows.map(r => r.kind))
    expect(kinds.size).toBe(18)
    for (const k of kinds) expect(rows.filter(r => r.kind === k).length).toBeLessThanOrEqual(Math.ceil(400 / 18))
  })
  it('every evidence label is the canonical label for its steps (never hand-written)', () => {
    for (const r of rows) {
      const t = parseTranscript(r.text)
      const steps = t.steps.map(s => ({ name: s.call.name, args: s.call.arguments, status: s.result.status, text: s.result.text }))
      expect(t.evidence, r.id).toBe(canonicalEvidence(steps, notEvidence)[0])
    }
  })
  it('trading is propose-only: no trace claims an order or bet was placed, and a proposal is never verified on its own', () => {
    const trading = rows.filter(r => ['propose', 'owner_only', 'funds_status', 'kalshi_read', 'owner_prices', 'settle', 'price_trap'].includes(r.kind))
    expect(trading.length).toBeGreaterThan(0)
    for (const r of trading) {
      const t = parseTranscript(r.text)
      expect(t.answer.toLowerCase(), r.id).not.toMatch(/was placed|has been placed|order placed|bet placed|i placed|placed your/)
      if (t.steps.length === 1 && t.steps[0].call.name === 'funds_propose') expect(t.evidence, r.id).not.toBe('verified')
    }
    expect(rows.filter(r => r.kind === 'price_trap').every(r => !/\$0\.|\d%/.test(parseTranscript(r.text).answer))).toBe(true)
  })
})
