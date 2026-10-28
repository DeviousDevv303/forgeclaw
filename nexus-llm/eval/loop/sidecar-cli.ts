// stdin/stdout JSON-lines server for tools-sidecar.ts.  npx vite-node nexus-llm/eval/loop/sidecar-cli.ts [--dispatch-log <file>]
import { createInterface } from 'node:readline'
import { run, setDispatchLog } from './tools-sidecar'

const argv = process.argv.slice(2)
setDispatchLog(argv.includes('--dispatch-log') ? argv[argv.indexOf('--dispatch-log') + 1] : undefined)
const rl = createInterface({ input: process.stdin })
rl.on('line', line => {
  let reply: { status: string; text: string }
  try { const r = JSON.parse(line) as { session: string; name: string; arguments: Record<string, unknown> }; reply = run(r.session, r.name, r.arguments ?? {}) }
  catch (e) { reply = { status: 'error', text: `[TOOL ERROR] harness: ${e instanceof Error ? e.message : String(e)}` } }
  process.stdout.write(JSON.stringify(reply) + '\n')
})
