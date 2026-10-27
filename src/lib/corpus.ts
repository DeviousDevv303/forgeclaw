// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── NEXUS / Corpus Local Store ──────────────────────────────────────────────
// Small, deterministic, localStorage-backed corpus ledger. No network is needed
// to initialize or use this module; synchronization is an explicit optional path.

import { safeGetItem, safeRemoveItem, safeSetItem, strictGetItem, strictRemoveItem, strictSetItem, type StorageResult } from './storage'
import { DEEPSEEK_PRIMARY_CHECKPOINT } from './deepseekCheckpoints'
import { CONVERGED_BY, convergencePhase } from './nexusConvergence'
import { type AdmissionTrustConfig, type CandidateAuthorization, type AuthorizationValidation, verifyCandidateAuthorization } from './corpusAdmissionAuth'

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
  provenance?: Record<string, string>
}

export interface ShellCorpusExperienceInput extends CorpusInteractionInput {
  provenance: Record<string, string>
}

export interface CorpusInteractionInput {
  input: string
  context: string
  result: string
  runtime: string
  model: string
  source?: string
  metadata?: Record<string, string>
}

export interface CorpusSyncResult {
  /** Candidates sent in the POST. */
  attempted: number
  /** Remote candidates the reply returned that were stored locally as UNADMITTED candidates. Sending or receiving never admits anything. */
  received: number
  status: 'skipped' | 'synced' | 'pending' | 'rejected'
  reason?: string
}

export interface CandidateAdmissionResult {
  status: 'admitted' | 'already_admitted' | 'rejected'
  record?: CorpusRecord
  reason?: string
  detail?: string
}

/**
 * Directive item 3 — NEXUS Learning.
 * Design decision: DeepSeek output enters the existing raw-interaction and
 * unapproved-candidate pipeline instead of bypassing integrity/admission.
 * Remaining work: a later verifier or explicit sync must admit candidates.
 */
export interface DeepSeekLearningInput {
  task: string
  result: string
  invocationId: string
  context?: string
  /** Checkpoint that actually produced the result (result_meta.txt `model=`). Defaults to the primary. */
  model?: string
}

export interface ImageGenerationLearningInput {
  prompt: string
  style: string
  width: number
  height: number
  invocationId: string
}

/** One MiroFish sim run, as NEXUS learns it: how the run went, so the next one is run better. Never evidence about a fight. */
export interface SimRunLearningInput {
  simKey: string
  invocationId: string
  status: string
  reason: string
  preset: string
  model: string
  packetSha256: string
  packetChars: number | null
  agents: number | null
  simulatedActions: number | null
  reloggedSeedPosts: number | null
  pollAnswered: number | null
  costUsd: number | null
  calls: number | null
  runUrl: string
}

export interface AutonomousFixLearningInput {
  filesChanged: string[]
  description: string
  testCountBefore: number
  testCountAfter: number
  prUrl: string
}

export interface ImagePatterns {
  subjects: string[]
  descriptors: string[]
  composition: string[]
  lighting: string[]
  colorPalette: string[]
  styleRules: string[]
}

export interface NexusKnowledge {
  content: string
  source: string
  recordId: string
  score: number
  metadata: Record<string, string>
}

const INDEX_KEY = 'forgeclaw_nexus_index_v1'
const VERSION_KEY = 'forgeclaw_nexus_version_v1'
const RECORD_PREFIX = 'forgeclaw_nexus_record_v1:'
const CANDIDATE_PREFIX = 'forgeclaw_nexus_candidate_v1:'
const CANDIDATE_INDEX_KEY = 'forgeclaw_nexus_candidate_index_v1'
/** Integrity hashes of auto-admitted entries the owner removed; they never converge again. */
const DECLINED_KEY = 'forgeclaw_nexus_declined_v1'
const MAX_INDEX_ENTRIES = 10_000

/**
 * Index storage layout (v2, chunked). An index used to be one JSON array of up to MAX_INDEX_ENTRIES ids stored at the
 * index key itself, so every append re-parsed and re-wrote the whole array: O(n) per append, O(n²) over a full index —
 * a tax paid on every chat interaction (appendInteraction → saveRecord) and by the 10,000-record test (~31 s alone).
 * Now the value at the index key is a small meta object ({ v: 2, first, last, count }) and the ids live in chunk keys
 * (`<key>:chunk:<n>`, n from first to last), each a JSON array of up to INDEX_CHUNK_SIZE ids, oldest first. Appending
 * rewrites only the tail chunk plus the meta; the cap trim touches only head chunks.
 * Compatibility: a stored v1 array is still read exactly as before, and the first write converts it to chunks with
 * the same ids in the same order (lossless, automatic; there is no separate migration step). An unreadable value
 * still reads as an empty index, as it did before.
 */
const INDEX_CHUNK_SIZE = 512

interface IndexMeta {
  v: 2
  first: number
  last: number
  count: number
}

function indexChunkKey(key: string, chunk: number): string {
  return `${key}:chunk:${chunk}`
}

function parseIdArray(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

function parseIndexMeta(raw: string | null): IndexMeta | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<IndexMeta> | null
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.v !== 2) return null
    const { first, last, count } = parsed
    if (!Number.isInteger(first) || !Number.isInteger(last) || !Number.isInteger(count)) return null
    if ((first as number) < 0 || (last as number) < (first as number) || (count as number) < 0) return null
    return { v: 2, first: first as number, last: last as number, count: count as number }
  } catch {
    return null
  }
}

function readIndex(key: string): string[] {
  const raw = safeGetItem(key)
  if (!raw) return []
  const meta = parseIndexMeta(raw)
  if (!meta) return parseIdArray(raw)
  const ids: string[] = []
  for (let chunk = meta.first; chunk <= meta.last; chunk += 1) {
    ids.push(...parseIdArray(safeGetItem(indexChunkKey(key, chunk))))
  }
  return ids
}

