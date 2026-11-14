// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

/**
 * Argument validation for the GitHub read tools, run before the call is dispatched.
 *
 * Why (forgeclaw #235, task for `claude`, owner directive 2026-11-13): under the Nexus provider the Run 25 checkpoint
 * emitted github_read_file with path ":", owner "." and start_line 257257207 (its known verbatim digit-copying fault; the
 * model is Muse's lane). The app dispatched it anyway: a real GitHub request for a path that cannot exist. A call like that
 * now comes back as a short, legible refusal naming the argument, which the model can correct.
 *
 * Refusal-only, like the shell_patch hunk pre-check: it adds no permission and changes no call that works today. It
 * refuses only an argument no GitHub request can satisfy: a missing or non-string path, a path with no letter or digit, a
 * `..` segment, an owner or repo that is not a GitHub name, a start_line that is not a whole line number. Everything the tools accept
 * today (leading slashes, dotfiles such as .gitignore, start_line 0, an omitted owner or repo) is untouched. The Guardian
 * gate and the completion guard are not involved; a refused call is an ordinary failed tool result.
 *
 * Kept short on purpose: the refusal is read back by a model with a 640-token window.
 */

/** A source file longer than this does not exist in this repository; 257257207 is what the checkpoint produced. */
export const MAX_PLAUSIBLE_LINE = 1_000_000
const MAX_PATH_CHARS = 500
const MAX_QUERY_CHARS = 1_000

/** The GitHub read tools whose arguments are checked here. */
export const VALIDATED_READ_TOOLS: ReadonlySet<string> = new Set(['github_read_file', 'github_list_files', 'github_search_code'])

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/

function shown(value: unknown): string {
  const text = typeof value === 'string' ? JSON.stringify(value) : String(value)
  return text.length > 40 ? `${text.slice(0, 37)}...` : text
}

function hasControlChar(text: string): boolean {
  return Array.from(text).some(ch => { const code = ch.charCodeAt(0); return code < 32 || code === 127 })
}

function checkName(input: Record<string, unknown>, key: 'owner' | 'repo', problems: string[]): void {
  const value = input[key]
  if (value === undefined || value === null || value === '') return  // omitted: the configured repository is used
  const ok = typeof value === 'string' && (key === 'owner' ? OWNER_RE.test(value) : REPO_RE.test(value) && value !== '.' && value !== '..')
  if (ok) return
  problems.push(key === 'owner'
    ? `owner is ${shown(value)}, not a GitHub account name (omit it to use the configured repository)`
    : `repo is ${shown(value)}, not a repository name without the owner (omit it to use the configured repository)`)
}

function checkPath(input: Record<string, unknown>, required: boolean, problems: string[]): void {
  const value = input.path
  if (value === undefined || value === null || value === '') {
    if (required) problems.push('path is missing (give a file path such as "src/App.tsx")')
    return
  }
  if (typeof value !== 'string') { problems.push(`path is ${shown(value)}, not text (give a file path such as "src/App.tsx")`); return }
  const trimmed = value.trim()
  if (!trimmed && required) { problems.push('path is empty (give a file path such as "src/App.tsx")'); return }
  if (value.length > MAX_PATH_CHARS || hasControlChar(value)) { problems.push(`path is not a file path (${value.length > MAX_PATH_CHARS ? 'over 500 characters' : 'it has a control character'})`); return }
  if (trimmed.split(/[\\/]+/).includes('..')) { problems.push(`path ${shown(value)} contains "..", which is not a repository path`); return }
  // A directory listing may legitimately name the root as "." or "/"; a file read may not.
  const rootLike = !required && /^(?:\.|\.\/|\/)$/.test(trimmed)
  if (!rootLike && !/[A-Za-z0-9]/.test(trimmed)) problems.push(`path is ${shown(value)}, not a ${required ? 'file' : 'directory'} path (for example "src/App.tsx")`)
}

function checkStartLine(input: Record<string, unknown>, problems: string[]): void {
  const value = input.start_line
  if (value === undefined || value === null || value === '') return
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : NaN
  if (Number.isInteger(number) && number >= 0 && number <= MAX_PLAUSIBLE_LINE) return  // 0 reads from the top, as before
  problems.push(`start_line is ${shown(value)}, not a plausible line number (a whole number from 1 to ${MAX_PLAUSIBLE_LINE}, or omit it to read from the top)`)
}

/**
 * Why a GitHub read call must not be dispatched, or null. The text starts with "[TOOL ERROR]" so it reads as the failed
 * tool result it is, names every bad argument (at most four), and says nothing was run.
 */
export function toolArgumentRefusal(name: string, input: Record<string, unknown> | undefined): string | null {
  if (!VALIDATED_READ_TOOLS.has(name)) return null
  const args = input && typeof input === 'object' ? input : {}
  const problems: string[] = []
  if (name === 'github_read_file') {
    checkPath(args, true, problems)
    checkStartLine(args, problems)
  } else if (name === 'github_list_files') {
    checkPath(args, false, problems)
  } else {
    const query = args.query
    if (typeof query !== 'string' || !query.trim()) problems.push('query is missing or empty (give the text to search for)')
    else if (query.length > MAX_QUERY_CHARS) problems.push(`query is ${query.length} characters (at most ${MAX_QUERY_CHARS})`)
  }
  checkName(args, 'owner', problems)
  checkName(args, 'repo', problems)
  if (!problems.length) return null
  return `[TOOL ERROR] ${name} was NOT run: ${problems.slice(0, 4).join('; ')}. Correct the argument and call again.`
}
