// NEXUS Intelligence: regenerate spec/tools.snapshot.json and spec/tool-call.schema.json from the live registry.
// Run:   npx vite-node nexus-llm/scripts/snapshot-tools.ts
// Check: npx vite-node nexus-llm/scripts/snapshot-tools.ts --check   (exit 1 when the committed files are stale)
// This is the ONLY place nexus-llm reads src/ (one-way, read-only). Tests read the snapshot, never src/.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FORGE_TOOLS } from '../../src/lib/forgeTools'
import { NOT_EVIDENCE_TOOLS } from '../../src/lib/nexusConvergence'
import { buildToolCallSchema, type ToolSchema } from '../src/grammar'

const here = dirname(fileURLToPath(import.meta.url))
const specDir = join(here, '..', 'spec')
const check = process.argv.includes('--check')

const tools: ToolSchema[] = FORGE_TOOLS.map(t => ({ name: t.name, description: t.description, parameters: t.parameters as ToolSchema['parameters'] }))
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: join(here, '..', '..') }).toString().trim()
// The snapshot content is deterministic; the SHA is recorded for provenance but excluded from the staleness check.
const snapshot = { generatedFrom: 'src/lib/forgeTools.ts FORGE_TOOLS + src/lib/nexusConvergence.ts NOT_EVIDENCE_TOOLS', sourceSha, notEvidenceTools: [...NOT_EVIDENCE_TOOLS].sort(), tools }
const schema = buildToolCallSchema(tools)

const outputs: Array<[string, unknown]> = [['tools.snapshot.json', snapshot], ['tool-call.schema.json', schema]]
let stale = false
for (const [file, value] of outputs) {
  const path = join(specDir, file)
  const next = JSON.stringify(value, null, 2) + '\n'
  if (check) {
    const strip = (s: string) => s.replace(/"sourceSha": "[0-9a-f]{40}",?\n\s*/, '')
    if (!existsSync(path) || strip(readFileSync(path, 'utf8')) !== strip(next)) { console.error(`STALE: ${file}`); stale = true }
  } else {
    writeFileSync(path, next)
    console.log(`wrote ${file} (${tools.length} tools, source ${sourceSha.slice(0, 7)})`)
  }
}
if (check) { console.log(stale ? 'snapshot is stale: regenerate' : `snapshot current (${tools.length} tools)`); process.exit(stale ? 1 : 0) }