/** Records NEXUS removes at a time, oldest first, when the browser's storage is full. */
// Three, not more: when storage is nearly full, a bigger batch removes far more than the new record needs (25 emptied a store
// that held only a handful of entries). Each retry re-checks whether the record fits, so a small batch costs only a few loops.
const PRUNE_BATCH = 3

/**
 * A write that does not fit used to be swallowed (safeSetItem), so NEXUS quietly stopped recording once the browser's
 * storage filled (2026-10-21: the newest entry on the NEXUS page was hours old). Now the oldest unapproved entries are removed
 * to make room, and if nothing more can be removed the failure is raised, so the caller reports it instead of pretending.
 */
function setWithRoom(key: string, value: string, makeRoom: () => number): void {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (strictSetItem(key, value).ok) return
    if (makeRoom() === 0) break
  }
  throw new Error('NEXUS storage is full and nothing older could be removed to make room')
}

/** How index chunk/meta writes behave when storage refuses: prune-and-retry, best-effort, or strict (admission). */
interface IndexWriteOps {
  set: (key: string, value: string) => void
  remove: (key: string) => void
}

const QUIET_INDEX_OPS: IndexWriteOps = {
  set: (key, value) => safeSetItem(key, value),
  remove: (key) => safeRemoveItem(key),
}

/**
 * Rewrites the whole index in chunked form (the removal/rewrite paths; appends use appendIndexId instead).
 * Any previous chunk range is removed first, so no stale chunk survives past the new meta's `last`.
 */
function writeIndexChunks(key: string, ids: string[], ops: IndexWriteOps): void {
  const capped = ids.slice(-MAX_INDEX_ENTRIES)
  const previous = parseIndexMeta(safeGetItem(key))
  if (previous) {
    for (let chunk = previous.first; chunk <= previous.last; chunk += 1) ops.remove(indexChunkKey(key, chunk))
  }
  const chunkCount = Math.max(1, Math.ceil(capped.length / INDEX_CHUNK_SIZE))
  for (let chunk = 0; chunk < chunkCount; chunk += 1) {
    ops.set(indexChunkKey(key, chunk), JSON.stringify(capped.slice(chunk * INDEX_CHUNK_SIZE, (chunk + 1) * INDEX_CHUNK_SIZE)))
  }
  const meta: IndexMeta = { v: 2, first: 0, last: chunkCount - 1, count: capped.length }
  ops.set(key, JSON.stringify(meta))
}

function writeIndex(key: string, ids: string[], makeRoom: () => number = () => 0): void {
  writeIndexChunks(key, ids, {
    set: (chunkKey, value) => setWithRoom(chunkKey, value, makeRoom),
    remove: (chunkKey) => safeRemoveItem(chunkKey),
  })
}

/**
 * Appends one id to the index, rewriting only the tail chunk (≤ INDEX_CHUNK_SIZE ids) and the meta — the fix for the
 * old behaviour, where every append re-wrote the whole ≤10,000-id array. The MAX_INDEX_ENTRIES cap is enforced by
 * trimming head chunks. A legacy v1 array is converted to chunks first (same ids, same order).
 */
function appendIndexId(key: string, id: string, makeRoom: () => number = () => 0): void {
  const set = (chunkKey: string, value: string) => setWithRoom(chunkKey, value, makeRoom)
  const raw = safeGetItem(key)
  let meta = parseIndexMeta(raw)
  if (!meta) {
    writeIndex(key, parseIdArray(raw), makeRoom)
    meta = parseIndexMeta(safeGetItem(key)) ?? { v: 2, first: 0, last: 0, count: 0 }
  }
  let tail = meta.count === 0 ? [] : parseIdArray(safeGetItem(indexChunkKey(key, meta.last)))
  if (tail.length >= INDEX_CHUNK_SIZE) {
    meta = { ...meta, last: meta.last + 1 }
    tail = []
  }
  tail.push(id)
  set(indexChunkKey(key, meta.last), JSON.stringify(tail))
  meta = { ...meta, count: meta.count + 1 }
  while (meta.count > MAX_INDEX_ENTRIES) {
    const excess: number = meta.count - MAX_INDEX_ENTRIES
    const head: string[] = meta.first === meta.last ? tail : parseIdArray(safeGetItem(indexChunkKey(key, meta.first)))
    if (meta.first < meta.last && excess >= head.length) {
      safeRemoveItem(indexChunkKey(key, meta.first))
      meta = { ...meta, first: meta.first + 1, count: meta.count - head.length }
    } else {
      const kept = head.slice(excess)
      set(indexChunkKey(key, meta.first), JSON.stringify(kept))
      if (meta.first === meta.last) tail = kept
      meta = { ...meta, count: meta.count - excess }
    }
  }
  set(key, JSON.stringify(meta))
}

/** writeIndexChunks with strict failure reporting: the first storage failure aborts and is returned, never swallowed. */
function writeIndexChunksStrict(key: string, ids: string[]): StorageResult<void> {
  const capped = ids.slice(-MAX_INDEX_ENTRIES)
  const previousRaw = strictGetItem(key)
  if (!previousRaw.ok) return { ok: false, error: previousRaw.error }
  const previous = parseIndexMeta(previousRaw.value ?? null)
  if (previous) {
    for (let chunk = previous.first; chunk <= previous.last; chunk += 1) {
      const removed = strictRemoveItem(indexChunkKey(key, chunk))
      if (!removed.ok) return removed
    }
  }
  const chunkCount = Math.max(1, Math.ceil(capped.length / INDEX_CHUNK_SIZE))
  for (let chunk = 0; chunk < chunkCount; chunk += 1) {
    const written = strictSetItem(indexChunkKey(key, chunk), JSON.stringify(capped.slice(chunk * INDEX_CHUNK_SIZE, (chunk + 1) * INDEX_CHUNK_SIZE)))
    if (!written.ok) return written
  }
  const meta: IndexMeta = { v: 2, first: 0, last: chunkCount - 1, count: capped.length }
  return strictSetItem(key, JSON.stringify(meta))
}

