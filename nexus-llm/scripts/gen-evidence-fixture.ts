// Ground truth for the evidence rules, taken from validateTranscript itself, so train/constrain.py (Python) cannot drift from
// src/grammar.ts unnoticed. Every route x step-combination over an evidence tool, a non-evidence tool, ok and error results.
//   npx vite-node nexus-llm/scripts/gen-evidence-fixture.ts [--check]
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EVIDENCE, validateTranscript, type Evidence, type ToolSchema, type Transcript } from '../src/grammar'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const snap = JSON.parse(readFileSync(join(root, 'spec/tools.snapshot.json'), 'utf8')) as { tools: ToolSchema[]; notEvidenceTools: string[] }
const notEvidence = new Set(snap.notEvidenceTools)
const step = (name: string, status: 'ok' | 'error') => ({ call: { name, arguments: name === 'github_read_file' ? { path: 'README.md' } : { task: 'x' } }, result: { status, text: 'r' } })
const atoms = [step('github_read_file', 'ok'), step('github_read_file', 'error'), step('deepseek_reason', 'ok'), step('deepseek_reason', 'error')]
const combos: Array<typeof atoms> = [[]]
for (const a of atoms) combos.push([a])
for (const a of atoms) for (const b of atoms) combos.push([a, b])
const rows: Array<{ route: string; steps: Array<[string, string]>; allowed: Evidence[] }> = []
for (const route of ['tool', 'direct', 'defer'] as const) for (const steps of combos) {
  if ((route === 'tool') !== (steps.length > 0)) continue
  const allowed = EVIDENCE.filter(ev => validateTranscript({ route, steps, evidence: ev, answer: 'x' } as Transcript, snap.tools, notEvidence).filter(e => !e.startsWith('step ')).length === 0)
  rows.push({ route, steps: steps.map(s => [s.call.name, s.result.status]), allowed })
}
const text = JSON.stringify({ source: 'validateTranscript (nexus-llm/src/grammar.ts)', rows }, null, 1) + '\n'
const out = join(root, 'spec/fixtures/evidence-rules.json')
if (process.argv.includes('--check')) { const ok = existsSync(out) && readFileSync(out, 'utf8') === text; console.log(ok ? `evidence rules current (${rows.length} rows)` : 'STALE: spec/fixtures/evidence-rules.json'); process.exit(ok ? 0 : 1) }
writeFileSync(out, text)
console.log(`wrote ${rows.length} rows`)
