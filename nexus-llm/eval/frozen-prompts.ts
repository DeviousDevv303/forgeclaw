// Every prompt in every FROZEN eval suite (eval/<suite>/MANIFEST.json with frozen: true), normalized. Training data, synthetic or
// exported, must never contain one; the generator and the exporter both filter on this set by default.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizePrompt } from '../exporter/export'

const here = dirname(fileURLToPath(import.meta.url))

export function frozenSuites(): string[] {
  return readdirSync(here, { withFileTypes: true }).filter(d => d.isDirectory() && existsSync(join(here, d.name, 'MANIFEST.json')))
    .filter(d => (JSON.parse(readFileSync(join(here, d.name, 'MANIFEST.json'), 'utf8')) as { frozen?: boolean }).frozen === true).map(d => d.name).sort()
}

export function frozenPrompts(): Set<string> {
  const out = new Set<string>()
  for (const s of frozenSuites()) for (const l of readFileSync(join(here, s, 'cases.jsonl'), 'utf8').split('\n').filter(Boolean)) out.add(normalizePrompt((JSON.parse(l) as { prompt: string }).prompt))
  // closed-loop scenarios are eval too (loop/scenarios.json), though not a gated suite
  for (const sc of (JSON.parse(readFileSync(join(here, 'loop/scenarios.json'), 'utf8')) as { scenarios: Array<{ prompt: string }> }).scenarios) out.add(normalizePrompt(sc.prompt))
  return out
}
