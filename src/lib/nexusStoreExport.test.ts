// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildNexusStoreExport } from './corpus'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

const RECORD_PREFIX = 'forgeclaw_nexus_record_v1:'
const CANDIDATE_PREFIX = 'forgeclaw_nexus_candidate_v1:'
const ORIGIN = 'https://deviousdevv303.github.io'
const AT = '2026-10-27T20:50:00.000Z'

function record(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'knowledge-abc123',
    corpusId: 'forgeclaw',
    source: 'test',
    content: 'an approved fact',
    timestamp: AT,
    version: 1,
    recordType: 'knowledge',
    integrity: 'abc123',
    admissionStatus: 'approved',
    metadata: {},
    ...overrides,
  })
}

describe('buildNexusStoreExport', () => {
  it('exports an approved knowledge record with its paired candidate, in the console-exporter envelope', () => {
    const storage = new MemoryStorage()
    const rawRecord = record()
    const rawCandidate = JSON.stringify({ id: 'candidate-abc123', recordType: 'learning_candidate', integrity: 'abc123', admissionStatus: 'approved' })
    storage.setItem(`${RECORD_PREFIX}knowledge-abc123`, rawRecord)
    storage.setItem(`${CANDIDATE_PREFIX}candidate-abc123`, rawCandidate)

    const result = buildNexusStoreExport(storage, ORIGIN, AT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.approvedCount).toBe(1)
    expect(result.keyCount).toBe(2)
    expect(result.envelope).toEqual({
      format: 'nexus-store-export',
      version: 1,
      exportedAt: AT,
      origin: ORIGIN,
      keys: {
        [`${RECORD_PREFIX}knowledge-abc123`]: rawRecord,
        [`${CANDIDATE_PREFIX}candidate-abc123`]: rawCandidate,
      },
    })
    expect(JSON.parse(result.json)).toEqual(result.envelope)
  })

  it('excludes unapproved records and non-knowledge record types, approved or not', () => {
    const storage = new MemoryStorage()
    storage.setItem(`${RECORD_PREFIX}knowledge-pending`, record({ id: 'knowledge-pending', integrity: 'pending', admissionStatus: 'candidate' }))
    storage.setItem(`${RECORD_PREFIX}knowledge-rejected`, record({ id: 'knowledge-rejected', integrity: 'rejected', admissionStatus: 'rejected' }))
    storage.setItem(`${RECORD_PREFIX}interaction-1`, record({ id: 'interaction-1', integrity: 'int1', recordType: 'interaction', admissionStatus: 'approved' }))
    storage.setItem(`${RECORD_PREFIX}candidate-x`, record({ id: 'candidate-x', integrity: 'candx', recordType: 'learning_candidate', admissionStatus: 'approved' }))

    const result = buildNexusStoreExport(storage, ORIGIN, AT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.approvedCount).toBe(0)
    expect(result.keyCount).toBe(0)
    expect(result.envelope.keys).toEqual({})
  })

  it('pairs candidates by integrity only — an unrelated stored candidate is never swept in', () => {
    const storage = new MemoryStorage()
    storage.setItem(`${RECORD_PREFIX}knowledge-abc123`, record())
    storage.setItem(`${CANDIDATE_PREFIX}candidate-other999`, JSON.stringify({ id: 'candidate-other999', recordType: 'learning_candidate', integrity: 'other999', admissionStatus: 'candidate' }))

    const result = buildNexusStoreExport(storage, ORIGIN, AT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.approvedCount).toBe(1)
    expect(result.keyCount).toBe(1)
    expect(Object.keys(result.envelope.keys)).toEqual([`${RECORD_PREFIX}knowledge-abc123`])
  })

  it('ignores other key families and malformed record values', () => {
    const storage = new MemoryStorage()
    storage.setItem('forgeclaw_nexus_index_v1', '["knowledge-abc123"]')
    storage.setItem('fc_kalshi_key', 'not-a-record')
    storage.setItem(`${RECORD_PREFIX}knowledge-broken`, '{bad json')
    storage.setItem(`${RECORD_PREFIX}knowledge-abc123`, record())

    const result = buildNexusStoreExport(storage, ORIGIN, AT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.approvedCount).toBe(1)
    expect(Object.keys(result.envelope.keys)).toEqual([`${RECORD_PREFIX}knowledge-abc123`])
  })

  it('aborts with no output when a selected value looks like a credential', () => {
    const storage = new MemoryStorage()
    storage.setItem(`${RECORD_PREFIX}knowledge-abc123`, record({ content: 'leaked key sk-abcdefghijklmnopqrstuvwx' }))

    const result = buildNexusStoreExport(storage, ORIGIN, AT)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('credential')
    if (result.reason === 'credential') expect(result.keyPrefix).toBe(`${RECORD_PREFIX}knowledge-abc123`)
    expect('json' in result).toBe(false)
  })

  it('returns a valid empty envelope for an empty store', () => {
    const result = buildNexusStoreExport(new MemoryStorage(), ORIGIN, AT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.approvedCount).toBe(0)
    expect(result.keyCount).toBe(0)
    expect(result.envelope).toEqual({ format: 'nexus-store-export', version: 1, exportedAt: AT, origin: ORIGIN, keys: {} })
  })
})
