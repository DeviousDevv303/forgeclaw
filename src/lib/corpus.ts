// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── NEXUS / Corpus Local Store ──────────────────────────────────────────────
// Small, deterministic, localStorage-backed corpus ledger. No network is needed
// to initialize or use this module; synchronization is an explicit optional path.

import { safeGetItem, safeSetItem } from './storage'

export type CorpusAdmissionStatus = 'raw' | 'candidate' | 'approved' | 'rejected'
export type CorpusRecordType = 'interaction' | 'learning_candidate' | 'knowledge'

export interface CorpusRecord {
  id: string
  corpusId: string
  source: string
  content: string
  timestamp: string
  version: number
  recordType: CorpusRecordType
  integrity: string
  admissionStatus: CorpusAdmissionStatus
  metadata: Record<string, string>
}

export interface LearningCandidate extends CorpusRecord {
  recordType: 'learning_candidate'
  sourceInteractionId: string
  runtime: string
  model: string
  input: string
  context: string
  generatedResult: string
}

export interface CorpusInteractionInput {
  input: string
  context: string
  result: string
  runtime: string
  model: string
  source?: string
}

export interface CorpusSyncResult {
  attempted: number
  admitted: number
  status: 'skipped' | 'synced' | 'pending' | 'rejected'
  reason?: string
}

const INDEX_KEY = 'forgeclaw_nexus_index_v1'
const VERSION_KEY = 'forgeclaw_nexus_version_v1'
const RECORD_PREFIX = 'forgeclaw_nexus_record_v1:'
const CANDIDATE_PREFIX = 'forgeclaw_nexus_candidate_v1:'
const CANDIDATE_INDEX_KEY = 'forgeclaw_nexus_candidate_index_v1'
const MAX_INDEX_ENTRIES = 10_000

function readIndex(key: string): string[] {
  const raw = safeGetItem(key)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

function writeIndex(key: string, ids: string[]): void {
  safeSetItem(key, JSON.stringify(ids.slice(-MAX_INDEX_ENTRIES)))
}

function tokenise(value: string): string[] {
  return Array.from(new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length >= 2)))
}

function fallbackHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export async function integrityHash(value: string): Promise<string> {
  const cryptoApi = globalThis.crypto
  if (cryptoApi?.subtle) {
    const bytes = new TextEncoder().encode(value)
    const digest = await cryptoApi.subtle.digest('SHA-256', bytes)
    return `sha256-${Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('')}`
  }
  return fallbackHash(value)
}

function canonicalContent(input: CorpusInteractionInput): string {
  return [input.input, input.context, input.result, input.runtime, input.model].join('\n')
}

function safeRecord(raw: string | null): CorpusRecord | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<CorpusRecord>
    if (!value.id || !value.corpusId || !value.content || !value.integrity || !value.admissionStatus || !value.recordType) return null
    return value as CorpusRecord
  } catch {
    return null
  }
}

export class CorpusRepository {
  getVersion(): number {
    const value = Number(safeGetItem(VERSION_KEY) || '1')
    return Number.isFinite(value) && value > 0 ? value : 1
  }

  private nextVersion(): number {
    const version = this.getVersion() + 1
    safeSetItem(VERSION_KEY, String(version))
    return version
  }

  private saveRecord(record: CorpusRecord, candidate = false): void {
    const prefix = candidate ? CANDIDATE_PREFIX : RECORD_PREFIX
    const indexKey = candidate ? CANDIDATE_INDEX_KEY : INDEX_KEY
    safeSetItem(`${prefix}${record.id}`, JSON.stringify(record))
    const index = readIndex(indexKey)
    if (!index.includes(record.id)) index.push(record.id)
    writeIndex(indexKey, index)
  }

  getInteractionCount(): number {
    return readIndex(INDEX_KEY).length
  }

  getCandidateCount(): number {
    return readIndex(CANDIDATE_INDEX_KEY).length
  }

  getApprovedCount(): number {
    let count = 0
    for (const id of readIndex(INDEX_KEY)) {
      const record = safeRecord(safeGetItem(`${RECORD_PREFIX}${id}`))
      if (record?.admissionStatus === 'approved') count += 1
    }
    return count
  }

  appendInteraction(input: CorpusInteractionInput): Promise<{ interaction: CorpusRecord; candidate: LearningCandidate }> {
    const timestamp = new Date().toISOString()
    const content = canonicalContent(input)
    return integrityHash(content).then(integrity => {
      const interactionId = `interaction-${integrity}`
      const version = this.nextVersion()
      const interaction: CorpusRecord = {
        id: interactionId,
        corpusId: 'nexus-local',
        source: input.source || 'forgeclaw',
        content: input.result,
        timestamp,
        version,
        recordType: 'interaction',
        integrity,
        admissionStatus: 'raw',
        metadata: { input: input.input, runtime: input.runtime, model: input.model },
      }
      this.saveRecord(interaction)
      const candidate: LearningCandidate = {
        ...interaction,
        id: `candidate-${integrity}`,
        recordType: 'learning_candidate',
        admissionStatus: 'candidate',
        sourceInteractionId: interactionId,
        runtime: input.runtime,
        model: input.model,
        input: input.input,
        context: input.context,
        generatedResult: input.result,
      }
      this.saveRecord(candidate, true)
      return { interaction, candidate }
    })
  }

