// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

/**
 * The owner-typed swarm: `/swarm <task>`. Rules only; swarmRunner.ts is the glue.
 *
 * Why it exists (2026-11-15): the swarm's transport is built (spawn_agent -> runSubAgent, through executeTool and Guardian),
 * but the Nexus Run 25 checkpoint does not form spawn calls: 5 of 25 frozen rows matched and both live probes emitted none
 * (nexus-llm/eval/harness/SWARM-RESULTS.md). Until a checkpoint can, the owner can run one directly. A hosted model plans
 * it, the children run on the existing sub-agent loop, and the reply says plainly that Nexus did not form it.
 *
 * What a child may hold: READ-ONLY tools only (SWARM_CHILD_TOOLS). A swarm cannot write, patch, send, spend or spawn.
 * A tool the plan names outside that list is dropped and reported, never granted.
 */

export const SWARM_MAX_AGENTS = 4
export const SWARM_MIN_AGENTS = 2
/** Read-only. No http_fetch (it can POST), no write, shell, funds, message or spawn tool. */
export const SWARM_CHILD_TOOLS: readonly string[] = [
  'web_search', 'github_read_file', 'github_list_files', 'github_search_code', 'github_repo_state', 'weather_forecast', 'espn_fight_stats', 'kalshi_markets',
]
const TASK_MAX_CHARS = 1_200
const ROLE_MAX_CHARS = 120
const RESULT_REPORT_CHARS = 1_500

export type SwarmCommand = { kind: 'run'; task: string } | { kind: 'usage'; message: string }

export const SWARM_USAGE =
  'Usage: /swarm <task>. Example: /swarm find where the image learning warning is built and where it is shown, and explain how it travels. ' +
  `A hosted model splits the task between ${SWARM_MIN_AGENTS} to ${SWARM_MAX_AGENTS} read-only agents, runs them, and combines what they return.`

export function parseSwarmCommand(text: string): SwarmCommand | null {
  const m = /^\/swarm(?:\s+([\s\S]*))?$/i.exec(text.trim())
  if (!m) return null
  const task = (m[1] ?? '').trim()
  return task.length < 8 ? { kind: 'usage', message: SWARM_USAGE } : { kind: 'run', task: task.slice(0, 4_000) }
}

export interface SwarmAgentPlan { role: string; task: string; tools: string[]; droppedTools: string[] }
export type SwarmPlan = { ok: true; agents: SwarmAgentPlan[] } | { ok: false; reason: string }

export const PLANNER_SYSTEM =
  `You split one task between ${SWARM_MIN_AGENTS} to ${SWARM_MAX_AGENTS} agents that work at the same time and cannot see each other or this conversation. ` +
  'Reply with JSON only, no prose and no code fence: {"agents":[{"role":"...","task":"...","tools":["..."]}]}. ' +
  'Each task must be self-contained: name the exact files, URLs, names and facts that agent needs, because it sees nothing else. ' +
  'Give each agent a different part of the work; never give two agents the same task. ' +
  `Allowed tools, all read-only: ${SWARM_CHILD_TOOLS.join(', ')}. Give an agent only the tools its part needs. ` +
  'Agents cannot write, run commands, send messages or spend money, so plan only reading and finding out.'

export function plannerTask(task: string): string {
  return `Today is ${new Date().toISOString().slice(0, 10)}. The task to split:\n${task}`
}

