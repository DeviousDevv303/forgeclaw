// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

/**
 * Refusal-only pre-flight for the GitHub READ tools, run by executeTool before the tool is dispatched.
 *
 * Origin: the owner's live shell_patch test under the Nexus provider (2026-11-13, nexus run 43529590869). The
 * checkpoint emitted github_read_file {"path":":","start_line":257257207,"owner":". The claP 07: CONFIRMED. ..."}.
 * Nothing stopped it: `owner` and `repo` are interpolated straight into the request URL (so owner "." is normalised
 * to a different endpoint), `path` ":" came back as a bare "GitHub 404", and an absurd start_line was only rejected
 * after the file had been fetched. The model's digit formation is not fixable here; what is fixable is that a call
 * which cannot mean anything is refused up front, with a reason short enough for a 640-token window to use.
 *
 * Same family as the shell_patch hunk check (unifiedDiffCheck.ts): it only ever ADDS a refusal. It grants no
 * permission, never edits an argument, and a call that works today is not refused (omitted or empty owner/repo
 * fall back to the configured repository; "./src/x.ts", a leading "/", start_line 0 and the repository-root
 * forms of github_list_files all stay valid). Write tools are deliberately not covered: they are Guardian's.
 */

/** A file the contents API can return inline is at most 1 MB, so it cannot have more lines than that. */
export const MAX_START_LINE = 1_000_000

const OWNER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/
const REPO = /^[A-Za-z0-9._-]{1,100}$/
const RUN_ID = /^\d{1,20}$/
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/
const HAS_NAME_CHAR = /[\p{L}\p{N}_]/u

const OWNER_REPO_TOOLS: ReadonlySet<string> = new Set([
  'github_read_file', 'github_list_files', 'github_search_code', 'github_get_run_status',
  'github_get_run_logs', 'github_list_prs', 'github_pr_info', 'github_repo_state',
])

/** A value shown back to the model: quoted, control characters dropped, cut short (it may be garbage). */
function shown(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value)
  const clean = text.replace(new RegExp(CONTROL.source, 'g'), ' ').trim()
  return JSON.stringify(clean.length > 24 ? `${clean.slice(0, 24)}…` : clean)
}

/** undefined, null and "" mean "not supplied": the handler falls back to the configured default for these. */
function absent(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

function checkOwnerRepo(input: Record<string, unknown>, problems: string[]): void {
  const { owner, repo } = input
  if (!absent(owner) && !(typeof owner === 'string' && OWNER.test(owner))) {
    problems.push(`owner ${shown(owner)} is not a GitHub account name (letters, digits, - and _). Omit owner to use the configured repository.`)
  }
  if (!absent(repo)) {
    if (typeof repo === 'string' && repo.includes('/')) {
      problems.push(`repo ${shown(repo)} is not a repository name: it contains a slash. Put the account in owner, or omit both to use the configured repository.`)
    } else if (!(typeof repo === 'string' && REPO.test(repo) && repo !== '.' && repo !== '..')) {
      problems.push(`repo ${shown(repo)} is not a repository name. Omit repo to use the configured repository.`)
    }
  }
}

function checkPath(input: Record<string, unknown>, problems: string[], required: boolean): void {
  const { path } = input
  if (absent(path)) {
    if (required) problems.push('path is required: give a repository-relative file path such as "README.md".')
    return
  }
  if (typeof path !== 'string') {
    problems.push(`path ${shown(path)} is not text. Give a repository-relative file path such as "README.md".`)
    return
  }
  const bare = path.replace(/^\/+/, '')
  const onlyDotsAndSlashes = /^[./\\]*$/.test(bare)
  const segments = bare.split(/[/\\]/)
  if (CONTROL.test(path) || path.length > 2048 || segments.includes('..')) {
    problems.push(`path ${shown(path)} is not a repository file path (no control characters or ".." segments). Give a path such as "README.md".`)
  } else if (onlyDotsAndSlashes ? required : !HAS_NAME_CHAR.test(bare)) {
    // github_list_files accepts "", ".", "/" and "./" as the repository root; github_read_file needs a file.
    problems.push(`path ${shown(path)} is not a file path. Give a repository-relative file path such as "README.md".`)
  }
}

function checkStartLine(input: Record<string, unknown>, problems: string[]): void {
  const value = input.start_line
  if (absent(value)) return
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  if (!Number.isFinite(n) || n > MAX_START_LINE) {
    problems.push(`start_line ${shown(value)} is not a plausible line number (at most ${MAX_START_LINE}). Omit start_line to read from line 1, or pass the "next" start_line a previous page reported.`)
  }
}

/** Returns null when the call is fine, otherwise one short paragraph naming every bad field and how to recover. */
export function checkGithubReadArgs(tool: string, input: Record<string, unknown>): string | null {
  if (!OWNER_REPO_TOOLS.has(tool)) return null
  const problems: string[] = []
  checkOwnerRepo(input, problems)
  if (tool === 'github_read_file') {
    checkPath(input, problems, true)
    checkStartLine(input, problems)
  } else if (tool === 'github_list_files') {
    checkPath(input, problems, false)
  } else if (tool === 'github_get_run_status' || tool === 'github_get_run_logs') {
    const runId = input.run_id
    if (absent(runId) || !RUN_ID.test(String(runId).trim())) {
      problems.push(`run_id ${absent(runId) ? 'is required' : `${shown(runId)} is not a run ID`}: a workflow run ID is digits only, e.g. 39333499997.`)
    }
  } else if (tool === 'github_search_code') {
    if (typeof input.query !== 'string' || !input.query.trim()) problems.push('query is required: a non-empty search string.')
  }
  if (problems.length === 0) return null
  return `${tool} was refused before it was sent (nothing reached GitHub): ${problems.join(' ')}`
}