  retrieve(query: string, limit = 3): CorpusRecord[] {
    const queryTokens = tokenise(query)
    if (!queryTokens.length) return []
    const matches: Array<{ record: CorpusRecord; score: number }> = []
    for (const id of readIndex(INDEX_KEY)) {
      const record = safeRecord(safeGetItem(`${RECORD_PREFIX}${id}`))
      if (!record || record.admissionStatus !== 'approved') continue
      const haystack = tokenise(`${record.content} ${Object.values(record.metadata).join(' ')}`)
      const score = queryTokens.reduce((total, token) => total + (haystack.includes(token) ? 1 : 0), 0)
      if (score > 0) matches.push({ record, score })
    }
    return matches.sort((a, b) => b.score - a.score || b.record.timestamp.localeCompare(a.record.timestamp)).slice(0, limit).map(item => item.record)
  }

  async admitCandidate(candidateId: string): Promise<CorpusRecord | null> {
    const raw = safeGetItem(`${CANDIDATE_PREFIX}${candidateId}`)
    if (!raw) return null
    let candidate: LearningCandidate
    try {
      candidate = JSON.parse(raw) as LearningCandidate
    } catch {
      return null
    }
    if (candidate.admissionStatus !== 'candidate' || !candidate.sourceInteractionId || !candidate.input || !candidate.generatedResult) return null
    const expectedIntegrity = await integrityHash([candidate.input, candidate.context, candidate.generatedResult, candidate.runtime, candidate.model].join('\n'))
    if (expectedIntegrity !== candidate.integrity) return null
    const approved: CorpusRecord = {
      id: `knowledge-${candidate.integrity}`,
      corpusId: candidate.corpusId,
      source: candidate.source,
      content: candidate.generatedResult,
      timestamp: candidate.timestamp,
      version: this.nextVersion(),
      recordType: 'knowledge',
      integrity: candidate.integrity,
      admissionStatus: 'approved',
      metadata: { input: candidate.input, runtime: candidate.runtime, model: candidate.model, sourceInteractionId: candidate.sourceInteractionId },
    }
    if (readIndex(INDEX_KEY).includes(approved.id)) return approved
    this.saveRecord(approved)
    return approved
  }

  async syncPending(webhookUrl: string, fetchImpl: typeof fetch = fetch): Promise<CorpusSyncResult> {
    const ids = readIndex(CANDIDATE_INDEX_KEY)
    if (!webhookUrl.trim()) return { attempted: 0, admitted: 0, status: 'skipped', reason: 'No webhook configured.' }
    if (!ids.length) return { attempted: 0, admitted: 0, status: 'synced', reason: 'No pending candidates.' }
    const records = ids.flatMap(id => {
      const raw = safeGetItem(`${CANDIDATE_PREFIX}${id}`)
      if (!raw) return []
      try {
        const value = JSON.parse(raw) as LearningCandidate
        return value && value.id && value.admissionStatus === 'candidate' ? [value] : []
      } catch {
        return []
      }
    })
    try {
      const response = await fetchImpl(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ corpusId: 'nexus-local', version: this.getVersion(), records }) })
      if (!response.ok) return { attempted: records.length, admitted: 0, status: 'pending', reason: `Webhook HTTP ${response.status}` }
      const body = await response.json().catch(() => ({})) as { updates?: unknown }
      let admitted = 0
      for (const update of Array.isArray(body.updates) ? body.updates : []) {
        if (!update || typeof update !== 'object') continue
        const value = update as Partial<LearningCandidate>
        if (typeof value.id !== 'string') continue
        let result = await this.admitCandidate(value.id)
        if (!result && value.recordType === 'learning_candidate' && value.admissionStatus === 'candidate' && typeof value.integrity === 'string' && typeof value.corpusId === 'string' && typeof value.source === 'string' && typeof value.content === 'string' && typeof value.timestamp === 'string' && typeof value.version === 'number' && typeof value.sourceInteractionId === 'string' && typeof value.runtime === 'string' && typeof value.model === 'string' && typeof value.input === 'string' && typeof value.context === 'string' && typeof value.generatedResult === 'string' && value.metadata && typeof value.metadata === 'object') {
          const remoteCandidate = value as LearningCandidate
          safeSetItem(`${CANDIDATE_PREFIX}${remoteCandidate.id}`, JSON.stringify(remoteCandidate))
          const candidateIds = readIndex(CANDIDATE_INDEX_KEY)
          if (!candidateIds.includes(remoteCandidate.id)) writeIndex(CANDIDATE_INDEX_KEY, [...candidateIds, remoteCandidate.id])
          result = await this.admitCandidate(remoteCandidate.id)
        }
        if (result) admitted += 1
      }
      return { attempted: records.length, admitted, status: 'synced' }
    } catch {
      return { attempted: records.length, admitted: 0, status: 'pending', reason: 'Webhook unavailable.' }
    }
  }
}

export const corpusRepository = new CorpusRepository()

export function formatCorpusContext(records: CorpusRecord[]): string {
  if (!records.length) return ''
  return records.map((record, index) => `[Corpus ${index + 1} | ${record.source} | ${record.timestamp}]\n${record.content}`).join('\n\n')
}
