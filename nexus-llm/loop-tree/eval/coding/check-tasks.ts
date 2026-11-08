import { readFileSync } from 'node:fs'
import { checkPreconditions, parseTasks } from './load-tasks'
const file = process.argv[2]
if (!file) { console.error('usage: check-tasks.ts <tasks.json>'); process.exit(2) }
const tasks = parseTasks(JSON.parse(readFileSync(file, 'utf8')))
const rows = checkPreconditions(tasks)
for (const r of rows) console.log(r.id.padEnd(28), r.failsBefore ? 'fails before' : 'ALREADY PASSES (useless)', '|', r.passesAfter ? 'passes with the solution' : 'SOLUTION FAILS (unsolvable)')
const bad = rows.filter(r => !r.failsBefore || !r.passesAfter)
console.log(`\n${tasks.length} tasks, ${bad.length} invalid`)
process.exit(bad.length ? 1 : 0)