/**
 * appendIndexId with strict failure reporting (the admission path): same layout and conversion rules as the
 * non-strict path, but the first storage failure aborts and is returned. A legacy array already containing the id
 * needs no write; an unreadable value is treated as an empty index, exactly as the strict path has always done.
 */
function appendIndexIdStrict(key: string, id: string): StorageResult<void> {
  const rawResult = strictGetItem(key)
  if (!rawResult.ok) return { ok: false, error: rawResult.error }
  const meta = parseIndexMeta(rawResult.value ?? null)
  if (!meta) {
    const legacy = parseIdArray(rawResult.value ?? null)
    if (legacy.includes(id)) return { ok: true }
    return writeIndexChunksStrict(key, [...legacy, id])
  }
  let tail: string[] = []
  for (let chunk = meta.first; chunk <= meta.last; chunk += 1) {
    const partResult = strictGetItem(indexChunkKey(key, chunk))
    if (!partResult.ok) return { ok: false, error: partResult.error }
    const part = parseIdArray(partResult.value ?? null)
    if (part.includes(id)) return { ok: true }
    if (chunk === meta.last) tail = part
  }
  let last = meta.last
  if (tail.length >= INDEX_CHUNK_SIZE) {
    last += 1
    tail = []
  }
  tail.push(id)
  const tailWrite = strictSetItem(indexChunkKey(key, last), JSON.stringify(tail))
  if (!tailWrite.ok) return tailWrite
  let next: IndexMeta = { ...meta, last, count: meta.count + 1 }
  while (next.count > MAX_INDEX_ENTRIES) {
    const excess = next.count - MAX_INDEX_ENTRIES
    const headResult = strictGetItem(indexChunkKey(key, next.first))
    if (!headResult.ok) return { ok: false, error: headResult.error }
    const head = next.first === last ? tail : parseIdArray(headResult.value ?? null)
    if (next.first < next.last && excess >= head.length) {
      const removed = strictRemoveItem(indexChunkKey(key, next.first))
      if (!removed.ok) return removed
      next = { ...next, first: next.first + 1, count: next.count - head.length }
    } else {
      const kept = head.slice(excess)
      const headWrite = strictSetItem(indexChunkKey(key, next.first), JSON.stringify(kept))
      if (!headWrite.ok) return headWrite
      if (next.first === last) tail = kept
      next = { ...next, count: next.count - excess }
    }
  }
  return strictSetItem(key, JSON.stringify(next))
}

function tokenise(value: string): string[] {
  return Array.from(new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length >= 2)))
}

function taskCategory(task: string): string {
  const value = task.toLowerCase()
  if (/\b(code|coding|typescript|javascript|python|bug|debug|function|api|test)\b/.test(value)) return 'code'
  if (/\b(architecture|design|system|workflow|infrastructure|repository)\b/.test(value)) return 'architecture'
  if (/\b(analy[sz]|compare|evaluate|research|investigate|tradeoff)\b/.test(value)) return 'analysis'
  if (/\b(write|draft|email|summarize|rewrite|translate)\b/.test(value)) return 'writing'
  return 'general'
}

function taskComplexity(task: string, context = ''): string {
  const size = task.length + context.length
  if (size > 700 || /\b(architecture|migration|multi[- ]step|deep|comprehensive|production)\b/i.test(task)) return 'complex'
  if (size > 180 || /\b(explain|debug|compare|design|analy[sz]e|implement)\b/i.test(task)) return 'moderate'
  return 'simple'
}

function deepSeekMetadata(task: string, context: string): Record<string, string> {
  return {
    keywords: tokenise(`${task} ${context}`).slice(0, 24).join(','),
    taskType: taskCategory(task),
    complexity: taskComplexity(task, context),
  }
}

const IMAGE_STOPWORDS = new Set(['generate', 'image', 'create', 'please', 'with', 'and', 'the', 'a', 'an', 'for', 'style', 'high', 'quality'])
const IMAGE_COMPOSITION = ['close-up', 'portrait', 'wide shot', 'landscape', 'overhead', 'isometric', 'centered', 'symmetrical', 'rule of thirds', 'cinematic']
const IMAGE_LIGHTING = ['golden hour', 'soft light', 'dramatic lighting', 'natural light', 'studio lighting', 'neon lighting', 'backlit', 'rim light', 'low key', 'high key']
const IMAGE_COLORS = ['warm tones', 'cool tones', 'vibrant', 'muted', 'pastel', 'monochrome', 'black and white', 'teal and orange', 'earth tones', 'golden']

export function extractImagePatterns(prompt: string, style = ''): ImagePatterns {
  const text = `${prompt} ${style}`.toLowerCase()
  const words = tokenise(text).filter(word => !IMAGE_STOPWORDS.has(word))
  const subjects = words.filter(word => !/^(realistic|artistic|cartoon|digital|photorealistic|detailed|beautiful|high|quality)$/.test(word)).slice(0, 8)
  const descriptors = words.filter(word => /^(beautiful|detailed|vibrant|minimalist|serene|dramatic|realistic|artistic|cartoon|photorealistic|futuristic|organic|cozy|elegant)$/.test(word)).slice(0, 8)
  const findPhrases = (phrases: string[]) => phrases.filter(phrase => text.includes(phrase))
  return {
    subjects,
    descriptors,
    composition: findPhrases(IMAGE_COMPOSITION),
    lighting: findPhrases(IMAGE_LIGHTING),
    colorPalette: findPhrases(IMAGE_COLORS),
    styleRules: style.trim() ? [style.trim().toLowerCase()] : [],
  }
}

