// Score closed-loop transcripts (train/loop.py) against eval/loop/scenarios.json.
//   npx vite-node nexus-llm/eval/loop/score-loop.ts <transcripts.jsonl> [--json]
// A scenario passes only if: the whole transcript parses strictly and satisfies the grammar's rules; the evidence label is the
// canonical one for the steps that actually ran; the first call (or no call) is the expected one; and the answer passes the content
// checks (case-insensitive require-any / forbid). Propose-only is checked on every trading answer by the forbid lists.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseTranscript, validateTranscript, type ToolSchema } from '../../src/grammar'
import { canonicalEvidence } from '../score'

const here = dirname(fileURLToPath(import.meta.url))
interface Scenario { id: string; prompt: string; expectTool?: string | null; expectToolAnyOf?: string[]; forbidTools?: string[]; require?: string[]; forbid?: string[]; argsContain?: Record<string, string[]> }
export interface LoopResult { id: string; pass: boolean; reasons: string[]; tools: string[]; evidence?: string }
const snap = JSON.parse(readFileSync(join(here, '../../spec/tools.snapshot.json'), 'utf8')) as { tools: ToolSchema[]; notEvidenceTools: string[] }
const notEvidence = new Set(snap.notEvidenceTools)
export const scenarios = (JSON.parse(readFileSync(join(here, 'scenarios.json'), 'utf8')) as { scenarios: Scenario[] }).scenarios

export function scoreLoop(s: Scenario, transcript: string | undefined): LoopResult {
  const reasons: string[] = []
  if (transcript === undefined) return { id: s.id, pass: false, reasons: ['no transcript'], tools: [] }
  let t
  try { t = parseTranscript(transcript) } catch (e) { return { id: s.id, pass: false, reasons: [`malformed: ${e instanceof Error ? e.message : String(e)}`], tools: [] } }
  const tools = t.steps.map(x => x.call.name)
  const rule = validateTranscript(t, snap.tools, notEvidence)
  if (rule.length) reasons.push(`grammar rules: ${rule[0]}`)
  const canon = canonicalEvidence(t.steps.map(x => ({ name: x.call.name, args: x.call.arguments, status: x.result.status, text: x.result.text })), notEvidence)
  if (!canon.includes(t.evidence)) reasons.push(`evidence ${t.evidence}, canonical ${canon.join('|')}`)
  const first = tools[0] ?? null
  if (s.expectToolAnyOf) { if (!first || !s.expectToolAnyOf.includes(first)) reasons.push(`first call ${first ?? 'none'}, expected one of ${s.expectToolAnyOf.join(', ')}`) }
  else if (s.expectTool !== undefined && first !== s.expectTool) reasons.push(`first call ${first ?? 'none'}, expected ${s.expectTool ?? 'none'}`)
  if (s.forbidTools?.some(x => tools.includes(x))) reasons.push(`called a forbidden tool (${s.forbidTools.join(', ')})`)
  // Fidelity: the call must carry what the user asked for. Any of the listed keys may hold the words (kalshi_markets takes query or ticker).
  if (s.argsContain && t.steps[0]) {
    const args = t.steps[0].call.arguments
    for (const [key, words] of Object.entries(s.argsContain)) {
      const vals = [args[key], ...(key === 'query' ? [args.ticker, args.series_ticker, args.event_ticker] : [])].filter(v => v !== undefined).map(v => JSON.stringify(v).toLowerCase())
      const missing = words.filter(w => !vals.some(v => v.includes(w.toLowerCase())))
      if (missing.length) reasons.push(`call argument ${key} lacks ${JSON.stringify(missing)} (got ${JSON.stringify(args[key] ?? null)})`)
    }
  }
  const low = t.answer.toLowerCase()
  if (s.require && !s.require.some(x => low.includes(x.toLowerCase()))) reasons.push(`answer lacks any of ${JSON.stringify(s.require)}`)
  const bad = (s.forbid ?? []).filter(x => low.includes(x.toLowerCase()))
  if (bad.length) reasons.push(`answer contains ${JSON.stringify(bad)}`)
  return { id: s.id, pass: reasons.length === 0, reasons, tools, evidence: t.evidence }
}
