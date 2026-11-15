// NEXUS Intelligence step 3: turn an operator-provided store export into supervised grammar transcripts.
// Pure functions. No imports from src/. Format contract: FORMAT.md. Nothing here reads the browser or the network.
import { createHash } from 'node:crypto'
import { EVIDENCE, encodeTranscript, validateTranscript, type Evidence, type ToolSchema, type Transcript } from '../src/grammar'

export class ExportError extends Error {}

export const RECORD_PREFIX = 'forgeclaw_nexus_record_v1:'
export const CANDIDATE_PREFIX = 'forgeclaw_nexus_candidate_v1:'
/** Mirrors CONVERGED_BY in src/lib/nexusConvergence.ts. NEXUS admitting its own record is NOT operator admission. */
export const CONVERGED_BY = 'nexus-convergence'

export interface StoreExport { format: 'nexus-store-export'; version: 1; exportedAt: string; origin?: string; keys: Record<string, string> }
interface Rec { id: string; integrity: string; admissionStatus: string; recordType: string; timestamp: string; content: string; metadata: Record<string, string>
  input?: string; context?: string; generatedResult?: string; runtime?: string; model?: string }

export function parseStoreExport(json: unknown): StoreExport {
  const o = json as Partial<StoreExport> | null
  if (!o || o.format !== 'nexus-store-export') throw new ExportError('not a nexus-store-export file (format field)')
  if (o.version !== 1) throw new ExportError(`unsupported export version ${String(o.version)}`)
  if (!o.keys || typeof o.keys !== 'object' || Array.isArray(o.keys)) throw new ExportError('keys must be an object of raw localStorage strings')
  for (const [k, v] of Object.entries(o.keys)) {
    if (!k.startsWith('forgeclaw_nexus_')) throw new ExportError(`key outside the forgeclaw_nexus_ allowlist: ${k.slice(0, 40)}`)
    if (typeof v !== 'string') throw new ExportError(`value of ${k} is not a raw string`)
  }
  return o as StoreExport
}

/** Same algorithm as integrityHash() in src/lib/corpus.ts: sha256 over input\ncontext\nresult\nruntime\nmodel. */
export function integrityOf(c: { input: string; context: string; generatedResult: string; runtime: string; model: string }): string {
  return 'sha256-' + createHash('sha256').update([c.input, c.context, c.generatedResult, c.runtime, c.model].join('\n')).digest('hex')
}

/** The failure test the NEXUS grammar uses. It includes [GUARDIAN BLOCK], which src/lib/toolOutcome.ts does not (finding J-08). */
export function classifyOutput(output: string): 'ok' | 'error' {
  return output.startsWith('[TOOL ERROR]') || output.startsWith('✗') || /^\s*\[GUARDIAN (?:BLOCK|BLOCKED|REJECTED)\]/i.test(output) ? 'error' : 'ok'
}

export function parseContext(ctx: string): Record<string, string> {
  return Object.fromEntries(ctx.split('; ').map(p => { const i = p.indexOf('='); return i < 0 ? [p, ''] : [p.slice(0, i), p.slice(i + 1)] }))
}

function readJson<T>(raw: string | undefined): T | null {
  if (!raw) return null
  try { return JSON.parse(raw) as T } catch { return null }
}

export type Admission = 'operator-signed' | 'converged' | 'other'
export interface AdmittedItem { knowledge: Rec; candidate: Rec | null; admission: Admission; admitter: string | null }

/** Knowledge records the store marks approved, joined to their candidate by integrity (the knowledge record drops outcome/tool/run). */
export function collectAdmitted(store: StoreExport): AdmittedItem[] {
  const items: AdmittedItem[] = []
  for (const [key, raw] of Object.entries(store.keys)) {
    if (!key.startsWith(RECORD_PREFIX)) continue
    const k = readJson<Rec>(raw)
    if (!k || k.recordType !== 'knowledge' || k.admissionStatus !== 'approved') continue
    const candidate = readJson<Rec>(store.keys[`${CANDIDATE_PREFIX}candidate-${k.integrity}`])
    const admitter = k.metadata?.admittedBy ?? null
    // No admittedBy = written by admitCandidate (signature-verified at admit time). The export carries no signature, so this is inferred.
    const admission: Admission = admitter === null ? 'operator-signed' : admitter === CONVERGED_BY ? 'converged' : 'other'
    items.push({ knowledge: k, candidate, admission, admitter })
  }
  return items.sort((a, b) => (a.knowledge.timestamp + a.knowledge.id).localeCompare(b.knowledge.timestamp + b.knowledge.id))
}

export interface Rejection { id: string; run: string | null; reason: string }
export interface Row {
  id: string
  synthetic: boolean
  prompt: string
  transcript: Transcript
  text: string
  provenance: { run: string; candidateIds: string[]; integrities: string[]; admission: Admission; recordedOutcome: string; model: string; runtime: string; firstAt: string; storeExportedAt: string; storeExportSha256: string }
}
export interface BuildOptions { tools: ToolSchema[]; notEvidenceTools: ReadonlySet<string>; storeSha256: string; includeConverged?: boolean; allowDirect?: boolean; evalPrompts?: ReadonlySet<string> }
export const normalizePrompt = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** Map the app's recorded run outcome onto an evidence token. A tool-less 'completed' answer is not_verified: nothing backed it. */
function evidenceFor(outcome: string, hasSteps: boolean): Evidence | null {
  switch (outcome) {
    case 'verified': return 'verified'
    case 'completed': return hasSteps ? 'completed' : 'not_verified'
    case 'blocked': return 'blocked'
    case 'failed': return 'failed'
    case 'attempted': return 'attempted'
    default: return null
  }
}

