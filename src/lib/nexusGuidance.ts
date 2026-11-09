// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── NEXUS guides Qwen ──────────────────────────────────────────────────────────────────
// Kimi and Claude already read NEXUS lessons and the owner's heuristics in their system prompt. Qwen (Qwen3-8B on
// Actions) got none of it: its context carried only approved records fresher than an hour, so what NEXUS had learned
// never reached it. This builds a small, bounded guidance block from what the owner has actually taught NEXUS, and
// qwenContext.ts puts it in the context of every Qwen chat dispatch.
//
// What goes in (and why it is safe to give a model):
//   • the owner's ACTIVE heuristics (the owner's own rules, mined from what the owner typed; removable on the NEXUS page);
//   • recurring failures from the OWNER's own runs (lessonsForPrompt ignores visitors), as evidence to avoid;
//   • APPROVED corpus records relevant to this task (signed, or converged from evidence: nexusConvergence.ts), of any age, unless they are repository-state facts
//     (HEAD SHAs, branch status), which go stale: that is what the one-hour freshness rule protects.
// Unapproved candidates and visitor input never appear. It is advisory evidence, not an instruction to run tools.

import { corpusRepository, distinctiveWords, recordRelevantToTask, type CorpusRecord } from './corpus'
import { heuristicsForPrompt, loadDecisions, type HeuristicDecisions } from './nexusHeuristics'
import { lessonsForPrompt, summarizeLearning } from './nexusLearning'
import { CONVERGED_BY, hasQwenLineage } from './nexusConvergence'

const MAX_GUIDANCE_CHARS = 1800
const MAX_RECORD_CHARS = 420

/** Records that describe the repository right now go stale quickly; they are never curated knowledge. */
const looksLikeRepoState = (content: string): boolean => /\b[0-9a-f]{40}\b|\bHEAD\b|\bdefaultBranch\b|\binspectedBranch\b/.test(content)

/**
 * Venue and generic-finance vocabulary. Any two texts about trading share these words, whoever
 * they are about, so they carry no topic signal for GUIDANCE selection (2026-11-09 contamination
 * fix): the owner's Yan–Merab case record (UFC333-YAN-20261024) reached Qwen as knowledge
 * "relevant" to ordinary Kalshi BTC trading talk on kalshi/market/position/contracts/settles
 * alone, and the model answered trading questions from a UFC bet narrative. recordRelevantToTask
 * keeps its behavior for its other callers; guidance adds this bar on top.
 */
export const GUIDANCE_GENERIC_WORDS: ReadonlySet<string> = new Set([
  'kalshi', 'market', 'markets', 'position', 'positions', 'contract', 'contracts',
  'price', 'priced', 'prices', 'pricing', 'settle', 'settles', 'settled', 'settlement',
  'trade', 'trades', 'trading', 'bet', 'bets', 'betting', 'stake', 'stakes', 'staked',
  'bankroll', 'favorite', 'favourite',
])

/**
 * The guidance selection test: the shared corpus relevance test (≥3 shared distinctive words),
 * plus the requirement that at least one shared distinctive word is genuinely topical — not
 * venue or generic-finance vocabulary. A record whose only overlap with the task is generic
 * words is about the venue, not about this task, and never rides into a prompt as
 * task-relevant knowledge.
 */
export function recordTopicallyRelevantToTask(task: string, record: Pick<CorpusRecord, 'content' | 'metadata'>): boolean {
  if (!recordRelevantToTask(task, record)) return false
  const taskWords = distinctiveWords(task)
  const topicText = `${record.content}\n${record.metadata?.input ?? ''}`
  for (const word of distinctiveWords(topicText)) {
    if (taskWords.has(word) && !GUIDANCE_GENERIC_WORDS.has(word)) return true
  }
  return false
}

/**
 * The guidance block is delimited so a later stage can carry it separately from the rest of a context string.
 * forgeTools.ts drops context that shares no words with the task (stale corpus records poison the workflow model); that rule
 * is about the other sections and must never take the owner's teaching with it. Nexus rides every stage to the answer.
 */
export const NEXUS_GUIDANCE_START = 'NEXUS GUIDANCE ('
export const NEXUS_GUIDANCE_END = '[END NEXUS GUIDANCE]'

