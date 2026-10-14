// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
import { describe, expect, it, vi } from 'vitest'
import { AutonomyEngine, GUARDIAN_LEDGER_KEY, GUARDIAN_LEDGER_MAX, readGuardianLedger } from './autonomyEngine'
import type { GuardianContext, GuardianLogEntry } from '../types/autonomy'
import type { TaskSpec } from '../types/orchestrator'

const context: GuardianContext = {
  errors: [],
  identityValid: true,
  contracts: { github: { maxScopes: ['github:read', 'github:write', 'github:dispatch', 'errorBus:emit'] } },
}
const task = (requestedScopes: TaskSpec['requestedScopes']): TaskSpec => ({
  taskId: 't1', agentId: 'github', intent: 'test', payload: {}, timeout: 1000, requestedScopes,
})

function memoryStorage(initial?: string) {
  const data = new Map<string, string>(initial === undefined ? [] : [[GUARDIAN_LEDGER_KEY, initial]])
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
  }
}
const entry = (n: number): GuardianLogEntry => ({
  taskId: `t${n}`, agentId: 'github', decision: 'ALLOW', triggeredRule: 5,
  trace: { R0: true, R1: true, R2: true, R3: false, R4: false, R5: true }, timestamp: new Date(n).toISOString(),
})

describe('AutonomyEngine R4 high-impact rule', () => {
  const engine = new AutonomyEngine()
  it.each(['github:write', 'github:dispatch'] as const)('blocks %s with rule 4', scope => {
    const decision = engine.evaluate(task([scope]), context)
    expect(decision.action).toBe('BLOCK')
    expect(decision.triggeredRule).toBe(4)
  })
  it('still allows low-impact scopes', () => {
    const decision = engine.evaluate(task(['github:read', 'errorBus:emit']), context)
    expect(decision.action).toBe('ALLOW')
    expect(decision.triggeredRule).toBe(5)
  })
  it('keeps the legacy bare names working', () => {
    expect(engine.evaluate(task(['deploy' as never]), { ...context, contracts: { github: { maxScopes: ['deploy'] } } }).triggeredRule).toBe(4)
  })
})

describe('AutonomyEngine decision ledger', () => {
  const engine = new AutonomyEngine()
  it('persists each decision append-only', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const storage = memoryStorage()
    engine.logDecision(entry(1), storage)
    engine.logDecision(entry(2), storage)
    expect(readGuardianLedger(storage).map(e => e.taskId)).toEqual(['t1', 't2'])
  })
  it('bounds the ledger to the newest entries', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const storage = memoryStorage()
    for (let i = 0; i < GUARDIAN_LEDGER_MAX + 5; i++) engine.logDecision(entry(i), storage)
    const ledger = readGuardianLedger(storage)
    expect(ledger).toHaveLength(GUARDIAN_LEDGER_MAX)
    expect(ledger.at(-1)?.taskId).toBe(`t${GUARDIAN_LEDGER_MAX + 4}`)
  })
  it('reports a failed write instead of swallowing it', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const storage = { getItem: () => null, setItem: () => { throw new Error('quota') } }
    expect(() => engine.logDecision(entry(1), storage)).not.toThrow()
    expect(error).toHaveBeenCalled()
  })
  it('reports when no storage exists', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    engine.logDecision(entry(1), null)
    expect(error).toHaveBeenCalled()
  })
  it('treats corrupt ledger data as empty and recovers', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const storage = memoryStorage('{not json')
    engine.logDecision(entry(1), storage)
    expect(readGuardianLedger(storage)).toHaveLength(1)
  })
})