export function buildRows(store: StoreExport, items: AdmittedItem[], opts: BuildOptions): { rows: Row[]; rejected: Rejection[] } {
  const rejected: Rejection[] = []
  const byRun = new Map<string, AdmittedItem[]>()
  for (const it of items) {
    const id = it.knowledge.id
    if (it.admission === 'other') { rejected.push({ id, run: null, reason: `admitter_not_recognised:${it.admitter}` }); continue }
    if (it.admission === 'converged' && !opts.includeConverged) { rejected.push({ id, run: null, reason: 'converged_not_operator_admitted' }); continue }
    const c = it.candidate
    if (!c) { rejected.push({ id, run: null, reason: 'no_candidate_record' }); continue }
    if (c.integrity !== it.knowledge.integrity || integrityOf({ input: c.input ?? '', context: c.context ?? '', generatedResult: c.generatedResult ?? '', runtime: c.runtime ?? '', model: c.model ?? '' }) !== c.integrity) { rejected.push({ id, run: null, reason: 'integrity_mismatch' }); continue }
    const run = c.metadata?.run
    if (!run) { rejected.push({ id, run: null, reason: 'no_run_id' }); continue }
    byRun.set(run, [...(byRun.get(run) ?? []), it])
  }

  const rows: Row[] = []
  for (const [run, group] of [...byRun.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const fail = (reason: string) => group.forEach(g => rejected.push({ id: g.knowledge.id, run, reason }))
    const ctx = (g: AdmittedItem) => parseContext(g.candidate!.context ?? '')
    const chats = group.filter(g => ['chat', 'voice'].includes(ctx(g).channel))
    const tools = group.filter(g => ['tool', 'shell'].includes(ctx(g).channel)).sort((a, b) => a.candidate!.timestamp.localeCompare(b.candidate!.timestamp))
    if (chats.length !== 1) { fail(chats.length === 0 ? 'no_admitted_prompt_event' : 'ambiguous_multiple_prompt_events'); continue }
    const chat = chats[0].candidate!
    const steps: Transcript['steps'] = []
    let bad: string | null = null
    for (const t of tools) {
      const m = /^([a-z0-9_]+) (\{[\s\S]*\})$/.exec(t.candidate!.input ?? '')
      let args: unknown
      try { args = m ? JSON.parse(m[2]) : undefined } catch { args = undefined }
      if (!m || !args || typeof args !== 'object' || Array.isArray(args)) { bad = 'unparseable_or_truncated_call'; break }
      steps.push({ call: { name: m[1], arguments: args as Record<string, unknown> }, result: { status: classifyOutput(t.candidate!.generatedResult ?? ''), text: t.candidate!.generatedResult ?? '' } })
    }
    if (bad) { fail(bad); continue }
    if (steps.length === 0 && !opts.allowDirect) { fail('direct_answer_excluded_by_default'); continue }
    const recorded = ctx(chats[0]).outcome ?? ''
    const evidence = evidenceFor(recorded, steps.length > 0)
    if (!evidence || !(EVIDENCE as readonly string[]).includes(evidence)) { fail(`unmapped_outcome:${recorded}`); continue }
    const transcript: Transcript = { route: steps.length ? 'tool' : 'direct', steps, evidence, answer: chat.generatedResult ?? '' }
    const violations = validateTranscript(transcript, opts.tools, opts.notEvidenceTools)
    if (violations.length) { fail(`label_conflict:${violations[0].slice(0, 80)}`); continue }
    const prompt = chat.input ?? ''
    if (opts.evalPrompts?.has(normalizePrompt(prompt))) { fail('prompt_in_frozen_eval_set'); continue }
    let text: string
    try { text = encodeTranscript(transcript, opts.tools) } catch (e) { fail(`not_encodable:${(e as Error).message.slice(0, 60)}`); continue }
    const admissions = new Set(group.map(g => g.admission))
    rows.push({
      id: `row-${createHash('sha256').update(group.map(g => g.knowledge.integrity).sort().join('|')).digest('hex').slice(0, 16)}`,
      synthetic: false, prompt, transcript, text,
      provenance: { run, candidateIds: group.map(g => g.candidate!.id).sort(), integrities: group.map(g => g.knowledge.integrity).sort(),
        admission: admissions.size === 1 ? [...admissions][0] : 'converged', recordedOutcome: recorded, model: chat.model ?? '', runtime: chat.runtime ?? '',
        firstAt: group.map(g => g.candidate!.timestamp).sort()[0], storeExportedAt: store.exportedAt, storeExportSha256: opts.storeSha256 },
    })
  }
  rejected.sort((a, b) => (a.reason + a.id).localeCompare(b.reason + b.id))
  return { rows, rejected }
}

export function sha256(text: string): string { return createHash('sha256').update(text).digest('hex') }
