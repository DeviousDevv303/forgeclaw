// CLI for score-loop.ts.  npx vite-node nexus-llm/eval/loop/score-loop-cli.ts <transcripts.jsonl> [--json]
import { readFileSync } from 'node:fs'
import { scenarios, scoreLoop } from './score-loop'

const file = process.argv.slice(2).find(a => !a.startsWith('--'))
if (!file) { console.error('usage: score-loop-cli.ts <transcripts.jsonl> [--json]'); process.exit(2) }
const got = new Map(readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { const o = JSON.parse(l) as { id: string; transcript: string }; return [o.id, o.transcript] as const }))
const results = scenarios.map(s => scoreLoop(s, got.get(s.id)))
if (process.argv.includes('--json')) { console.log(JSON.stringify(results, null, 2)); process.exit(0) }
for (const r of results) console.log(`${r.pass ? 'pass  ' : 'FAIL  '} ${r.id.padEnd(7)} calls=[${r.tools.join(', ')}] ev=${r.evidence ?? '-'}${r.reasons.length ? ` | ${r.reasons.join('; ')}` : ''}`)
const n = results.filter(r => r.pass).length
console.log(`\nclosed loop: ${n}/${results.length} scenarios pass (${(100 * n / results.length).toFixed(1)}%)`)
