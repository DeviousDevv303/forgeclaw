// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

/**
 * Storage helpers. Application settings continue to use localStorage. Corpus keys are
 * transparently mirrored through IndexedDB so existing synchronous call sites remain
 * compatible while the durable backend is asynchronous and quota-scaled.
 */

const CORPUS_PREFIXES = [
  'forgeclaw_nexus_index_v1',
  'forgeclaw_nexus_version_v1',
  'forgeclaw_nexus_record_v1:',
  'forgeclaw_nexus_candidate_v1:',
  'forgeclaw_nexus_candidate_index_v1',
  'forgeclaw_nexus_declined_v1',
]
const DB_NAME = 'forgeclaw-corpus-v1'
const DB_VERSION = 1
const RECORD_STORE = 'records'
const META_STORE = 'meta'
const MIGRATION_KEY = 'migration'

export type CorpusStorageMigrationState = 'not-started' | 'ready' | 'migrated' | 'failed' | 'unavailable'
export interface CorpusStorageStatus {
  backend: 'indexeddb' | 'localStorage'
  migration: CorpusStorageMigrationState
  error?: string
  legacyCount?: number
  migratedCount?: number
  legacyChars?: number
  migratedChars?: number
}

let corpusCache = new Map<string, string>()
let cacheStorage: Storage | null = (() => { try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null } })()
let storageOverride = false
let corpusDb: IDBDatabase | null = null
let corpusStatus: CorpusStorageStatus = { backend: 'localStorage', migration: 'not-started' }
let initPromise: Promise<void> | null = null

function isCorpusKey(key: string): boolean {
  return CORPUS_PREFIXES.some(prefix => key === prefix || key.startsWith(prefix))
}

function bindCurrentStorage(): void {
  let current: Storage | null = null
  try { current = typeof localStorage === 'undefined' ? null : localStorage } catch { current = null }
  if (current !== cacheStorage) {
    if (cacheStorage !== null && current !== cacheStorage) {
      storageOverride = true
      corpusDb = null
    }
    cacheStorage = current
    // Test doubles and private browsing contexts can replace the Web Storage object.
    // Never let records from the previous context leak into the new one.
    corpusCache = new Map()
  }
}

function localStorageAvailable(): boolean {
  try { return typeof localStorage !== 'undefined' } catch { return false }
}

function openCorpusDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('indexeddb_unavailable')); return }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(RECORD_STORE)) db.createObjectStore(RECORD_STORE, { keyPath: 'key' })
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('indexeddb_open_failed'))
  })
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('indexeddb_request_failed'))
  })
}

function txDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('indexeddb_transaction_failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('indexeddb_transaction_aborted'))
  })
}

function legacySnapshot(): Map<string, string> {
  const out = new Map<string, string>()
  if (!localStorageAvailable()) return out
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i)
    if (!key || !isCorpusKey(key)) continue
    const value = localStorage.getItem(key)
    if (value !== null) out.set(key, value)
  }
  return out
}

const chars = (records: Map<string, string>) => Array.from(records).reduce((sum, [key, value]) => sum + key.length + value.length, 0)

async function loadIndexedRecords(db: IDBDatabase): Promise<Map<string, string>> {
  const transaction = db.transaction(RECORD_STORE, 'readonly')
  const values = await requestResult(transaction.objectStore(RECORD_STORE).getAll()) as Array<{ key: string; value: string }>
  await txDone(transaction)
  return new Map(values.filter(item => isCorpusKey(item.key)).map(item => [item.key, item.value]))
}

