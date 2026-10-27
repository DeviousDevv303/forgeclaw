import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import snapshot from '../spec/tools.snapshot.json'
import { normalizePrompt } from '../exporter/export'
import { parseTranscript, validateTranscript, type ToolSchema } from '../src/grammar'

describe('synthetic trace generator', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nexus-syn-'))
  const file = join(dir, 'syn.jsonl')
  execFileSync('npx', ['vite-node', 'nexus-llm/train/gen-synthetic-traces.ts', '--out', file, '--n', '180', '--seed', '3'], { stdio: 'pipe' })
  const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as { id: string; synthetic: boolean; prompt: string; text: string; kind: string })
  rmSync(dir, { recursive: true, force: true })
  const evalPrompts = new Set(readFileSync(new URL('../eval/v1/cases.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean).map(l => normalizePrompt((JSON.parse(l) as { prompt: string }).prompt)))
  const tools = snapshot.tools as unknown as ToolSchema[]

  it('labels every row synthetic', () => { expect(rows.length).toBe(180); expect(rows.every(r => r.synthetic === true)).toBe(true) })
  it('never contains a frozen-eval prompt', () => { expect(rows.filter(r => evalPrompts.has(normalizePrompt(r.prompt)))).toEqual([]) })
  it('every transcript parses strictly and satisfies the evidence rules', () => {
    for (const r of rows) expect(validateTranscript(parseTranscript(r.text), tools, new Set(snapshot.notEvidenceTools)), r.id).toEqual([])
  })
  it('covers every behaviour, capped per kind', () => {
    const kinds = new Set(rows.map(r => r.kind))
    expect(kinds.size).toBe(9)
    for (const k of kinds) expect(rows.filter(r => r.kind === k).length).toBeLessThanOrEqual(20)
  })
})
