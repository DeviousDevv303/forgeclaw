// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Code search that searches code ──────────────────────────────────────────────────────────────
// GitHub's code-search API is often unreachable from the browser (NEXUS: github_search_code 3 of 34 ok). Its fallback
// matched file NAMES only and still reported success: "Found 0 matches for formatElapsed (via file listing)" while the
// function was right there. When the API fails, ForgeClaw now greps the file CONTENTS on a runner (the shell workflow,
// read-only checkout) and reports where each match is; a names-only result says so, and finding nothing that way is an error.

const MAX_QUERY = 200
const MAX_LINES = 60

/** The read-only git grep command for a literal, case-insensitive query, or '' when the query cannot be sent safely. */
export function gitGrepCommand(query: string): string {
  const q = query.trim()
  if (!q || q.length > MAX_QUERY || [...q].some(ch => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)) return ''
  const quoted = `'${q.replace(/'/g, `'\\''`)}'`
  return `git grep -n -I -F -i -e ${quoted} -- . ':(exclude)package-lock.json' | head -n ${MAX_LINES}`
}

export interface GrepMatch { path: string; line: number; text: string }

/** Matches from a shell_exec result, [] when it ran and found nothing, or null when the search itself did not run. */
export function parseGrepOutput(shellResult: string): GrepMatch[] | null {
  if (/^\s*\[(?:TOOL ERROR|GUARDIAN)/.test(shellResult) || !/^Shell execution complete\./.test(shellResult.trim())) return null
  const body = shellResult.split('\n\n').slice(1).join('\n\n')
  if (!body.trim() || /^\(command produced no output\)\s*$/.test(body.trim())) return []
  const matches: GrepMatch[] = []
  for (const raw of body.split('\n')) {
    const m = /^([^:\n]+):(\d+):(.*)$/.exec(raw)
    if (m) matches.push({ path: m[1], line: Number(m[2]), text: m[3].trim().slice(0, 160) })
  }
  return matches
}

export function formatGrepMatches(query: string, matches: GrepMatch[], apiReason: string): string {
  const files = new Set(matches.map(m => m.path))
  const head = `Found ${matches.length}${matches.length >= MAX_LINES ? '+' : ''} matching line(s) in ${files.size} file(s) for "${query}" ` +
    `(searched file CONTENTS with git grep on a runner, because GitHub's code-search API was not usable from the browser: ${apiReason})`
  if (!matches.length) return `${head}:\n(no file contains it)`
  return `${head}:\n${matches.map(m => `• ${m.path}:${m.line}: ${m.text}`).join('\n')}`
}