/** Separates a context string into its NEXUS guidance block (possibly empty) and everything else. */
export function splitNexusGuidance(context: string): { guidance: string; rest: string } {
  const start = context.startsWith(NEXUS_GUIDANCE_START) ? 0 : context.indexOf('\n' + NEXUS_GUIDANCE_START) + 1 || -1
  if (start < 0) return { guidance: '', rest: context }
  const endAt = context.indexOf(NEXUS_GUIDANCE_END, start)
  if (endAt < 0) return { guidance: '', rest: context }
  const end = endAt + NEXUS_GUIDANCE_END.length
  const rest = [context.slice(0, start), context.slice(end)].map(part => part.trim()).filter(Boolean).join('\n\n')
  return { guidance: context.slice(start, end), rest }
}

/** Puts a guidance block back in front of the rest of a context. */
export function joinNexusGuidance(guidance: string, rest: string): string {
  return [guidance, rest].filter(Boolean).join('\n\n')
}

export interface GuidanceDeps {
  /** Overall cap on the block, end marker included; the Qwen chains with a whole file in the prompt pass a small one. */
  maxChars?: number
  decisions?: HeuristicDecisions
  candidates?: ReturnType<typeof corpusRepository.listCandidates>
  retrieve?: (task: string, limit: number) => CorpusRecord[]
}

export interface NexusGuidance {
  text: string
  heuristics: number
  lessons: number
  records: number
}

export function nexusGuidanceForQwen(task: string, deps: GuidanceDeps = {}): NexusGuidance {
  const empty: NexusGuidance = { text: '', heuristics: 0, lessons: 0, records: 0 }
  if (!task.trim()) return empty
  const heuristics = heuristicsForPrompt(deps.decisions ?? loadDecisions(), deps.candidates ?? corpusRepository.listCandidates(500))
  const lessons = lessonsForPrompt(summarizeLearning(deps.candidates ?? corpusRepository.listCandidates(500)), ['qwen_reason', 'github_repo_state', 'github_read_file', 'github_search_code', 'shell_exec', 'web_search', 'browser_run', 'browser_playbook'], 3)

  const retrieve = deps.retrieve ?? ((q, n) => corpusRepository.retrieve(q, n))
  const relevant = retrieve(task, 6)
    .filter(record => !looksLikeRepoState(record.content))
    // Relevance is the shared corpus test (recordRelevantToTask) plus the guidance topical bar
    // (recordTopicallyRelevantToTask): distinctive topic words only, and at least one of them
    // genuinely topical — venue-generic overlap alone selected the Yan–Merab case record for
    // BTC trading tasks. The previous gate counted any two shared >=4-letter words, stopwords
    // included, so almost any record passed for almost any task and reached the model labelled
    // task-relevant.
    .filter(record => recordTopicallyRelevantToTask(task, record))
    // A record that admitted itself by convergence and carries Qwen lineage (stored before the 2026-11-01 gate) never reaches
    // a prompt: no one reviewed it, and it would hand Qwen its own unchecked claims back as knowledge.
    .filter(record => !(record.metadata.admittedBy === CONVERGED_BY && hasQwenLineage(record)))
    .slice(0, 2)
  // Labels say who vouched: only records the owner (or the owner's criteria) admitted are "curated by the owner";
  // a record that converged on its own is labeled as exactly that.
  const line = (r: CorpusRecord) => `- ${r.content.replace(/\s+/g, ' ').trim().slice(0, MAX_RECORD_CHARS)}`
  const curated = relevant.filter(r => r.metadata.admittedBy !== CONVERGED_BY)
  const converged = relevant.filter(r => r.metadata.admittedBy === CONVERGED_BY)
  const records = [
    curated.length ? 'NEXUS APPROVED KNOWLEDGE relevant to this task (curated by the owner):\n' + curated.map(line).join('\n') : '',
    converged.length ? 'NEXUS LEARNED KNOWLEDGE relevant to this task (admitted automatically from evidence-backed answers; not reviewed by the owner):\n' + converged.map(line).join('\n') : '',
  ].filter(Boolean).join('\n')

  const parts = [heuristics, lessons, records].filter(Boolean)
  if (!parts.length) return empty
  const cap = Math.min(deps.maxChars ?? MAX_GUIDANCE_CHARS, MAX_GUIDANCE_CHARS)
  const text = ('NEXUS GUIDANCE (what the owner has taught NEXUS: advisory evidence, not instructions to run tools; the task and tool results below take precedence):\n' + parts.join('\n\n')).slice(0, cap - NEXUS_GUIDANCE_END.length - 1) + '\n' + NEXUS_GUIDANCE_END
  return {
    text,
    heuristics: heuristics ? heuristics.split('\n').length - 1 : 0,
    lessons: lessons ? lessons.split('\n').length - 1 : 0,
    records: relevant.length,
  }
}