async function migrateLegacy(db: IDBDatabase, legacy: Map<string, string>): Promise<void> {
  const metaRead = db.transaction(META_STORE, 'readonly')
  const marker = await requestResult(metaRead.objectStore(META_STORE).get(MIGRATION_KEY))
  await txDone(metaRead)
  if (marker === 'complete') {
    corpusStatus = { backend: 'indexeddb', migration: 'migrated', legacyCount: legacy.size, migratedCount: 0, legacyChars: chars(legacy), migratedChars: corpusCache.size }
    return
  }
  if (!legacy.size) {
    const tx = db.transaction(META_STORE, 'readwrite')
    tx.objectStore(META_STORE).put('complete', MIGRATION_KEY)
    await txDone(tx)
    corpusStatus = { backend: 'indexeddb', migration: 'ready', legacyCount: 0, migratedCount: 0, legacyChars: 0, migratedChars: 0 }
    return
  }

  const write = db.transaction(RECORD_STORE, 'readwrite')
  const store = write.objectStore(RECORD_STORE)
  for (const [key, value] of legacy) store.put({ key, value })
  await txDone(write)
  const migrated = await loadIndexedRecords(db)
  const expectedChars = chars(legacy)
  if (migrated.size !== legacy.size || chars(migrated) !== expectedChars || Array.from(legacy).some(([key, value]) => migrated.get(key) !== value)) {
    corpusStatus = { backend: 'indexeddb', migration: 'failed', error: 'migration_verification_failed', legacyCount: legacy.size, migratedCount: migrated.size, legacyChars: expectedChars, migratedChars: chars(migrated) }
    throw new Error('migration_verification_failed')
  }
  const markerTx = db.transaction(META_STORE, 'readwrite')
  markerTx.objectStore(META_STORE).put('complete', MIGRATION_KEY)
  await txDone(markerTx)
  try {
    for (const key of legacy.keys()) localStorage.removeItem(key)
  } catch {
    corpusStatus = { backend: 'indexeddb', migration: 'failed', error: 'legacy_cleanup_failed', legacyCount: legacy.size, migratedCount: migrated.size, legacyChars: expectedChars, migratedChars: chars(migrated) }
    throw new Error('legacy_cleanup_failed')
  }
  corpusStatus = { backend: 'indexeddb', migration: 'migrated', legacyCount: legacy.size, migratedCount: migrated.size, legacyChars: expectedChars, migratedChars: chars(migrated) }
}

async function initializeCorpusStorage(): Promise<void> {
  if (initPromise) return initPromise
  initPromise = (async () => {
    if (typeof indexedDB === 'undefined') {
      corpusStatus = { backend: 'localStorage', migration: 'unavailable', error: 'indexeddb_unavailable' }
      return
    }
    try {
      const db = await openCorpusDb()
      corpusDb = db
      const legacy = legacySnapshot()
      const stored = await loadIndexedRecords(db)
      corpusCache = stored
      await migrateLegacy(db, legacy)
      corpusCache = await loadIndexedRecords(db)
    } catch (error) {
      // Never delete legacy data after a partial/failed move. Reads retain the legacy
      // fallback and writes remain available through localStorage until the next run.
      if (corpusStatus.migration !== 'failed') corpusStatus = { backend: 'indexeddb', migration: 'failed', error: error instanceof Error ? error.message : 'migration_failed' }
      corpusCache = legacySnapshot()
    }
  })()
  return initPromise
}

// Browser startup begins migration immediately; callers that need a durable snapshot can await this.
if (typeof indexedDB !== 'undefined') void initializeCorpusStorage()
export const corpusStorageReady = initializeCorpusStorage()

/** Test-only lifecycle hook; production callers use corpusStorageReady. */
export async function resetCorpusStorageForTests(): Promise<void> {
  await corpusStorageReady
  corpusDb?.close()
  corpusDb = null
  await new Promise<void>(resolve => {
    if (typeof indexedDB === 'undefined') { resolve(); return }
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = request.onerror = request.onblocked = () => resolve()
  })
  corpusCache = new Map()
  corpusStatus = { backend: 'localStorage', migration: 'not-started' }
  initPromise = null
  storageOverride = false
  cacheStorage = (() => { try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null } })()
}

export async function restartCorpusStorageForTests(): Promise<void> {
  await initializeCorpusStorage()
}

