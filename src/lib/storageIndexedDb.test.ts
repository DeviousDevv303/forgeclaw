// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCorpusStorageStatus, readCorpusStorageSnapshot, resetCorpusStorageForTests, restartCorpusStorageForTests } from './storage'

const RECORD_KEY = 'forgeclaw_nexus_record_v1:knowledge-legacy'
const INDEX_KEY = 'forgeclaw_nexus_index_v1'

async function freshStore() {
  await resetCorpusStorageForTests()
  localStorage.clear()
}

describe('Corpus IndexedDB migration', () => {
  beforeEach(async () => {
    await freshStore()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('moves a populated legacy corpus only after count and byte verification', async () => {
    const record = JSON.stringify({ id: 'knowledge-legacy', recordType: 'knowledge', admissionStatus: 'approved', content: 'legacy fact' })
    localStorage.setItem(RECORD_KEY, record)
    localStorage.setItem(INDEX_KEY, JSON.stringify(['knowledge-legacy']))

    await restartCorpusStorageForTests()
    const status = getCorpusStorageStatus()
    const snapshot = await readCorpusStorageSnapshot()

    expect(status.backend).toBe('indexeddb')
    expect(status.migration).toBe('migrated')
    expect(status.legacyCount).toBe(2)
    expect(status.migratedCount).toBe(2)
    expect(status.legacyChars).toBe((RECORD_KEY.length + record.length) + (INDEX_KEY.length + JSON.stringify(['knowledge-legacy']).length))
    expect(snapshot.getItem(RECORD_KEY)).toBe(record)
    expect(localStorage.getItem(RECORD_KEY)).toBeNull()
    expect(localStorage.getItem(INDEX_KEY)).toBeNull()
  })

  it('keeps the legacy store and surfaces a failure when legacy reads fail', async () => {
    const record = JSON.stringify({ id: 'knowledge-legacy', recordType: 'knowledge', admissionStatus: 'approved', content: 'legacy fact' })
    localStorage.setItem(RECORD_KEY, record)
    vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError') })

    await restartCorpusStorageForTests()
    expect(getCorpusStorageStatus().migration).toBe('failed')
    expect(localStorage.length).toBe(1)
  })
})
