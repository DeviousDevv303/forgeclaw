// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Visitor learning: anti-manipulation import ──────────────────────────────
// Free-mode visitors' runs reach NEXUS only through this file, and only as unapproved candidates:
// - the relay writes each record from the run's own result (a visitor never submits one) and signs it with
//   OWNER_KEY; a record whose signature does not verify is dropped here, so nothing altered or forged gets in;
// - records keep their anonymous visitor id, so NEXUS counts one visitor once (nexusLearning.ts), and their
//   manipulation flags, so the owner sees instruction-like input for what it is;
// - visitor candidates never reach a prompt (lessonsForPrompt uses the owner's runs only) and corpus
//   retrieval returns approved records only, so nothing a visitor typed influences the model until approved.

import type { CorpusInteractionInput } from './corpus'
import { buildLearningEvent } from './learningEvents'
import { VISITOR_SOURCE } from './nexusLearning'

export interface VisitorRecord {
  v: number
  id: string
  kind: 'answer' | 'research'
  tool: string
  task: string
  result: string
  outcome: 'completed' | 'failed'
  model: string
  seconds: number
  sources?: number
  visitor: string
  flags: string[]
  ts: string
  sig: string
}

/** Same canonical form as relay/worker.js canonicalRecord: sorted keys, signature excluded. */
export function canonicalRecord(record: unknown): string {
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).filter(k => k !== 'sig').sort().map(k => [k, sort((v as Record<string, unknown>)[k])]))
    : v
  return JSON.stringify(sort(record))
}

async function hmacHex(key: string, text: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('')
}

function wellFormed(r: Partial<VisitorRecord>): r is VisitorRecord {
  return r.v === 2 && typeof r.id === 'string' && (r.kind === 'answer' || r.kind === 'research') && typeof r.task === 'string'
    && typeof r.result === 'string' && (r.outcome === 'completed' || r.outcome === 'failed') && typeof r.visitor === 'string'
    && Array.isArray(r.flags) && typeof r.sig === 'string' && /^[0-9a-f]{64}$/.test(r.sig)
}

/** Keep only records the relay signed with this owner key; the rest are counted, never imported. */
export async function verifyVisitorRecords(records: unknown[], ownerKey: string): Promise<{ valid: VisitorRecord[]; rejected: number }> {
  const valid: VisitorRecord[] = []
  let rejected = 0
  for (const r of records) {
    const record = r as Partial<VisitorRecord>
    if (!wellFormed(record) || await hmacHex(ownerKey, canonicalRecord(record)) !== record.sig) { rejected += 1; continue }
    valid.push(record)
  }
  return { valid, rejected }
}

/** An unapproved NEXUS candidate for one verified visitor record. */
export function visitorCandidate(r: VisitorRecord): CorpusInteractionInput {
  const event = buildLearningEvent({ channel: 'chat', input: r.task, result: r.result, outcome: r.outcome, runtime: 'public-relay', model: r.model || 'public', lineage: 'qwen', actor: 'user', toolName: r.tool })
  return {
    ...event,
    source: VISITOR_SOURCE,
    context: `${event.context}; channel=visitor; visitor=${r.visitor}${r.flags.length ? `; flags=${r.flags.join(',')}` : ''}`,
    metadata: { ...event.metadata, channel: 'visitor', visitor: r.visitor, kind: r.kind, flags: r.flags.join(','), seconds: String(r.seconds), relay_id: r.id },
  }
}
