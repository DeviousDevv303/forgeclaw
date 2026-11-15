// Round 3, arm (ii): run the merged REVIEWER reality checks (src/lib/nursery/reviewerChecks.ts, PR #357) over the nine frozen
// REVIEWER v1 rows and print their results as JSON. Packet and resolver construction mirror reviewerChecks.test.ts.
import { readFileSync } from 'node:fs'
import { runReviewerChecks, type RefResolver, type ReviewPacket } from '../../../../src/lib/nursery/reviewerChecks'

interface Row { fixture: string; input: Record<string, unknown> }
const rows: Row[] = readFileSync('nexus-llm/eval/reviewer-v1/reviewer-fixtures.jsonl', 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
const packet = (input: Record<string, unknown>): ReviewPacket => {
  const rendered = Object.fromEntries(Object.entries(input).filter(([k, v]) => k.startsWith('rendered') && typeof v === 'string')) as Record<string, string>
  return { claims: input.claims as string[], diff: input.diff as string | undefined, facts: input.facts as Record<string, unknown> | undefined,
    code: input.code as string | undefined, rendered: Object.keys(rendered).length ? rendered : undefined }
}
const resolver = (input: Record<string, unknown>): RefResolver | undefined => {
  const table = (input.resolver_table as Record<string, unknown> | undefined)?.['per-comment lookups'] as Record<string, string> | undefined
  if (!table) return undefined
  return id => table[id] === 'exists' ? 'exists' : /404/.test(table[id] ?? '') ? 'missing' : 'unknown'
}
console.log(JSON.stringify(Object.fromEntries(rows.map(r => [r.fixture, runReviewerChecks(packet(r.input), resolver(r.input))]))))