/** Reads the planner's reply. Anything unusable is a refusal with its reason; a plan is never guessed or padded. */
export function parseSwarmPlan(reply: string): SwarmPlan {
  const start = reply.indexOf('{'), end = reply.lastIndexOf('}')
  if (start < 0 || end <= start) return { ok: false, reason: 'the planner did not return JSON' }
  let parsed: unknown
  try { parsed = JSON.parse(reply.slice(start, end + 1)) } catch { return { ok: false, reason: 'the planner returned JSON that does not parse' } }
  const list = (parsed as { agents?: unknown }).agents
  if (!Array.isArray(list)) return { ok: false, reason: 'the plan has no "agents" list' }
  const agents: SwarmAgentPlan[] = []
  const seenTasks = new Set<string>()
  for (const raw of list) {
    const a = raw as { role?: unknown; task?: unknown; tools?: unknown }
    if (typeof a?.task !== 'string' || a.task.trim().length < 8) return { ok: false, reason: 'an agent in the plan has no usable task' }
    const task = a.task.trim().slice(0, TASK_MAX_CHARS)
    const key = task.toLowerCase().replace(/\s+/g, ' ')
    if (seenTasks.has(key)) return { ok: false, reason: 'the plan gives two agents the same task' }
    seenTasks.add(key)
    const named = Array.isArray(a.tools) ? a.tools.filter((t): t is string => typeof t === 'string').map(t => t.trim()).filter(Boolean) : []
    const tools = [...new Set(named.filter(t => SWARM_CHILD_TOOLS.includes(t)))]
    const droppedTools = [...new Set(named.filter(t => !SWARM_CHILD_TOOLS.includes(t)))]
    const role = (typeof a.role === 'string' && a.role.trim() ? a.role.trim() : `Agent ${agents.length + 1}`).slice(0, ROLE_MAX_CHARS)
    agents.push({ role, task, tools, droppedTools })
  }
  if (agents.length < SWARM_MIN_AGENTS) return { ok: false, reason: `the plan has ${agents.length} agent(s); a swarm needs at least ${SWARM_MIN_AGENTS}` }
  if (agents.length > SWARM_MAX_AGENTS) return { ok: false, reason: `the plan has ${agents.length} agents; the limit is ${SWARM_MAX_AGENTS}` }
  return { ok: true, agents }
}

export function childSystemPrompt(agent: SwarmAgentPlan): string {
  return `You are one agent in a swarm: ${agent.role}. You work alone on the one task you are given. ` +
    (agent.tools.length ? `Use your tools (${agent.tools.join(', ')}) to find out; ` : 'You have no tools, so answer only from the task text; ') +
    'report only what a tool result or the task text shows, name the file, URL or source for each fact, and say plainly what you could not find. ' +
    'Do not guess. Reply in at most 1,200 characters.'
}

export interface SwarmChildResult { agent: SwarmAgentPlan; status: 'returned' | 'failed'; text: string }

export const SYNTHESIS_SYSTEM =
  'You combine the reports of agents that worked separately on parts of one task. Answer the task from their reports only. ' +
  'Say which agent each point came from. If an agent failed or reports disagree, say so; do not fill a gap with your own knowledge. ' +
  'Reply in at most 1,800 characters.'

export function synthesisTask(task: string, results: SwarmChildResult[]): string {
  return `The task:\n${task}\n\nAgent reports:\n` + results.map((r, i) =>
    `--- Agent ${i + 1} (${r.agent.role}) — ${r.status === 'returned' ? 'returned' : 'FAILED'} ---\n${r.text.slice(0, RESULT_REPORT_CHARS)}`).join('\n\n')
}

export const SWARM_NEEDS_KEY_NOTICE =
  'No swarm was run. The swarm needs a hosted model to plan the work and run its agents, and none is set up: add a Kimi or OpenRouter key in ' +
  'Settings (OpenRouter reaches Claude models too). The Nexus checkpoint cannot form a swarm yet, and Nexus was not asked.'
export const SWARM_VISITOR_NOTICE = 'No swarm was run. /swarm is the owner\'s command.'

export interface SwarmOutcome { task: string; results: SwarmChildResult[]; synthesis: string | null; synthesisError?: string }

/** The reply. States who ran it, what each agent was given, what came back, and what did not. */
export function formatSwarm(outcome: SwarmOutcome, label: string): string {
  const returned = outcome.results.filter(r => r.status === 'returned').length
  const lines = [
    `Swarm: ${returned} of ${outcome.results.length} agents returned.`,
    `Planned and run by ${label}. The Nexus checkpoint did not form this swarm and was not asked. Agents hold read-only tools.`,
    '',
  ]
  outcome.results.forEach((r, i) => {
    lines.push(`Agent ${i + 1} · ${r.agent.role} · ${r.status === 'returned' ? 'returned' : 'FAILED'}`)
    lines.push(`  tools: ${r.agent.tools.length ? r.agent.tools.join(', ') : 'none'}${r.agent.droppedTools.length ? ` (not granted: ${r.agent.droppedTools.join(', ')})` : ''}`)
    lines.push(`  task: ${r.agent.task}`)
    lines.push(`  ${r.status === 'returned' ? 'report' : 'error'}: ${r.text.slice(0, RESULT_REPORT_CHARS)}`)
    lines.push('')
  })
  if (outcome.synthesis) lines.push('Combined answer:', outcome.synthesis)
  else lines.push(`No combined answer: ${outcome.synthesisError ?? 'no agent returned a report'}.`)
  return lines.join('\n')
}