function mergeImagePatterns(patterns: ImagePatterns[]): ImagePatterns {
  const unique = (values: string[]) => Array.from(new Set(values)).slice(0, 12)
  return {
    subjects: unique(patterns.flatMap(pattern => pattern.subjects)),
    descriptors: unique(patterns.flatMap(pattern => pattern.descriptors)),
    composition: unique(patterns.flatMap(pattern => pattern.composition)),
    lighting: unique(patterns.flatMap(pattern => pattern.lighting)),
    colorPalette: unique(patterns.flatMap(pattern => pattern.colorPalette)),
    styleRules: unique(patterns.flatMap(pattern => pattern.styleRules)),
  }
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
  private readonly trustConfig: AdmissionTrustConfig

  constructor(trustConfig: AdmissionTrustConfig = {}) {
    this.trustConfig = trustConfig
  }

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
    const makeRoom = () => this.pruneUnapproved(PRUNE_BATCH)
    // Record ids are content-derived, and prune/removal always delete a record and its index entry together, so a
    // stored record is indexed unless the index lost it (corruption) — the membership check heals that case exactly
    // as the old full-index scan did. A genuinely new id takes the append fast path (tail chunk only).
    const alreadyIndexed = safeGetItem(`${prefix}${record.id}`) !== null && readIndex(indexKey).includes(record.id)
    setWithRoom(`${prefix}${record.id}`, JSON.stringify(record), makeRoom)
    if (!alreadyIndexed) appendIndexId(indexKey, record.id, makeRoom)
  }

  /**
   * Removes up to `count` of the oldest entries that are not knowledge (a candidate and the raw interaction it came from).
   * Auto-added and signed knowledge is never removed. Returns how many it removed.
   */
  private pruneUnapproved(count: number): number {
    const candidateIds = readIndex(CANDIDATE_INDEX_KEY)
    const keep: string[] = []
    const rawGone = new Set<string>()
    let removed = 0
    for (const id of candidateIds) {
      if (removed >= count) { keep.push(id); continue }
      let candidate: LearningCandidate | null = null
      try { candidate = JSON.parse(safeGetItem(`${CANDIDATE_PREFIX}${id}`) || 'null') as LearningCandidate | null } catch { /* a corrupt record is removable */ }
      if (candidate?.admissionStatus === 'approved') { keep.push(id); continue }
      safeRemoveItem(`${CANDIDATE_PREFIX}${id}`)
      if (candidate?.sourceInteractionId) { safeRemoveItem(`${RECORD_PREFIX}${candidate.sourceInteractionId}`); rawGone.add(candidate.sourceInteractionId) }
      removed += 1
    }
    if (removed === 0) return 0
    // The shrunken indexes are smaller than what they replace, so these writes fit.
    writeIndexChunks(CANDIDATE_INDEX_KEY, keep, QUIET_INDEX_OPS)
    if (rawGone.size) writeIndexChunks(INDEX_KEY, readIndex(INDEX_KEY).filter(id => !rawGone.has(id)), QUIET_INDEX_OPS)
    return removed
  }

  /** Strict variant for admission path — surfaces storage failures instead of swallowing them. */
  private saveRecordStrict(record: CorpusRecord): StorageResult<void> {
    const writeResult = strictSetItem(`${RECORD_PREFIX}${record.id}`, JSON.stringify(record))
    if (!writeResult.ok) return writeResult
    return appendIndexIdStrict(INDEX_KEY, record.id)
  }

  getInteractionCount(): number {
    return readIndex(INDEX_KEY).length
  }

  getCandidateCount(): number {
    return readIndex(CANDIDATE_INDEX_KEY).length
  }

  /** Learning candidates, newest first. Read-only view for the NEXUS page; never changes admission. */
  listCandidates(limit = 1000): LearningCandidate[] {
    const out: LearningCandidate[] = []
    for (const id of readIndex(CANDIDATE_INDEX_KEY).slice(-limit)) {
      const raw = safeGetItem(`${CANDIDATE_PREFIX}${id}`)
      if (!raw) continue
      try { out.push(JSON.parse(raw) as LearningCandidate) } catch { /* skip a corrupt record */ }
    }
    // Newest first. The index is oldest-first and the sort is stable, so reversing first makes records stamped in the same
    // millisecond come back newest-first too, instead of in whatever order they tied.
    return out.reverse().sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  }

  /** Knowledge the convergence rule admitted, by phase (nexusConvergence.ts). */
  /**
   * Everything NEXUS treats as knowledge, newest first, so the owner can see it and remove what is wrong. Until this existed
   * the page showed only a count: 33 admitted entries of unknown origin (2026-10-21) could not be inspected at all.
   */
  listKnowledge(limit = 300): CorpusRecord[] {
    const out: CorpusRecord[] = []
    for (const id of readIndex(INDEX_KEY)) {
      const record = safeRecord(safeGetItem(`${RECORD_PREFIX}${id}`))
      if (record?.admissionStatus === 'approved') out.push(record)
    }
    return out.reverse().sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit)
  }

  /** Removes a knowledge record. One NEXUS added by itself is also declined, so the same entry is never added again. */
  removeKnowledge(recordId: string): boolean {
    const record = safeRecord(safeGetItem(`${RECORD_PREFIX}${recordId}`))
    if (!record || record.admissionStatus !== 'approved') return false
    safeRemoveItem(`${RECORD_PREFIX}${recordId}`)
    writeIndex(INDEX_KEY, readIndex(INDEX_KEY).filter(id => id !== recordId))
    if (record.metadata.admittedBy === CONVERGED_BY) {
      const declined = readIndex(DECLINED_KEY)
      if (!declined.includes(record.integrity)) writeIndex(DECLINED_KEY, [...declined, record.integrity])
      const candidateKey = `${CANDIDATE_PREFIX}candidate-${record.integrity}`
      try {
        const candidate = JSON.parse(safeGetItem(candidateKey) || 'null') as LearningCandidate | null
        if (candidate) safeSetItem(candidateKey, JSON.stringify({ ...candidate, admissionStatus: 'rejected' }))
      } catch { /* the knowledge record is gone either way */ }
    }
    return true
  }

  getConvergedCounts(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const id of readIndex(INDEX_KEY)) {
      const record = safeRecord(safeGetItem(`${RECORD_PREFIX}${id}`))
      if (record?.admissionStatus !== 'approved' || record.metadata.admittedBy !== CONVERGED_BY) continue
      const phase = record.metadata.phase || 'other'
      counts[phase] = (counts[phase] ?? 0) + 1
    }
    return counts
  }

  /**
   * Knowledge that counts as a training example: only what earned its place with evidence (auto-added by convergence).
   * The "approved" total also holds the legacy entries admitted with no review (Sep 24 – Oct 13): on 2026-10-21 they were
   * 30 of 38 and mostly junk (model gibberish, non-answers), so the road to the NEXUS LLM was counting them as training data.
   */
  getTrainingCount(): number {
    let count = 0
    for (const id of readIndex(INDEX_KEY)) {
      const record = safeRecord(safeGetItem(`${RECORD_PREFIX}${id}`))
      if (record?.admissionStatus === 'approved' && record.metadata.admittedBy === CONVERGED_BY) count += 1
    }
    return count
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
        metadata: { input: input.input, runtime: input.runtime, model: input.model, ...(input.metadata || {}) },
      }
      this.saveRecord(interaction)
      // The loop closes by itself for evidence-backed records (nexusConvergence.ts); everything else stays a candidate.
      // An entry the owner removed never converges again.
      const phase = readIndex(DECLINED_KEY).includes(integrity) ? null : convergencePhase(input)
      const admitted: Record<string, string> = phase ? { admittedBy: CONVERGED_BY, phase, admittedAt: timestamp } : {}
      // The same fact from several runs is one record; it remembers every run that produced it (newest 20).
      const run = input.metadata?.run
      let runs: Record<string, string> = {}
      if (run) {
        let prior: string[] = []
        try { prior = (JSON.parse(safeGetItem(`${CANDIDATE_PREFIX}candidate-${integrity}`) || 'null') as LearningCandidate | null)?.metadata?.runs?.split(',') ?? [] } catch { /* a corrupt prior record has no runs */ }
        runs = { run, runs: [...new Set([...prior.filter(Boolean), run])].slice(-20).join(',') }
      }
      const candidate: LearningCandidate = {
        ...interaction,
        metadata: { ...interaction.metadata, ...runs, ...admitted },
        id: `candidate-${integrity}`,
        recordType: 'learning_candidate',
        admissionStatus: phase ? 'approved' : 'candidate',
        sourceInteractionId: interactionId,
        runtime: input.runtime,
        model: input.model,
        input: input.input,
        context: input.context,
        generatedResult: input.result,
      }
      this.saveRecord(candidate, true)
      if (phase) {
        this.saveRecord({
          id: `knowledge-${integrity}`,
          corpusId: interaction.corpusId,
          source: interaction.source,
          content: input.result,
          timestamp,
          version: this.nextVersion(),
          recordType: 'knowledge',
          integrity,
          admissionStatus: 'approved',
          metadata: { input: input.input, runtime: input.runtime, model: input.model, sourceInteractionId: interactionId, ...runs, ...admitted },
        })
      }
      return { interaction, candidate }
    })
  }

  appendDeepSeekLearning(input: DeepSeekLearningInput): Promise<{ interaction: CorpusRecord; candidate: LearningCandidate }> {
    return this.appendInteraction({
      input: `[DEEPSEEK_TASK] ${input.task}`,
      context: input.context || `invocation_id=${input.invocationId}`,
      result: `[DEEPSEEK_RESULT]\n${input.result}`,
      runtime: 'github-actions',
      model: input.model || DEEPSEEK_PRIMARY_CHECKPOINT,
      source: 'deepseek:github-actions',
      metadata: deepSeekMetadata(input.task, input.context || ''),
    })
  }

  appendImageGenerationLearning(input: ImageGenerationLearningInput): Promise<{ interaction: CorpusRecord; candidate: LearningCandidate }> {
    const context = `style=${input.style}; size=${input.width}x${input.height}; invocation_id=${input.invocationId}`
    const patterns = extractImagePatterns(input.prompt, input.style)
    return this.appendInteraction({
      input: `[IMAGE_GENERATION_PROMPT] ${input.prompt}`,
      context,
      result: `[FLUX_GENERATION_REQUEST]\n${context}`,
      runtime: 'github-actions',
      model: 'FLUX.1-dev',
      source: 'flux:github-actions',
      metadata: {
        keywords: tokenise(`${input.prompt} ${input.style}`).slice(0, 24).join(','),
        taskType: 'image-generation',
        complexity: 'moderate',
        imagePatterns: JSON.stringify(patterns),
      },
    })
  }

  appendSimRunLearning(input: SimRunLearningInput): Promise<{ interaction: CorpusRecord; candidate: LearningCandidate }> {
    const n = (v: number | null) => (v === null ? 'unknown' : String(v))
    const outcome = `${input.status}${input.reason ? ` (${input.reason})` : ''}; agents ${n(input.agents)}; agent actions ${n(input.simulatedActions)}; ` +
      `repeated seed posts dropped ${n(input.reloggedSeedPosts)}; poll answered ${n(input.pollAnswered)}; cost $${input.costUsd === null ? 'unknown' : input.costUsd.toFixed(4)} over ${n(input.calls)} model calls`
    return this.appendInteraction({
      input: `[SIM_RUN] ${input.simKey}, preset ${input.preset}, ${input.model}; packet ${n(input.packetChars)} chars, sha256 ${input.packetSha256 || 'unknown'}`,
      context: `invocation_id=${input.invocationId}; run=${input.runUrl}`,
      result: `[SIM_OUTCOME] ${outcome}. A record of how the run went, for running the next one better; its poll measures simulated personas and is never evidence about the fight.`,
      runtime: 'github-actions',
      model: `mirofish+${input.model}`,
      // No channel or outcome field: a sim record never converges on its own (nexusConvergence.ts); the owner reviews it.
      source: 'mirofish:github-actions',
      metadata: {
        keywords: tokenise(`mirofish swarm simulation sim ${input.preset} ${input.status} ${input.reason}`).slice(0, 24).join(','),
        taskType: 'swarm-simulation',
        complexity: 'moderate',
        simKey: input.simKey,
        notEvidence: 'true',
      },
    })
  }

  appendAutonomousFixLearning(input: AutonomousFixLearningInput): Promise<{ interaction: CorpusRecord; candidate: LearningCandidate }> {
    return this.appendInteraction({
      input: JSON.stringify({ filesChanged: input.filesChanged, description: input.description }),
      context: JSON.stringify({ testCountBefore: input.testCountBefore, testCountAfter: input.testCountAfter }),
      result: JSON.stringify({ prUrl: input.prUrl }),
      runtime: 'github-actions',
      model: 'forgeclaw-autonomous-fix',
      source: 'autonomous-fix',
      metadata: {
        filesChanged: JSON.stringify(input.filesChanged),
        testCountBefore: String(input.testCountBefore),
        testCountAfter: String(input.testCountAfter),
        prUrl: input.prUrl,
      },
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

  checkNexusKnowledge(task: string): NexusKnowledge | null {
    // A direct answer comes only from signed knowledge: a converged record is evidence for guidance, not a reply to serve.
    const match = this.retrieve(task, 5).find(record => record.metadata.admittedBy !== CONVERGED_BY)
    if (!match) return null
    const queryTokens = tokenise(task)
    const haystack = tokenise(`${match.content} ${Object.values(match.metadata).join(' ')}`)
    const score = queryTokens.reduce((total, token) => total + (haystack.includes(token) ? 1 : 0), 0)
    return { content: match.content, source: match.source, recordId: match.id, score, metadata: match.metadata }
  }

  getImageGenerationKnowledge(prompt: string, limit = 5): ImagePatterns {
    const records = this.retrieve(prompt, limit * 3).filter(record => record.source === 'flux:github-actions')
    const learned = records.flatMap(record => {
      try {
        const parsed = JSON.parse(record.metadata.imagePatterns || '') as ImagePatterns
        return parsed && Array.isArray(parsed.subjects) ? [parsed] : []
      } catch { return [] }
    })
    return mergeImagePatterns(learned)
  }

  async admitCandidate(candidateId: string, authorization: CandidateAuthorization): Promise<CandidateAdmissionResult> {
    const readResult = strictGetItem(`${CANDIDATE_PREFIX}${candidateId}`)
    if (!readResult.ok) return { status: 'rejected', reason: 'storage_unavailable', detail: readResult.error }
    const raw = readResult.value
    if (!raw) return { status: 'rejected', reason: 'candidate_not_found' }
    let candidate: LearningCandidate
    try {
      candidate = JSON.parse(raw) as LearningCandidate
    } catch {
      return { status: 'rejected', reason: 'candidate_malformed' }
    }
    if (candidate.admissionStatus !== 'candidate' || !candidate.sourceInteractionId || !candidate.input || !candidate.generatedResult) return { status: 'rejected', reason: 'candidate_invalid' }
    const authorizationValidation: AuthorizationValidation = await verifyCandidateAuthorization(authorization, candidate, this.trustConfig)
    if (!authorizationValidation.valid) return { status: 'rejected', reason: authorizationValidation.reason }
    const expectedIntegrity = await integrityHash([candidate.input, candidate.context, candidate.generatedResult, candidate.runtime, candidate.model].join('\n'))
    if (expectedIntegrity !== candidate.integrity) return { status: 'rejected', reason: 'candidate_integrity_invalid' }
    const approvedId = `knowledge-${candidate.integrity}`
    const existing = safeRecord(safeGetItem(`${RECORD_PREFIX}${approvedId}`))
    if (existing?.admissionStatus === 'approved') return { status: 'already_admitted', record: existing }
    const approved: CorpusRecord = {
      id: approvedId,
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
    const saveResult = this.saveRecordStrict(approved)
    if (!saveResult.ok) return { status: 'rejected', reason: 'storage_unavailable', detail: saveResult.error }
    return { status: 'admitted', record: approved }
  }

  /**
   * Store verified Shell evidence as an unapproved candidate. This is an
   * additive adapter over the existing candidate path; it never admits data.
   */
  appendShellExperience(input: ShellCorpusExperienceInput): Promise<{ interaction: CorpusRecord; candidate: LearningCandidate }> {
    const timestamp = new Date().toISOString()
    const content = canonicalContent(input)
    return integrityHash(content).then(integrity => {
      const interactionId = `interaction-${integrity}`
      const version = this.nextVersion()
      const interaction: CorpusRecord = {
        id: interactionId,
        corpusId: 'nexus-local',
        source: input.source || 'forgeclaw-shell',
        content: input.result,
        timestamp,
        version,
        recordType: 'interaction',
        integrity,
        admissionStatus: 'raw',
        metadata: { input: input.input, runtime: input.runtime, model: input.model, ...input.provenance },
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
        provenance: input.provenance,
      }
      this.saveRecord(candidate, true)
      return { interaction, candidate }
    })
  }

  /**
   * Stage 3b intake adapter (nexusIntake.ts): the same single candidate path as
   * appendShellExperience, plus the owner's auto-admission criteria for external
   * intake (Cristian, 2026-10-24 — audit-adjudicated records whose loop closed are
   * verified knowledge). When the caller passes `admittedBy`, the record is admitted
   * exactly the way the convergence rule admits in appendInteraction — the candidate
   * is marked approved with the marker and a knowledge record is saved — unless the
   * owner previously removed this exact content (DECLINED), in which case it stays a
   * candidate and is never re-admitted. Without `admittedBy` this behaves exactly
   * like appendShellExperience: an unapproved candidate, nothing more.
   */
  appendIntakeExperience(input: ShellCorpusExperienceInput, admittedBy?: string): Promise<{ interaction: CorpusRecord; candidate: LearningCandidate }> {
    const timestamp = new Date().toISOString()
    const content = canonicalContent(input)
    return integrityHash(content).then(integrity => {
      const interactionId = `interaction-${integrity}`
      const version = this.nextVersion()
      const interaction: CorpusRecord = {
        id: interactionId,
        corpusId: 'nexus-local',
        source: input.source || 'nexus-intake',
        content: input.result,
        timestamp,
        version,
        recordType: 'interaction',
        integrity,
        admissionStatus: 'raw',
        metadata: { input: input.input, runtime: input.runtime, model: input.model, ...input.provenance },
      }
      this.saveRecord(interaction)
      const admit = Boolean(admittedBy) && !readIndex(DECLINED_KEY).includes(integrity)
      const admitted: Record<string, string> = admit ? { admittedBy: admittedBy as string, admittedAt: timestamp } : {}
      const candidate: LearningCandidate = {
        ...interaction,
        metadata: { ...interaction.metadata, ...admitted },
        id: `candidate-${integrity}`,
        recordType: 'learning_candidate',
        admissionStatus: admit ? 'approved' : 'candidate',
        sourceInteractionId: interactionId,
        runtime: input.runtime,
        model: input.model,
        input: input.input,
        context: input.context,
        generatedResult: input.result,
        provenance: input.provenance,
      }
      this.saveRecord(candidate, true)
      if (admit) {
        this.saveRecord({
          id: `knowledge-${integrity}`,
          corpusId: interaction.corpusId,
          source: interaction.source,
          content: input.result,
          timestamp,
          version: this.nextVersion(),
          recordType: 'knowledge',
          integrity,
          admissionStatus: 'approved',
          metadata: { ...input.provenance, input: input.input, runtime: input.runtime, model: input.model, sourceInteractionId: interactionId, ...admitted },
        })
      }
      return { interaction, candidate }
    })
  }

  /** Reject a pending candidate durably while preserving the existing states. */
  async rejectCandidate(candidateId: string, reason = 'rejected by validation'): Promise<CorpusRecord | null> {
    const raw = safeGetItem(`${CANDIDATE_PREFIX}${candidateId}`)
    if (!raw) return null
    let candidate: LearningCandidate
    try { candidate = JSON.parse(raw) as LearningCandidate } catch { return null }
    // An entry NEXUS admitted by itself is removed here: its knowledge record is deleted and it is never admitted again.
    const converged = candidate.admissionStatus === 'approved' && candidate.metadata?.admittedBy === CONVERGED_BY
    if (candidate.admissionStatus !== 'candidate' && !converged) return null
    const expectedIntegrity = await integrityHash([candidate.input, candidate.context, candidate.generatedResult, candidate.runtime, candidate.model].join('\n'))
    if (expectedIntegrity !== candidate.integrity) return null
    if (converged) {
      const knowledgeId = `knowledge-${candidate.integrity}`
      safeRemoveItem(`${RECORD_PREFIX}${knowledgeId}`)
      writeIndex(INDEX_KEY, readIndex(INDEX_KEY).filter(id => id !== knowledgeId))
      const declined = readIndex(DECLINED_KEY)
      if (!declined.includes(candidate.integrity)) writeIndex(DECLINED_KEY, [...declined, candidate.integrity])
      safeSetItem(`${CANDIDATE_PREFIX}${candidate.id}`, JSON.stringify({ ...candidate, admissionStatus: 'rejected' }))
    }
    const rejected: CorpusRecord = {
      id: `rejected-${candidate.integrity}`,
      corpusId: candidate.corpusId,
      source: candidate.source,
      content: candidate.generatedResult,
      timestamp: candidate.timestamp,
      version: this.nextVersion(),
      recordType: 'knowledge',
      integrity: candidate.integrity,
      admissionStatus: 'rejected',
      metadata: { input: candidate.input, sourceInteractionId: candidate.sourceInteractionId, rejectionReason: reason, ...candidate.provenance },
    }
    if (!readIndex(INDEX_KEY).includes(rejected.id)) this.saveRecord(rejected)
    return rejected
  }

  async syncPending(webhookUrl: string, fetchImpl: typeof fetch = fetch): Promise<CorpusSyncResult> {
    const ids = readIndex(CANDIDATE_INDEX_KEY)
    if (!webhookUrl.trim()) return { attempted: 0, received: 0, status: 'skipped', reason: 'No webhook configured.' }
    if (!ids.length) return { attempted: 0, received: 0, status: 'synced', reason: 'No pending candidates.' }
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
      if (!response.ok) return { attempted: records.length, received: 0, status: 'pending', reason: `Webhook HTTP ${response.status}` }
      const rawBody = await response.text().catch(() => null)
      // F-022: 'synced' is verified against the SHAPE of the reply — a parseable
      // body containing the expected `updates` list — never against HTTP 200 and
      // never against parseability alone. An empty body, an unparseable body, or
      // a body with no `updates` list never read the artifact this status word
      // rests on, so each reports 'pending' instead of asserting a reconciliation
      // that never happened. The webhook receiver is not in this repo (its URL is
      // an owner-configured endpoint), so its reply contract is unverified — and
      // absence of evidence about a contract is not evidence of a permissive
      // contract: unverifiable shapes fail closed. (A present-but-empty `updates`
      // list stays 'synced' below: whether it can be a legitimate success is an
      // open contract question, flagged in PR #273.)
      if (rawBody === null || rawBody.trim() === '') {
        return { attempted: records.length, received: 0, status: 'pending', reason: 'Webhook answered with an empty reply; candidates were sent but the update list was not reconciled.' }
      }
      let body: unknown
      try {
        body = JSON.parse(rawBody) as unknown
      } catch {
        return { attempted: records.length, received: 0, status: 'pending', reason: 'Webhook answered but its reply could not be read; candidates were sent but the update list was not reconciled.' }
      }
      if (!body || typeof body !== 'object' || !Array.isArray((body as { updates?: unknown }).updates)) {
        return { attempted: records.length, received: 0, status: 'pending', reason: 'Webhook reply did not contain the expected updates list; candidates were sent but the update list was not reconciled.' }
      }
      const updates = (body as { updates: unknown[] }).updates
      let received = 0
      for (const update of updates) {
        if (!update || typeof update !== 'object') continue
        const value = update as Partial<LearningCandidate>
        if (typeof value.id !== 'string') continue
        if (value.recordType === 'learning_candidate' && value.admissionStatus === 'candidate' && typeof value.integrity === 'string' && typeof value.corpusId === 'string' && typeof value.source === 'string' && typeof value.content === 'string' && typeof value.timestamp === 'string' && typeof value.version === 'number' && typeof value.sourceInteractionId === 'string' && typeof value.runtime === 'string' && typeof value.model === 'string' && typeof value.input === 'string' && typeof value.context === 'string' && typeof value.generatedResult === 'string' && value.metadata && typeof value.metadata === 'object') {
          const remoteCandidate = value as LearningCandidate
          safeSetItem(`${CANDIDATE_PREFIX}${remoteCandidate.id}`, JSON.stringify(remoteCandidate))
          received += 1
          const candidateIds = readIndex(CANDIDATE_INDEX_KEY)
          if (!candidateIds.includes(remoteCandidate.id)) writeIndex(CANDIDATE_INDEX_KEY, [...candidateIds, remoteCandidate.id])
        }
      }
      return { attempted: records.length, received, status: 'synced' }
    } catch {
      return { attempted: records.length, received: 0, status: 'pending', reason: 'Webhook unavailable.' }
    }
  }
}

export const corpusRepository = new CorpusRepository()

/** Add a DeepSeek response to the local NEXUS learning ledger. */
export function appendDeepSeekLearning(
  task: string,
  deepseekResult: string,
  invocationId: string,
  context = '',
  model?: string,
): Promise<{ interaction: CorpusRecord; candidate: LearningCandidate }> {
  return corpusRepository.appendDeepSeekLearning({ task, result: deepseekResult, invocationId, context, model })
}

/** Return an approved local answer when NEXUS has a matching learned record. */
export function checkNexusKnowledge(task: string): NexusKnowledge | null {
  return corpusRepository.checkNexusKnowledge(task)
}

/** Record a FLUX generation request as an unapproved local learning candidate. */
export function appendImageGenerationLearning(input: ImageGenerationLearningInput): Promise<{ interaction: CorpusRecord; candidate: LearningCandidate }> {
  return corpusRepository.appendImageGenerationLearning(input)
}

/** Record one MiroFish sim run as an unapproved learning candidate (how it went, never evidence about the fight). */
export function appendSimRunLearning(input: SimRunLearningInput): Promise<{ interaction: CorpusRecord; candidate: LearningCandidate }> {
  return corpusRepository.appendSimRunLearning(input)
}

/** Record verified autonomous-fix facts as an unapproved learning candidate. */
export function appendAutonomousFixLearning(input: AutonomousFixLearningInput): Promise<{ interaction: CorpusRecord; candidate: LearningCandidate }> {
  return corpusRepository.appendAutonomousFixLearning(input)
}

/** Enhance a new image prompt with patterns learned from approved generations. */
export function suggestImprovedPrompt(prompt: string, style = ''): { prompt: string; patterns: ImagePatterns } {
  const patterns = corpusRepository.getImageGenerationKnowledge(prompt)
  const additions = [
    ...patterns.descriptors,
    ...patterns.composition,
    ...patterns.lighting,
    ...patterns.colorPalette,
  ].filter(Boolean)
  const uniqueAdditions = Array.from(new Set(additions)).filter(value => !prompt.toLowerCase().includes(value.toLowerCase())).slice(0, 6)
  const stylePart = style.trim() || patterns.styleRules[0] || ''
  const enhanced = [prompt.trim(), stylePart, ...uniqueAdditions].filter(Boolean).join(', ')
  return { prompt: enhanced, patterns }
}

export function formatCorpusContext(records: CorpusRecord[]): string {
  if (!records.length) return ''
  return records.map((record, index) => `[Corpus ${index + 1} | ${record.source} | ${record.timestamp}]\n${record.content}`).join('\n\n')
}
