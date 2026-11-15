import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('generated fixtures', () => {
  it('spec/fixtures/evidence-rules.json is current with validateTranscript (constrain.py is tested against it)', () => {
    expect(execFileSync('npx', ['vite-node', 'nexus-llm/scripts/gen-evidence-fixture.ts', '--check'], { encoding: 'utf8' })).toContain('evidence rules current')
  }, 60_000)
})
