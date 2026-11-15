// NEXUS Intelligence step 3 CLI.
//   npx vite-node nexus-llm/exporter/export-cli.ts <store-export.json> --out <dir> [--allow-direct] [--include-converged]
//                                                  [--eval extra-cases.jsonl] [--bytes-per-token 4]
// Rows whose prompt is in ANY frozen eval suite (eval/*/MANIFEST.json, frozen) are always dropped; --eval adds another case file.
// Writes sft.jsonl, rejected.jsonl and manifest.json to <dir>. <dir> must be OUTSIDE the repo (the rows are operator data)
// unless --allow-in-repo is given.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { budget, scenarioTable, tokensFromBytes } from './budget'
import { buildRows, collectAdmitted, normalizePrompt, parseStoreExport, sha256 } from './export'
import type { ToolSchema } from '../src/grammar'
import { frozenPrompts } from '../eval/frozen-prompts'

const here = dirname(fileURLToPath(import.meta.url))
const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: here }).toString().trim()
const args = process.argv.slice(2)
const flag = (n: string) => args.includes(n)
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const input = args.find(a => !a.startsWith('--') && a !== opt('--out') && a !== opt('--eval') && a !== opt('--bytes-per-token'))
const outDir = opt('--out')
if (!input || !outDir) { console.error('usage: export-cli.ts <store-export.json> --out <dir> [--allow-direct] [--include-converged] [--eval cases.jsonl] [--bytes-per-token N] [--allow-in-repo]'); process.exit(2) }
if ((resolve(outDir) + sep).startsWith(repo + sep) && !flag('--allow-in-repo')) { console.error('refusing to write operator data inside the repo; pass --out outside it (or --allow-in-repo)'); process.exit(2) }

const raw = readFileSync(input, 'utf8')
const store = parseStoreExport(JSON.parse(raw))
const snapshot = JSON.parse(readFileSync(join(here, '../spec/tools.snapshot.json'), 'utf8')) as { tools: ToolSchema[]; notEvidenceTools: string[] }
const evalFile = opt('--eval')
const evalPrompts = frozenPrompts()
if (evalFile) for (const l of readFileSync(evalFile, 'utf8').split('\n').filter(Boolean)) evalPrompts.add(normalizePrompt((JSON.parse(l) as { prompt?: string }).prompt ?? ''))

const items = collectAdmitted(store)
const { rows, rejected } = buildRows(store, items, { tools: snapshot.tools, notEvidenceTools: new Set(snapshot.notEvidenceTools), storeSha256: sha256(raw), includeConverged: flag('--include-converged'), allowDirect: flag('--allow-direct'), evalPrompts })
const sft = rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')
const rej = rejected.map(r => JSON.stringify(r)).join('\n') + (rejected.length ? '\n' : '')
const bpt = Number(opt('--bytes-per-token') ?? 4)
const tokens = tokensFromBytes(Buffer.byteLength(rows.map(r => r.prompt + r.text).join('')), bpt)
const reasons: Record<string, number> = {}
for (const r of rejected) reasons[r.reason.split(':')[0]] = (reasons[r.reason.split(':')[0]] ?? 0) + 1
const byAdmission: Record<string, number> = {}
for (const it of items) byAdmission[it.admission] = (byAdmission[it.admission] ?? 0) + 1
const avg = rows.length ? tokens / rows.length : 300
const manifest = {
  exporterFormat: 'nexus-sft-v1', storeExportSha256: sha256(raw), storeExportedAt: store.exportedAt,
  admittedKnowledgeRecords: items.length, admittedByKind: byAdmission, rowsExported: rows.length, rowsRejected: rejected.length, rejectionReasons: reasons,
  outputSha256: { 'sft.jsonl': sha256(sft), 'rejected.jsonl': sha256(rej) },
  tokenBudget: { bytesPerTokenAssumed: bpt, tokensInExport: tokens, vs30M: budget(30e6, tokens), vs60M: budget(60e6, tokens), scenarioAt: `${Math.round(avg)} tokens/example`,
    note: 'bytesPerTokenAssumed is NOT measured on this data; measure with the trained tokenizer once real rows exist.' },
}
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'sft.jsonl'), sft)
writeFileSync(join(outDir, 'rejected.jsonl'), rej)
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`admitted knowledge: ${items.length} (${JSON.stringify(byAdmission)}); exported ${rows.length}; rejected ${rejected.length} ${JSON.stringify(reasons)}`)
console.log(scenarioTable(avg, [rows.length, 1000, 10000, 100000], [30e6, 60e6]))
