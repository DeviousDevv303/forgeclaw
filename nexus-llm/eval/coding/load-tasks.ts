// Load and validate a JSON task file (for example the held-out set authored by Muse). Validation is strict because test files are EXECUTED.
//   npx vite-node nexus-llm/eval/coding/check-tasks.ts <tasks.json>
import type { CodingTask } from './tasks'
import { runHiddenTests } from './sim'

export class TaskFileError extends Error {}
const SAFE_PATH = /^[A-Za-z0-9._][A-Za-z0-9._/-]*$/
const MAX_FILE = 20_000, MAX_FILES = 10, MAX_TASKS = 200

export function parseTasks(json: unknown): CodingTask[] {
  if (!Array.isArray(json) || json.length === 0 || json.length > MAX_TASKS) throw new TaskFileError(`expected a non-empty array of at most ${MAX_TASKS} tasks`)
  const ids = new Set<string>()
  return json.map((raw, i) => {
    const t = raw as Partial<CodingTask> | null
    const at = (m: string): never => { throw new TaskFileError(`task ${i + 1}${t?.id ? ` (${t.id})` : ''}: ${m}`) }
    if (!t || typeof t !== 'object') at('not an object')
    const task = t as Partial<CodingTask>
    if (typeof task.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(task.id)) at('id must be lowercase letters, digits and dashes')
    if (ids.has(task.id as string)) at('duplicate id'); ids.add(task.id as string)
    if (task.authored !== 'claude' && task.authored !== 'muse') at('authored must be "claude" or "muse"')
    if (typeof task.prompt !== 'string' || task.prompt.length < 10 || task.prompt.length > 600) at('prompt must be 10-600 characters')
    if (!task.files || typeof task.files !== 'object' || Array.isArray(task.files) || Object.keys(task.files).length === 0 || Object.keys(task.files).length > MAX_FILES) at(`files must be an object of 1-${MAX_FILES} files`)
    for (const [p, c] of Object.entries(task.files as Record<string, unknown>)) {
      if (!SAFE_PATH.test(p) || p.includes('..') || p === 'test.mjs') at(`unsafe or reserved path ${JSON.stringify(p)}`)
      if (typeof c !== 'string' || c.length > MAX_FILE) at(`file ${p} must be a string under ${MAX_FILE} characters`)
    }
    if (typeof task.test !== 'string' || !task.test.trim() || task.test.length > MAX_FILE) at('test must be a non-empty string')
    const s = task.solution
    if (!s || typeof s.path !== 'string' || typeof s.content !== 'string' || !(s.path in (task.files as Record<string, string>))) at('solution must replace one of the existing files {path, content}')
    return task as CodingTask
  })
}

export interface Precondition { id: string; failsBefore: boolean; passesAfter: boolean }
/** Every task must currently fail its tests and pass with its reference solution; otherwise the task measures nothing. */
export function checkPreconditions(tasks: CodingTask[]): Precondition[] {
  return tasks.map(t => ({
    id: t.id,
    failsBefore: !runHiddenTests(t.files, t.test).green,
    passesAfter: runHiddenTests({ ...t.files, [t.solution.path]: t.solution.content }, t.test).green,
  }))
}
