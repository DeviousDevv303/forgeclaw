// @vitest-environment node
// The #235 -> Corpus producer (nexus-llm/intake) is Python; the intake consumer is this app. This file runs the Python
// tests inside the main gate and proves the app's own consumer accepts what the producer writes, as a PENDING candidate:
// the owner's three auto-admission classes (nexusIntake.ts) do not cover source 'issue-235-fix', and nothing here widens them.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { intakeAutoAdmitMarker, parseNexusIntake } from '../lib/nexusIntake'

const root = fileURLToPath(new URL('../../', import.meta.url))

describe('#235 → Corpus producer', () => {
  it('its Python tests pass', () => {
    const run = spawnSync('python3', ['-B', '-m', 'unittest', 'discover', '-s', 'nexus-llm/intake', '-p', 'test_*.py'], { cwd: root, encoding: 'utf8' })
    expect(run.status, run.stderr).toBe(0)
  })

  it('the app consumer accepts the produced intake record and leaves it a pending candidate', () => {
    const records = parseNexusIntake(readFileSync(`${root}nexus-llm/intake/fixtures/out/intake.jsonl`, 'utf8'))
    expect(records).toHaveLength(1)
    const [record] = records
    expect(record).toMatchObject({ source: 'issue-235-fix', kind: 'fix-verified', ref: 'forgeclaw#416', runId: 'pr-416-487491f1ddc5', subject: 'forgeclaw#416' })
    expect(record.text).toContain('Merged 2026-11-12T05:26:19Z as 487491f1ddc5')
    expect(intakeAutoAdmitMarker(record)).toBeNull()
  })

  it('every real traces-v1 row of this producer is a real, verified, well-formed row', () => {
    const rows = readFileSync(`${root}nexus-llm/traces-v1/fix-verified-v1.jsonl`, 'utf8').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown> & { provenance: Record<string, unknown>; text: string })
    expect(rows).toHaveLength(1)
    for (const row of rows) {
      expect(row.synthetic).toBe(false)
      expect(row.kind).toBe('fix_verified_real')
      expect(row.provenance).toMatchObject({ label: 'real', source: 'issue-235-fix', shaper_version: 'traces-v1' })
      expect(row.text).toMatch(/^<\|route:tool\|><\|call\|>\{"name": "github_pr_info"/)
      expect(row.text).toMatch(/<\|ev:verified\|><\|answer\|>Verdict: CONFIRMED\./)
      expect(row.text.endsWith('<|/answer|><|end|>')).toBe(true)
    }
  })
})
