/*
 * Copyright (c) 2026 DeviousDevv303 (Cristian)
 * ForgeClaw — Personal AI Assistant
 * Built with love for Cristian Jr., Layla, and Jozae
 */

/**
 * Synthetic Intuition, Step 0: the intuition packet (forgeclaw #235 verdict, Step 0 item 4).
 *
 * Deterministic, app-generated, never model-written. INTEGERS ONLY: no adjectives, no raw decimals, no record IDs. The
 * bucket is one digit 0-7, one token under the deployed tokenizer (verified by nexus-llm/tokenizer, see packet.test.ts).
 * Provenance binds by the packet HASH: the journal maps hash -> graded record IDs, and `resolvePacket` fails closed on any
 * packet whose hash does not resolve to eligible graded evidence that reproduces the same bucket.
 * No new special tokens: the packet is plain text inside the prompt frame, as data. It carries no instruction.
 *
 *   ix1 c=03 b=5 r=1 f=1 p=2
 *   c class code (registry position), b bound bucket 0-7, r rank of the hypothesis (1 = top), f falsifier pre-registered 0/1,
 *   p pressure events so far, capped at 7.
 */
import { BUCKET_EDGES_ID, ESTIMATOR_ID } from './boundMath'
import { assertFrozen, classIndex, type PatternRegistry } from './patternClasses'
import { canonicalJson, sha256Hex } from './sha256'
import { statsFor, type IntuitionLedger, type JournalEntry } from './ledger'

export const PACKET_SCHEMA = 'ix1'
/** Hard token budget in the 640-token window. Every character is a single piece, so characters bound tokens from above. */
export const PACKET_CHAR_BUDGET = 24

export interface PacketRequest {
  patternClassId: string
  regime: string
  /** rank of the active hypothesis among those considered, 1..7 */
  hypothesisRank: number
  falsifierRegistered: boolean
  pressureEvents: number
  now: string
  /** Tests and the exam harness only; production packets require a frozen registry. */
  allowDraft?: boolean
}

const pad2 = (n: number) => String(n).padStart(2, '0')

export function renderPacket(p: { classCode: number; bucket: number; rank: number; falsifier: boolean; pressure: number }): string {
  if (!Number.isInteger(p.classCode) || p.classCode < 0 || p.classCode > 99) throw new RangeError('class code must be an integer 0..99')
  if (!Number.isInteger(p.bucket) || p.bucket < 0 || p.bucket > 7) throw new RangeError('bucket must be an integer 0..7')
  if (!Number.isInteger(p.rank) || p.rank < 1 || p.rank > 7) throw new RangeError('rank must be an integer 1..7')
  if (!Number.isInteger(p.pressure) || p.pressure < 0) throw new RangeError('pressure must be a non-negative integer')
  const text = `${PACKET_SCHEMA} c=${pad2(p.classCode)} b=${p.bucket} r=${p.rank} f=${p.falsifier ? 1 : 0} p=${Math.min(7, p.pressure)}`
  if (text.length > PACKET_CHAR_BUDGET) throw new Error(`packet exceeds its ${PACKET_CHAR_BUDGET}-character budget`)
  return text
}

function hashPacket(e: Omit<JournalEntry, 'packetHash' | 'journaledAt' | 'packet'> & { packet: string }): string {
  return sha256Hex(canonicalJson({
    packet: e.packet, registryVersion: e.registryVersion, registryStatus: e.registryStatus, estimator: e.estimator, bucketEdges: e.bucketEdges,
    patternClassId: e.patternClassId, regime: e.regime, recordIds: e.recordIds,
  }))
}

export interface BuiltPacket { text: string; hash: string; entry: JournalEntry }

/** Builds the packet and the journal entry that makes it traceable. Pure: the caller appends `entry` to the ledger journal. */
export function buildPacket(l: IntuitionLedger, registry: PatternRegistry, req: PacketRequest): BuiltPacket {
  if (!req.allowDraft) assertFrozen(registry)
  const code = classIndex(registry, req.patternClassId)
  const stats = statsFor(l, req.patternClassId, registry.version, req.regime)
  const text = renderPacket({ classCode: code, bucket: stats.bucket, rank: req.hypothesisRank, falsifier: req.falsifierRegistered, pressure: req.pressureEvents })
  const evidence = stats.recordIds.map(id => l.records[id])
  const times = evidence.map(r => r.recordedAt).sort()
  const base = {
    packet: text, registryVersion: registry.version, registryStatus: registry.status, estimator: ESTIMATOR_ID, bucketEdges: BUCKET_EDGES_ID,
    patternClassId: req.patternClassId, regime: req.regime, bucket: stats.bucket, hits: stats.hits, n: stats.n, recordIds: stats.recordIds,
    lanes: [...new Set(evidence.map(r => r.lane))].sort(), providers: [...new Set(evidence.map(r => r.actingProvider))].sort(),
    evidenceFrom: times[0] ?? '', evidenceTo: times[times.length - 1] ?? '',
  }
  const hash = hashPacket(base)
  return { text, hash, entry: { ...base, packetHash: hash, journaledAt: req.now } }
}

export type Resolution = { ok: true; entry: JournalEntry } | { ok: false; reason: string }

/** The harness gate: a packet is accepted only if its hash resolves to graded, eligible, untampered records that reproduce its bucket. */
export function resolvePacket(l: IntuitionLedger, registry: PatternRegistry, packetHash: string): Resolution {
  const entry = l.journal.find(j => j.packetHash === packetHash)
  if (!entry) return { ok: false, reason: 'no journal entry for this packet hash' }
  if (hashPacket(entry) !== packetHash) return { ok: false, reason: 'journal entry no longer matches its packet hash' }
  if (entry.registryVersion !== registry.version) return { ok: false, reason: `packet was built under registry ${entry.registryVersion}, not ${registry.version}` }
  if (entry.estimator !== ESTIMATOR_ID || entry.bucketEdges !== BUCKET_EDGES_ID) return { ok: false, reason: 'packet used a different estimator or bucket-edge version' }
  const stats = statsFor(l, entry.patternClassId, entry.registryVersion, entry.regime)
  for (const id of entry.recordIds) {
    if (!stats.recordIds.includes(id)) return { ok: false, reason: `record ${id} no longer resolves to eligible graded evidence` }
  }
  // Evidence that arrived later is not a defect of an earlier packet; only the journaled records must still reproduce the journaled bucket.
  const hits = entry.recordIds.filter(id => { const e = l.grades[id]; return e && e.verdict === 'correct' }).length
  if (hits !== entry.hits || entry.recordIds.length !== entry.n) return { ok: false, reason: 'journaled counts do not match the graded records' }
  return { ok: true, entry }
}

export function journalPacket(l: IntuitionLedger, built: BuiltPacket): IntuitionLedger {
  if (l.journal.some(j => j.packetHash === built.hash)) return l
  return { ...l, journal: [...l.journal, built.entry] }
}