function persistCorpus(key: string, value: string | null): void {
  if (!corpusDb || storageOverride) return
  try {
    const transaction = corpusDb.transaction(RECORD_STORE, 'readwrite')
    const store = transaction.objectStore(RECORD_STORE)
    if (value === null) store.delete(key)
    else store.put({ key, value })
  } catch (error) {
    corpusStatus = { ...corpusStatus, migration: 'failed', error: error instanceof Error ? error.message : 'indexeddb_write_failed' }
  }
}

export function getCorpusStorageStatus(): CorpusStorageStatus { return { ...corpusStatus } }

/** A Web-Storage-shaped snapshot for byte-compatible Nexus export. */
export async function readCorpusStorageSnapshot(): Promise<Storage> {
  await corpusStorageReady
  const values = new Map(corpusCache)
  return {
    get length() { return values.size },
    key(index: number) { return Array.from(values.keys())[index] ?? null },
    getItem(key: string) { return values.get(key) ?? null },
    setItem() { throw new Error('snapshot_read_only') },
    removeItem() { throw new Error('snapshot_read_only') },
    clear() { throw new Error('snapshot_read_only') },
  }
}

/** Wipe only the Corpus IndexedDB store; settings, token, chat, and history survive. */
export async function wipeCorpusStorage(): Promise<void> {
  await corpusStorageReady
  if (!corpusDb) {
    for (const key of legacySnapshot().keys()) localStorage.removeItem(key)
    corpusCache.clear()
    return
  }
  const transaction = corpusDb.transaction(RECORD_STORE, 'readwrite')
  transaction.objectStore(RECORD_STORE).clear()
  await txDone(transaction)
  corpusCache.clear()
}

// ─── Existing safe localStorage wrappers ─────────────────────────────────────
export function safeGetItem(key: string): string | null {
  bindCurrentStorage()
  if (isCorpusKey(key) && corpusDb && !storageOverride && corpusCache.has(key)) return corpusCache.get(key) ?? null
  try { return localStorage.getItem(key) } catch { return null }
}

export function safeSetItem(key: string, value: string): void {
  bindCurrentStorage()
  try {
    if (isCorpusKey(key)) {
      corpusCache.set(key, value)
      if (corpusDb && !storageOverride) persistCorpus(key, value)
      else localStorage.setItem(key, value) // startup writes are included in verified migration
      return
    }
    localStorage.setItem(key, value)
  } catch { /* Silently fail on private mode; strict variants surface the error. */ }
}

export function safeRemoveItem(key: string): void {
  bindCurrentStorage()
  try {
    if (isCorpusKey(key)) {
      corpusCache.delete(key)
      if (corpusDb && !storageOverride) persistCorpus(key, null)
      else localStorage.removeItem(key)
      return
    }
    localStorage.removeItem(key)
  } catch { /* Silently fail */ }
}

export function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

export interface StorageResult<T> { ok: boolean; value?: T; error?: string }

export function strictGetItem(key: string): StorageResult<string | null> {
  try {
    bindCurrentStorage()
    if (isCorpusKey(key) && corpusDb && !storageOverride) return { ok: true, value: corpusCache.has(key) ? corpusCache.get(key) ?? null : null }
    return { ok: true, value: localStorage.getItem(key) }
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'storage_read_failed' } }
}
export function strictSetItem(key: string, value: string): StorageResult<void> {
  try {
    bindCurrentStorage()
    if (isCorpusKey(key) && corpusDb && !storageOverride) { corpusCache.set(key, value); persistCorpus(key, value); return { ok: true } }
    localStorage.setItem(key, value)
    return { ok: true }
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'storage_write_failed' } }
}
export function verifiedSetItem(key: string, value: string): StorageResult<void> {
  const write = strictSetItem(key, value)
  if (!write.ok) return write
  return safeGetItem(key) === value ? { ok: true } : { ok: false, error: 'storage_readback_mismatch' }
}
export function strictRemoveItem(key: string): StorageResult<void> {
  try {
    bindCurrentStorage()
    if (isCorpusKey(key) && corpusDb && !storageOverride) { corpusCache.delete(key); persistCorpus(key, null); return { ok: true } }
    localStorage.removeItem(key)
    return { ok: true }
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'storage_delete_failed' } }
}
