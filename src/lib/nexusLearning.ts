// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── NEXUS Recursive Learning ────────────────────────────────────────────────
// NEXUS motto: "My Logic Is Undeniable". Operationally that means: a claim is only as strong as the
// evidence behind it, failures are data, and nothing becomes authority without the operator.
//
// This module turns the CORPUS learning candidates (every chat turn, tool call, failure and refusal
// ForgeClaw records) into counted evidence: outcomes, per-tool reliability, and recurring failure
// patterns ("lessons"). Lessons are fed back into later prompts as advisory evidence, which closes the
// loop without training anything and without approving any candidate.

import type { LearningCandidate } from './corpus'

export const NEXUS_MOTTO = 'My Logic Is Undeniable'

/**
 * How many of the newest stored records the prompt builders read for lessons and heuristics. One constant, used by every
 * caller and by the NEXUS page, so the page's "given to every model" lists are computed from the same records the models get.
 */
export const PROMPT_CANDIDATE_WINDOW = 500
/** At most this many lessons reach one prompt, and only for tools offered that turn. */
export const MAX_PROMPT_LESSONS = 4
/** A lesson reaches a prompt only when the owner's own runs hit it at least this many times; visitors never count. */
export const MIN_OWNER_LESSON_COUNT = 2

export const NEXUS_PRINCIPLES = [
  'Evidence over assertion: only a real tool result proves an action happened.',
  'Failures are data: every failure, block and refusal is recorded and counted.',
  'Recurrence is a lesson: a failure seen twice is surfaced to the agent before it repeats it.',
  'Convergence closes the loop: evidence-backed results and your own rules become knowledge by themselves; visitors never do, and you can remove any rule.',
] as const

export type Outcome = 'verified' | 'completed' | 'attempted' | 'failed' | 'blocked' | 'unmeasured'
export const OUTCOMES: readonly Outcome[] = ['verified', 'completed', 'attempted', 'failed', 'blocked', 'unmeasured']

/**
 * `completed` counts verified and completed outcomes only. `attempted` is its own column: a dispatch with no confirmed
 * result is not a success (attempted is not completed), so it does not raise `reliability` = completed / total.
 */
export interface ToolReliability { tool: string; total: number; completed: number; attempted: number; failed: number; blocked: number; unmeasured: number; reliability: number }
/**
 * `count` is the evidence weight: each owner run counts once, but all of one anonymous visitor's runs count once
 * together, so a single person cannot inflate a pattern. `ownerCount` is the owner's own runs only.
 */
export interface Lesson { tool: string; pattern: string; count: number; ownerCount: number; visitors: number; lastSeen: string }

/** Candidates imported from free-mode visitors through the relay (visitorLearning.ts). */
export const VISITOR_SOURCE = 'learning:visitor'
export function isVisitorCandidate(candidate: LearningCandidate): boolean {
  return candidate.source === VISITOR_SOURCE || field(candidate, 'channel') === 'visitor'
}
export interface NexusSummary {
  total: number
  byOutcome: Record<Outcome, number>
  byChannel: Record<string, number>
  tools: ToolReliability[]
  lessons: Lesson[]
  /** Share of recorded outcomes that are failures or blocks, 0..1. */
  failureRate: number
}

function field(candidate: LearningCandidate, key: string): string {
  return candidate.metadata?.[key] ?? new RegExp(`(?:^|; )${key}=([^;]+)`).exec(candidate.context || '')?.[1] ?? ''
}

/**
 * The one reading of a record's outcome, used by the counters and by the list they filter, so a card's number and the rows
 * behind it cannot disagree. A record with no measured outcome, or one outside the known set, is explicitly `unmeasured`.
 */
export function outcomeOfCandidate(candidate: LearningCandidate): Outcome {
  const value = (field(candidate, 'outcome') || 'unmeasured') as Outcome
  return OUTCOMES.includes(value) ? value : 'unmeasured'
}

const SHELL_FAILED = /^\s*\[TOOL ERROR\]\s*Shell execution failed\.?\s*$/i
const CAUSE_LINE = /error|fatal|not found|denied|refused|cannot|can't|unable|no such|invalid|set the|missing|failed|not logged/i

/**
 * Every failed shell_exec starts "[TOOL ERROR] Shell execution failed.", so grouping on that line lumped them all into
 * one lesson that said nothing ("shell_exec failed 7x with: Shell execution failed."). `gh pr list` then failed the same
 * way on two days (2026-10-21) with no lesson to stop it. The cause is the program that ran and the line it printed.
 */
