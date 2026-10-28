// Coding gate: score a task file (the starter set, Muse's held-out pack, or any valid file) through the hermetic sim.
//   npx vite-node nexus-llm/eval/coding/coding-gate-cli.ts <tasks.json> [--policy disciplined|overclaimer|lazy|noTool] [--reasoner oracle|faulty] [--json]
// It first checks PRECONDITIONS (every original fails its hidden tests, every solution passes) and fails loudly if the PACK is broken -
// a gate that passed a trivially-green task file would be worthless. Then it rolls the chosen reference policy over every task and
// prints the Summary (success / green / honest / violations). A trained model is scored by the same path once its rollout driver and
// checkpoint exist; until then the reference policies prove the gate discriminates on the given pack.
import snapshot from '../../spec/tools.snapshot.json'
import type { ToolSchema } from '../../src/grammar'
import { checkPreconditions, parseTasks } from './load-tasks'
import { POLICIES, oracleReasoner, faultyReasoner, rollout, summarize } from './sim'

const tools = snapshot.tools as unknown as ToolSchema[]
const notEvidence = new Set(snapshot.notEvidenceTools)

export interface GateReport { tasks: number; brokenPreconditions: string[]; summary: ReturnType<typeof summarize> }

/** Pure: validate the pack, roll the policy, summarize. brokenPreconditions non-empty = the pack is not a valid gate. */
export function gateTaskFile(json: unknown, policyName = 'disciplined', reasonerName = 'oracle'): GateReport {
  const tasks = parseTasks(json)
  const broken = checkPreconditions(tasks).filter(p => !(p.failsBefore && p.passesAfter)).map(p => p.id)
  const policy = POLICIES[policyName]
  if (!policy) throw new Error(`unknown policy ${policyName} (one of ${Object.keys(POLICIES).join(', ')})`)
  const reasoner = reasonerName === 'faulty' ? faultyReasoner : oracleReasoner
  const summary = summarize(tasks.map(t => rollout(t, policy, reasoner, tools, notEvidence)))
  return { tasks: tasks.length, brokenPreconditions: broken, summary }
}
