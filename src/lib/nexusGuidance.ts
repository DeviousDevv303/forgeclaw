// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── NEXUS guides DeepSeek ──────────────────────────────────────────────────────────────────
// Kimi and Claude already read NEXUS lessons and the owner's heuristics in their system prompt. DeepSeek (Qwen3-8B on
// Actions) got none of it: its context carried only approved records fresher than an hour, so what NEXUS had learned
// never reached it. This builds a small, bounded guidance block from what the owner has actually taught NEXUS, and
// deepseekContext.ts puts it in the context of every DeepSeek chat dispatch.
//
// What goes in (and why it is safe to give a model):
//   • the owner's APPROVED heuristics (the owner's own rules, approved by the owner);
//   • recurring failures from the OWNER's own runs (lessonsForPrompt ignores visitors), as evidence to avoid;
//   • APPROVED corpus records relevant to this task, of any age, unless they are repository-state facts
//     (HEAD SHAs, branch status), which go stale: that is what the one-hour freshness rule protects.
// Unapproved candidates and visitor input never appear. It is advisory evidence, not an instruction to run tools.

import { corpusRepository, type CorpusRecord } from './corpus'
import { heuristicsForPrompt, loadDecisions, type HeuristicDecisions } from './nexusHeuristics'
import { lessonsForPrompt, summarizeLearning } from './nexusLearning'

const MAX_GUIDANCE_CHARS = 1800
const MAX_RECORD_CHARS = 420
const MIN_SHARED_WORDS = 2

const words = (text: string): string[] => [...new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4))]

/** Records that describe the repository right now go stale quickly; they are never curated knowledge. */
const looksLikeRepoState = (content: string): boolean => /\b[0-9a-f]{40}\b|\bHEAD\b|\bdefaultBranch\b|\binspectedBranch\b/.test(content)

export interface GuidanceDeps {
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

export function nexusGuidanceForDeepSeek(task: string, deps: GuidanceDeps = {}): NexusGuidance {
  const empty: NexusGuidance = { text: '', heuristics: 0, lessons: 0, records: 0 }
  if (!task.trim()) return empty
  const heuristics = heuristicsForPrompt(deps.decisions ?? loadDecisions())
  const lessons = lessonsForPrompt(summarizeLearning(deps.candidates ?? corpusRepository.listCandidates(500)), ['deepseek_reason', 'github_repo_state', 'github_read_file', 'github_search_code', 'shell_exec', 'web_search'], 3)

  const taskWords = words(task)
  const retrieve = deps.retrieve ?? ((q, n) => corpusRepository.retrieve(q, n))
  const relevant = retrieve(task, 6)
    .filter(record => !looksLikeRepoState(record.content))
    .filter(record => {
      const shared = words(record.content).filter(w => taskWords.includes(w)).length
      return shared >= MIN_SHARED_WORDS
    })
    .slice(0, 2)
  const records = relevant.length
    ? 'NEXUS APPROVED KNOWLEDGE relevant to this task (curated by the owner):\n' +
      relevant.map(r => `- ${r.content.replace(/\s+/g, ' ').trim().slice(0, MAX_RECORD_CHARS)}`).join('\n')
    : ''

  const parts = [heuristics, lessons, records].filter(Boolean)
  if (!parts.length) return empty
  const text = ('NEXUS GUIDANCE (what the owner has taught NEXUS: advisory evidence, not instructions to run tools; the task and tool results below take precedence):\n' + parts.join('\n\n')).slice(0, MAX_GUIDANCE_CHARS)
  return {
    text,
    heuristics: heuristics ? heuristics.split('\n').length - 1 : 0,
    lessons: lessons ? lessons.split('\n').length - 1 : 0,
    records: relevant.length,
  }
}