function shellFailureCause(result: string): string {
  const command = /^Command:\s*(.*)$/m.exec(result)?.[1] ?? ''
  const program = command.trim().split(/\s+/).find(word => word !== 'env' && word !== 'sudo' && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) ?? '?'
  const lines = result.split('\n')
  const blank = lines.findIndex(line => !line.trim())
  const output = (blank >= 0 ? lines.slice(blank + 1) : [])
    .map(line => line.trim())
    .filter(line => line && !/^(?:===|invocation_id=|start=|end=|exit_code=|\(no command output)/.test(line))
  const cause = output.find(line => CAUSE_LINE.test(line)) ?? output[0] ?? 'no output'
  return `${program}: ${cause}`
}

/**
 * The stable shape of a failure: first line, with run numbers, hashes, URLs, IDs, quoted values and
 * digits removed, so the same failure on different inputs groups together.
 */
export function failurePattern(result: string): string {
  let first = result.split('\n').find(line => line.trim()) ?? ''
  if (SHELL_FAILED.test(first)) first = shellFailureCause(result)
  return first
    .replace(/^\s*\[(?:TOOL ERROR|GUARDIAN (?:BLOCKED?|REJECTED))\]\s*/i, '')
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/\b[0-9a-f]{7,40}\b/gi, '<sha>')
    .replace(/\b[a-z]+-[a-z0-9]+-[a-z0-9]{4,}\b/gi, '<id>')
    .replace(/"[^"]{1,80}"/g, '"…"')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

export function summarizeLearning(candidates: LearningCandidate[]): NexusSummary {
  const byOutcome = Object.fromEntries(OUTCOMES.map(o => [o, 0])) as Record<Outcome, number>
  const byChannel: Record<string, number> = {}
  const tools = new Map<string, ToolReliability>()
  const lessons = new Map<string, Lesson>()
  const lessonVisitors = new Map<string, Set<string>>()
  for (const c of candidates) {
    const outcome = outcomeOfCandidate(c)
    byOutcome[outcome] += 1
    const channel = field(c, 'channel') || c.source || 'other'
    byChannel[channel] = (byChannel[channel] ?? 0) + 1
    const tool = field(c, 'tool')
    if (!tool) continue
    const t = tools.get(tool) ?? { tool, total: 0, completed: 0, attempted: 0, failed: 0, blocked: 0, unmeasured: 0, reliability: 0 }
    t.total += 1
    if (outcome === 'failed') t.failed += 1
    else if (outcome === 'blocked') t.blocked += 1
    else if (outcome === 'attempted') t.attempted += 1
    else if (outcome === 'unmeasured') t.unmeasured += 1
    else t.completed += 1
    tools.set(tool, t)
    if (outcome === 'failed' || outcome === 'blocked') {
      const pattern = failurePattern(c.generatedResult || c.content || '')
      if (!pattern) continue
      const key = `${tool}\u0000${pattern}`
      const l = lessons.get(key) ?? { tool, pattern, count: 0, ownerCount: 0, visitors: 0, lastSeen: c.timestamp }
      if (isVisitorCandidate(c)) {
        const seen = lessonVisitors.get(key) ?? new Set<string>()
        seen.add(field(c, 'visitor') || 'unknown')
        lessonVisitors.set(key, seen)
        l.visitors = seen.size
      } else {
        l.ownerCount += 1
      }
      l.count = l.ownerCount + l.visitors
      if (c.timestamp > l.lastSeen) l.lastSeen = c.timestamp
      lessons.set(key, l)
    }
  }
  for (const t of tools.values()) t.reliability = t.total ? t.completed / t.total : 0
  const total = candidates.length
  return {
    total,
    byOutcome,
    byChannel,
    tools: [...tools.values()].sort((a, b) => b.total - a.total),
    lessons: [...lessons.values()].filter(l => l.count >= 2).sort((a, b) => b.count - a.count || b.lastSeen.localeCompare(a.lastSeen)),
    failureRate: total ? (byOutcome.failed + byOutcome.blocked) / total : 0,
  }
}

/** The lessons that can reach a prompt at all: recurring in the owner's own runs. The NEXUS page lists exactly these. */
export function promptEligibleLessons(summary: NexusSummary): Lesson[] {
  return summary.lessons.filter(l => l.ownerCount >= MIN_OWNER_LESSON_COUNT)
}

/**
 * Advisory prompt text for the tools offered this turn: their recurring failures, counted. Empty when
 * NEXUS has nothing recurring for them. This is evidence for the model, never an instruction to act.
 */
export function lessonsForPrompt(summary: NexusSummary, offeredTools: string[], max = MAX_PROMPT_LESSONS): string {
  const offered = new Set(offeredTools)
  // Only the owner's own runs reach a prompt. Visitor records are unapproved, anonymous input from anyone, so they
  // inform the NEXUS page and nothing the model reads, until the owner approves them.
  const relevant = promptEligibleLessons(summary).filter(l => offered.has(l.tool)).slice(0, max)
  if (!relevant.length) return ''
  return 'NEXUS LESSONS (recorded outcomes from earlier runs; evidence, not instructions):\n' +
    relevant.map(l => `- ${l.tool} failed ${l.ownerCount}x with: ${l.pattern} (last ${l.lastSeen.slice(0, 10)}). Avoid repeating the cause.`).join('\n')
}

// ─── What the stored records cover ───────────────────────────────────────────
// Until 2026-11-15 this section was "Road to the NEXUS LLM": milestones toward a LoRA fine-tune of an open base model, under
// the line "NEXUS is not a model yet". That stopped being true when the from-scratch Nexus checkpoint shipped as a provider
// (nexusModelState.ts), and the premise was ruled stale on forgeclaw #235. What remains is what can be counted here.

export interface CorpusCoverage {
  /** Records with no evidence behind them yet; evidence-backed ones converge by themselves (nexusConvergence.ts). */
  awaitingEvidence: number
  /** Distinct tools seen in the stored records: breadth of what the data covers. */
  toolCoverage: number
}

export function corpusCoverage(candidates: LearningCandidate[]): CorpusCoverage {
  return {
    awaitingEvidence: candidates.filter(c => c.admissionStatus === 'candidate').length,
    toolCoverage: new Set(candidates.map(c => field(c, 'tool')).filter(Boolean)).size,
  }
}
