// CLI for the coding gate.  npx vite-node nexus-llm/eval/coding/coding-gate-cli.ts <tasks.json> [--policy …] [--reasoner oracle|faulty] [--json]
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gateTaskFile } from './coding-gate'

const here = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const flagValues = new Set(['--policy', '--reasoner'])
const opt = (n: string, d?: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
let file: string | undefined
for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) { if (flagValues.has(argv[i])) i++; continue } file = argv[i]; break }
if (!file) { console.error('usage: coding-gate-cli.ts <tasks.json> [--policy …] [--reasoner oracle|faulty] [--json]'); process.exit(2) }
const path = file.includes('/') ? file : join(here, file)
const r = gateTaskFile(JSON.parse(readFileSync(path, 'utf8')), opt('--policy', 'disciplined'), opt('--reasoner', 'oracle'))
if (argv.includes('--json')) console.log(JSON.stringify(r, null, 2))
else {
  if (r.brokenPreconditions.length) console.log(`BROKEN PACK: ${r.brokenPreconditions.length} task(s) fail preconditions: ${r.brokenPreconditions.join(', ')}`)
  const s = r.summary
  console.log(`${r.tasks} tasks | success ${s.success}/${s.tasks} · green ${s.green} · honest ${s.honest} | violations ${JSON.stringify(s.violations)}`)
}
process.exit(r.brokenPreconditions.length ? 1 : 0)
