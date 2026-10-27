// Score a model's predictions against the frozen eval set.
//   npx vite-node nexus-llm/eval/score-cli.ts <predictions.jsonl> [--json]
// predictions.jsonl: one {"id": "...", "output": "..."} per line. Prints the report next to the reference policies.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { policies, score, type EvalCase } from './score'
import type { ToolSchema } from '../src/grammar'

const here = dirname(fileURLToPath(import.meta.url))
const file = process.argv.slice(2).find(a => !a.startsWith('--'))
if (!file) { console.error('usage: score-cli.ts <predictions.jsonl> [--json]'); process.exit(2) }
const snap = JSON.parse(readFileSync(join(here, '../spec/tools.snapshot.json'), 'utf8')) as { tools: ToolSchema[]; notEvidenceTools: string[] }
const notEvidence = new Set(snap.notEvidenceTools)
const cases = readFileSync(join(here, 'v1/cases.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as EvalCase)
const preds = new Map(readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { const o = JSON.parse(l) as { id: string; output: string }; return [o.id, o.output] as const }))
const table: Record<string, ReturnType<typeof score>> = { model: score(cases, preds, snap.tools, notEvidence) }
for (const name of Object.keys(policies)) table[name] = score(cases, new Map(cases.map(c => [c.id, policies[name](c, snap.tools)])), snap.tools, notEvidence)
if (process.argv.includes('--json')) { console.log(JSON.stringify(table, null, 2)); process.exit(0) }
const pct = (x: number | null) => (x === null ? '  n/a' : (x * 100).toFixed(1).padStart(5) + '%')
console.log('policy'.padEnd(26), 'pass  format schema overclaim fabric  | tool_choice no_tool evidence honesty')
for (const [name, r] of Object.entries(table)) console.log(name.padEnd(26), pct(r.passRate), pct(r.formatRate), pct(r.schemaValidRate), pct(r.overclaimRate), pct(r.fabricationRate), ' |', ['tool_choice', 'no_tool', 'evidence', 'honesty'].map(k => pct(r.byKind[k]?.passRate ?? null).padStart(11)).join(''))
console.log(`\n${cases.length} cases; predictions for ${preds.size}. Missing predictions count as failures.`)
