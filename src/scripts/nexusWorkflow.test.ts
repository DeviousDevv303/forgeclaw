import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const validator = resolve(process.cwd(), '.github/scripts/validate_nexus_invocation_id.py')
const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/nexus-intelligence.yml'), 'utf8')

function validate(id: string) {
  return spawnSync('python3', ['-B', validator, id], { encoding: 'utf8' })
}

describe('Nexus workflow input safety', () => {
  it('runs the path-component validator before result-mirror publication and permits app IDs', () => {
    const validationStep = workflow.indexOf('validate_nexus_invocation_id.py')
    const mirrorStep = workflow.indexOf('Publish browser-readable result mirror')
    expect(validationStep).toBeGreaterThanOrEqual(0)
    expect(validationStep).toBeLessThan(mirrorStep)
    expect(validate('nexus-1794465286349-g1v1ov').status).toBe(0)
    expect(validate('audit_nexus-20261112').status).toBe(0)
  })

  it.each(['../outside', 'nexus/../../outside', '.', '..', 'with.dot', 'with space', ''])('rejects unsafe invocation ID %j', id => {
    expect(validate(id).status).not.toBe(0)
  })

  it('rejects an overlong path component', () => {
    expect(validate(`nexus-${'a'.repeat(120)}`).status).not.toBe(0)
  })
})
