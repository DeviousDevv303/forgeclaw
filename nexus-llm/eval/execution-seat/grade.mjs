// Grades one dispatch artifact with the execution checks X1..X8 (src/lib/nursery/executionChecks.ts).
// Usage: node --experimental-strip-types grade.mjs <packet.json>   -> prints the check results as JSON.
// The harness writes packet.json; this script only reads it. It never writes, never calls a model, wires nothing.
import { readFileSync } from 'node:fs'
import { runExecutionChecks } from '../../../src/lib/nursery/executionChecks.ts'

const packet = JSON.parse(readFileSync(process.argv[2], 'utf8'))
process.stdout.write(JSON.stringify(runExecutionChecks(packet), null, 1) + '\n')
