// Enforce the corpus rule (nexus-llm/corpus/README.md): every verified-troubleshooting row must be unadmitted, well-formed, and carry a
// code anchor whose needle is present in the cited file on the CURRENT tree. That last check is what makes "verified" true on every run,
// not a one-time claim. Relay with no repo anchor cannot pass.
//   npx vite-node nexus-llm/corpus/check-corpus.ts   (exit 1 on any violation; also run by corpus.test.ts)
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')

export interface CorpusRow {
  id: string; kind: string; symptom: string; cause: string; fix: string
  anchor: { path: string; needle: string }
  artifact: { type: string; ref: string; verifiedAt: string }
  provenance: { source: string; url: string }
  admitted: boolean
}

export function loadRows(file = join(here, 'verified-troubleshooting.jsonl')): CorpusRow[] {
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as CorpusRow)
}

/** Returns the list of violations (empty = clean). Pure except for reading the anchored source files under `root`. */
export function checkRows(rows: CorpusRow[], root = repo): string[] {
  const errs: string[] = []
  const ids = new Set<string>()
  const SHA = /^[0-9a-f]{7,40}$/
  for (const r of rows) {
    const where = r.id || '(no id)'
    if (!r.id || ids.has(r.id)) errs.push(`${where}: missing or duplicate id`)
    ids.add(r.id)
    if (r.admitted !== false) errs.push(`${where}: admitted must be false (operator admits via corpusAdmissionAuth; no lane self-admits)`)
    for (const k of ['symptom', 'cause', 'fix'] as const) if (!r[k] || r[k].trim().length < 8) errs.push(`${where}: ${k} is empty or too short`)
    if (!r.artifact?.ref || !r.artifact.type) errs.push(`${where}: artifact.ref/type required (no relay without an artifact)`)
    else if (r.artifact.type === 'commit' && !SHA.test(r.artifact.ref)) errs.push(`${where}: commit artifact ref is not a sha`)
    if (!/^\d{4}-\d{2}-\d{2}/.test(r.artifact?.verifiedAt ?? '')) errs.push(`${where}: artifact.verifiedAt must be an ISO date`)
    if (!r.provenance?.source || !r.provenance.url) errs.push(`${where}: provenance.source/url required`)
    // The standing proof: the anchor's needle must be present in the cited file on the current tree.
    const path = r.anchor?.path
    if (!path || !r.anchor?.needle) { errs.push(`${where}: anchor.path/needle required`); continue }
    const abs = join(root, path)
    if (!existsSync(abs)) errs.push(`${where}: anchor file not found: ${path}`)
    else if (!readFileSync(abs, 'utf8').includes(r.anchor.needle)) errs.push(`${where}: anchor needle not present in ${path} (fix moved or reverted?): ${JSON.stringify(r.anchor.needle)}`)
  }
  return errs
}

if (process.argv[1] && process.argv[1].endsWith('check-corpus.ts')) {
  const rows = loadRows()
  const errs = checkRows(rows)
  if (errs.length) { for (const e of errs) console.error('FAIL', e); console.error(`\n${errs.length} violation(s) in ${rows.length} rows`); process.exit(1) }
  console.log(`corpus clean: ${rows.length} verified, unadmitted troubleshooting rows (each anchor present on the current tree)`)
}
