// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// The NEXUS tab's model facts are checked against the repository itself, so the tab cannot keep describing a checkpoint the
// app no longer serves, or grades the record does not hold.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { nexusProvider } from './ai/providers/nexusProvider'
import { NEXUS_MODEL_STATE as M, pct } from './nexusModelState'

const root = join(__dirname, '../..')

describe('the model the NEXUS tab describes is the model the app serves', () => {
  it('the checkpoint hash equals the sha256 of the served runtime parts', () => {
    const dir = join(root, '.github/nexus-runtime')
    const parts = readdirSync(dir).filter(f => f.startsWith('model.pt.b64.part-')).sort()
    expect(parts.length).toBeGreaterThan(0)
    const bytes = Buffer.from(parts.map(f => readFileSync(join(dir, f), 'utf8')).join('').replace(/\s+/g, ''), 'base64')
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(M.sha256)
  })

  it('size, window, id and label match the provider definition', () => {
    const model = nexusProvider.models[0]
    expect(model.id).toBe(M.id)
    expect(model.label).toBe(M.label)
    expect(model.note).toContain(`${M.parameters} params`)
    expect(model.note).toContain(`${M.contextTokens}-token window`)
    expect(model.contextK).toBe(M.contextTokens / 1000)
    expect(M.label).toContain(`Run ${M.run}`)
  })

  it('every graded number is in the run verdict the loop recorded', () => {
    const state = JSON.parse(readFileSync(join(root, 'nexus-llm/loop-state.json'), 'utf8')) as { verdicts: Record<string, string>; last_check: string }
    const verdict = state.verdicts[`run${M.run}`]
    expect(verdict.toLowerCase()).toContain(M.graded.verdict.toLowerCase())
    expect(verdict).toContain(`graded ${M.graded.on}`)
    expect(verdict).toContain(`v1 ${pct(M.graded.v1)} counted ${M.graded.v1.hits}/${M.graded.v1.n}`)
    expect(verdict).toContain(`domains-v1 ${pct(M.graded.domains)} counted ${M.graded.domains.hits}/${M.graded.domains.n}`)
    expect(verdict).toContain(`closed loop ${M.graded.closedLoop.hits}/${M.graded.closedLoop.n}`)
    expect(verdict).toContain(`fabrication ${M.graded.fabrication} both`)
    expect(verdict).toContain(`gate ${M.graded.gate}`)
    // The loop's own record names the same checkpoint by its hash prefix.
    expect(state.last_check).toContain(`sha256 ${M.sha256.slice(0, 8)}`)
  })
})
