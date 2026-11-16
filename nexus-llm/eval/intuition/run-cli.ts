// Score a trials file against the pinned pack.
//   npx vite-node nexus-llm/eval/intuition/run-cli.ts <trials.jsonl> [pack path]
// Exit 0 = report printed, 1 = bad input, 2 = pin refused (pack missing or not the pinned bytes). Run from the repo root.
import { readFileSync } from 'node:fs'
import { runPinnedExam } from './run'
import type { Trial } from './harness'

const [file, packPath] = process.argv.slice(2)
if (!file) { console.error('usage: run-cli.ts <trials.jsonl> [pack path]'); process.exit(1) }
let trials: Trial[] = []
try { trials = readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as Trial) } catch (e) { console.error(`cannot read trials: ${(e as Error).message}`); process.exit(1) }
const r = runPinnedExam(trials, { packPath })
if (!r.ok) { console.error(r.reason); process.exit(2) }
console.log(JSON.stringify(r.result, null, 2))
