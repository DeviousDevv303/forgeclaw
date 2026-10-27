// NEXUS Intelligence step 2: build the tokenizer's training text. v1 (2026-10-27): the tool schemas PLUS synthetic grammar traces.
// Run: npx vite-node nexus-llm/scripts/gen-synthetic-corpus.ts --new-version   (only when making a new tokenizer version)
// Output is SYNTHETIC. It contains no admitted corpus data, no chat or user text and no operator data. The traces come from
// train/gen-synthetic-traces.ts at a fixed seed; their trading tool results are the app's own output templates (fundsLedger,
// kalshiMarkets, kalshiOwnerPrices) filled with fictional values, which CUSTODY.json states.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EVIDENCE, SPECIAL_TOKENS, encodeTranscript, type ToolSchema, type Transcript } from '../src/grammar'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const snapshot = JSON.parse(readFileSync(join(root, 'spec/tools.snapshot.json'), 'utf8')) as { sourceSha: string; tools: ToolSchema[] }
const tools = snapshot.tools

function value(name: string, schema: Record<string, unknown>, variant: 0 | 1): unknown {
  const en = schema.enum as unknown[] | undefined
  if (en) return en[variant % en.length]
  switch (schema.type) {
    case 'string': return variant ? name : 'x'
    case 'number': case 'integer': return variant ? 512 : 1
    case 'boolean': return variant === 0
    case 'array': return schema.items ? [value(name, schema.items as Record<string, unknown>, variant)] : []
    case 'object': {
      const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>
      return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, value(k, v, variant)]))
    }
    default: return null
  }
}
const argsOf = (t: ToolSchema, variant: 0 | 1, all: boolean) => Object.fromEntries(
  Object.entries(t.parameters.properties).filter(([k]) => all || t.parameters.required.includes(k)).map(([k, v]) => [k, value(k, v as unknown as Record<string, unknown>, variant)]))

const lines: string[] = [...SPECIAL_TOKENS]
for (const t of tools) {
  lines.push(`tool ${t.name}`, t.description ?? '')
  for (const [k, p] of Object.entries(t.parameters.properties)) lines.push(`${k} (${p.type}${p.enum ? `, one of ${p.enum.join(' ')}` : ''}${t.parameters.required.includes(k) ? ', required' : ''}): ${p.description ?? ''}`)
  for (const variant of [0, 1] as const) for (const all of [false, true]) {
    const base: Transcript = { route: 'tool', steps: [{ call: { name: t.name, arguments: argsOf(t, variant, all) }, result: { status: 'ok', text: 'ok' } }], evidence: 'completed', answer: 'done' }
    lines.push(encodeTranscript(base, tools))
    lines.push(encodeTranscript({ ...base, steps: [{ ...base.steps[0], result: { status: 'error', text: '[TOOL ERROR] failed' } }], evidence: 'failed', answer: 'failed' }, tools))
  }
}
for (const e of EVIDENCE) lines.push(encodeTranscript({ route: 'direct', steps: [], evidence: 'not_verified', answer: `evidence ${e}` }, tools))
lines.push(encodeTranscript({ route: 'defer', steps: [], evidence: 'blocked', answer: 'blocked' }, tools))

// Synthetic traces in the training frame, so the tokenizer learns the text the model actually reads.
const TRACE_SEED = 101, TRACE_N = 3000
// Tokenizer v1's corpus was built with gen-synthetic-traces.ts as of commit ccc2aa9. The generator has since gained behaviours, so a
// rerun produces a DIFFERENT corpus: that is a new tokenizer version (new ids; every checkpoint retrained), never a silent refresh.
const TOKENIZER_VERSION = 'v1', TRACE_GENERATOR_COMMIT = 'ccc2aa9'
if (!process.argv.includes('--new-version')) { console.error(`corpus for tokenizer ${TOKENIZER_VERSION} was built with the trace generator at ${TRACE_GENERATOR_COMMIT}; rebuilding makes a new tokenizer version. Pass --new-version after bumping TOKENIZER_VERSION/TRACE_GENERATOR_COMMIT.`); process.exit(2) }
const tmp = mkdtempSync(join(tmpdir(), 'nexus-corpus-'))
try {
  execFileSync('npx', ['vite-node', join(root, 'train/gen-synthetic-traces.ts'), '--out', join(tmp, 't.jsonl'), '--n', String(TRACE_N), '--seed', String(TRACE_SEED)], { stdio: 'pipe' })
  for (const l of readFileSync(join(tmp, 't.jsonl'), 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l) as { synthetic: boolean; prompt: string; text: string }; if (r.synthetic !== true) throw new Error('non-synthetic trace'); lines.push(`User: ${r.prompt}`, ...r.text.split('\n')) }
} finally { rmSync(tmp, { recursive: true, force: true }) }

const corpus = lines.filter(l => l.length > 0).join('\n') + '\n'
writeFileSync(join(root, 'tokenizer/corpus.synthetic.txt'), corpus)
writeFileSync(join(root, 'spec/special-tokens.json'), JSON.stringify([...SPECIAL_TOKENS], null, 2) + '\n')
writeFileSync(join(root, 'tokenizer/CUSTODY.json'), JSON.stringify({
  synthetic: true,
  version: TOKENIZER_VERSION,
  derivedFrom: { snapshotSourceSha: snapshot.sourceSha, files: ['spec/tools.snapshot.json', 'src/grammar.ts', 'train/gen-synthetic-traces.ts'], traces: { seed: TRACE_SEED, n: TRACE_N, generatorCommit: TRACE_GENERATOR_COMMIT } },
  contents: 'tool names, tool and parameter descriptions, canonical grammar transcripts with placeholder argument values, and synthetic grammar traces (templated prompts; trading results are the app\'s own output templates with fictional values)',
  excludes: ['admitted corpus candidates', 'chat or user text', 'operator data', 'frozen eval prompts'],
  atomicToolNames: tools.map(t => t.name),
  corpusSha256: createHash('sha256').update(corpus).digest('hex'),
  lines: corpus.split('\n').length - 1,
  bytes: Buffer.byteLength(corpus),
  rule: 'Derived artifacts (tokenizer model, vocab) inherit synthetic:true. Never enters a Guardian training set.',
}, null, 2) + '\n')
console.log(`corpus: ${corpus.split('\n').length - 1} lines, ${Buffer.byteLength(corpus)} bytes`)
