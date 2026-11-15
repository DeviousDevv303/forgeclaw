// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

/**
 * Refusal-only pre-flight for spawn_agent, run by the tool handler before a child agent is started.
 *
 * spawn_agent is the in-house swarm's entry point (it replaced MiroFish). Its handler cast `system_prompt`, `task` and
 * `tools` with no check, so a malformed spawn (the Nexus checkpoint is a 4.48M-parameter model and can emit one) either
 * started a child on `undefined` or died in "toolsStr.split is not a function", an error no model can act on.
 *
 * Same family as githubArgCheck.ts and unifiedDiffCheck.ts: it only ever ADDS a refusal and never edits an argument.
 * A spawn that works today is not refused: a blank `system_prompt`, an omitted or empty `tools` (all tools), a `tools`
 * string naming nothing real (a child with no tools), and a `tools` string that lists nexus_reason all still run; the last
 * is a formation error for the swarm benchmark to grade, not something the app should hide. Which tools a child holds,
 * and Guardian, are decided elsewhere and are untouched.
 */

/** Returns null when the spawn is well formed, otherwise one short paragraph naming every bad field. */
export function checkSpawnAgentArgs(input: Record<string, unknown>): string | null {
  const problems: string[] = []
  const { system_prompt: systemPrompt, task, tools } = input

  if (typeof task !== 'string') problems.push(`task is ${task === undefined || task === null ? 'missing' : 'not text'}: give the child its complete brief as text, because it has none of your context.`)
  else if (!task.trim()) problems.push('task is empty: give the child its complete brief, because it has none of your context.')

  if (typeof systemPrompt !== 'string') problems.push(`system_prompt is ${systemPrompt === undefined || systemPrompt === null ? 'missing' : 'not text'}: give the child a one-line role as text.`)

  if (tools !== undefined && tools !== null && typeof tools !== 'string') {
    problems.push('tools must be one comma-separated string of tool names such as "shell_exec,github_search_code", not a list or object. Omit it to give the child all tools.')
  }

  if (problems.length === 0) return null
  return `spawn_agent was refused before any child started: ${problems.join(' ')}`
}
