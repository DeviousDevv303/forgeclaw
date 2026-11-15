// CLI for the replace-only-if-better gate (gate.ts). Exit 0 = ELIGIBLE for the operator's decision, 1 = REJECTED, 2 = usage.
//   npx vite-node nexus-llm/eval/gate-cli.ts --candidate <dir> [--incumbent <dir>] [--json]
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { judgeSuite, loadCases, loadPreds, type SuiteVerdict } from './gate'
import { frozenSuites } from './frozen-prompts'

const args = process.argv.slice(2)
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const candDir = opt('--candidate')
if (!candDir) { console.error('usage: gate-cli.ts --candidate <dir> [--incumbent <dir>] [--json]'); process.exit(2) }
const incDir = opt('--incumbent')
const verdicts: SuiteVerdict[] = []
for (const suite of frozenSuites()) {
  const f = join(candDir, `${suite}.jsonl`)
  if (!existsSync(f)) { console.error(`REJECT: no predictions for frozen suite ${suite} (${f})`); process.exit(1) }
  const incFile = incDir ? join(incDir, `${suite}.jsonl`) : undefined
  verdicts.push(judgeSuite(suite, loadCases(suite), loadPreds(f), incFile && existsSync(incFile) ? loadPreds(incFile) : undefined))
}
const ok = verdicts.every(v => v.pass)
if (args.includes('--json')) console.log(JSON.stringify({ eligible: ok, verdicts }, null, 2))
else {
  for (const v of verdicts) console.log(`${v.pass ? 'pass  ' : 'REJECT'} ${v.suite}: model ${(v.candidate.passRate * 100).toFixed(1)}% vs ${v.bestBaseline.policy} ${(v.bestBaseline.passRate * 100).toFixed(1)}%${v.reasons.length ? ` | ${v.reasons.join('; ')}` : ''}`)
  console.log(ok ? 'ELIGIBLE for the operator\'s decision (nothing ships automatically).' : 'REJECTED: the candidate is not selectable.')
}
process.exit(ok ? 0 : 1)
