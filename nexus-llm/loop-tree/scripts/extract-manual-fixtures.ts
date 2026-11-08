// NEXUS Intelligence: collect the real manual-protocol (```tool_call) examples that the repo's own tests use.
// Run: npx vite-node nexus-llm/scripts/extract-manual-fixtures.ts   -> spec/fixtures/manual-protocol-examples.json
// Source files are scanned as text; nothing is imported from src/.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const files = execFileSync('git', ['ls-files', 'src/**/*.test.ts', 'src/*.test.ts', 'src/**/*.test.tsx'], { cwd: root }).toString().split('\n').filter(Boolean)
// A fenced block inside a TS string literal: ```tool_call\n{...}\n``` with the newlines written as \n.
const FORMATS: Array<{ format: string; re: RegExp; name?: number; body: number }> = [
  { format: 'A fenced tool_call', re: /```tool_call\\n(\{.*?\})\\n```/g, body: 1 },
  { format: 'A2 fenced json', re: /```json\\n(\{"name".*?\})\\n```/g, body: 1 },
  { format: 'B TOOL_CALL line', re: /TOOL_CALL: ([a-zA-Z0-9_]+)\\n(\{.*?\})(?=['`])/g, name: 1, body: 2 },
  { format: 'C xml tag', re: /<tool_call name="([^"]+)">(\{.*?\})<\/tool_call>/g, name: 1, body: 2 },
]
const examples: Array<{ format: string; source: string; name: string; arguments: Record<string, unknown> }> = []
let seen = 0, unparsable = 0
for (const file of files) {
  const lines = readFileSync(join(root, file), 'utf8').split('\n')
  lines.forEach((line, idx) => {
    for (const f of FORMATS) for (const m of line.matchAll(f.re)) {
      seen++
      try {
        const body = JSON.parse(m[f.body].replace(/\\"/g, '"')) as Record<string, unknown>
        const named = f.name ? { name: m[f.name], arguments: body } : { name: body.name, arguments: body.arguments ?? body.input }
        const args = named.arguments
        if (typeof named.name === 'string' && args && typeof args === 'object' && !Array.isArray(args)) examples.push({ format: f.format, source: `${file}:${idx + 1}`, name: named.name, arguments: args as Record<string, unknown> })
        else unparsable++
      } catch { unparsable++ }
    }
  })
}
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim()
mkdirSync(join(root, 'nexus-llm/spec/fixtures'), { recursive: true })
writeFileSync(join(root, 'nexus-llm/spec/fixtures/manual-protocol-examples.json'), JSON.stringify({ sourceSha: sha, scannedFiles: files.length, fencedBlocksSeen: seen, skippedUnparsable: unparsable, examples }, null, 2) + '\n')
console.log(`scanned ${files.length} test files; ${seen} fenced blocks; ${examples.length} kept; ${unparsable} skipped; formats: ${[...new Set(examples.map(e => e.format))].join(' | ')}`)
