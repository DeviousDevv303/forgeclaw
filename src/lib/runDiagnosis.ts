// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Evidence for a failed workflow run: the actual error text, not just step names ─────────────
// github_get_run_logs used to return only "Step 15: Create labeled pull request (failure)". The model told to
// "read the logs" could never see why, so it guessed. This pulls the failing job's log text (GitHub answers
// with a redirect to the log file) and cuts out the part around the first error; when the log file cannot be
// fetched from the browser, it falls back to the job's annotations, and says so rather than pretending.

import { redactSecrets } from './screenText'

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

const MAX_EXCERPT_CHARS = 3500
const ANSI = /\x1b\[[0-9;]*m/g // eslint-disable-line no-control-regex
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z /

/** The lines around the first error of a job log (or its last lines when none is marked), cleaned for reading. */
export function failureExcerpt(logText: string): string {
  const lines = logText.replace(ANSI, '').split('\n').map(line => line.replace(TIMESTAMP, '').trimEnd())
  const firstError = lines.findIndex(line => line.includes('##[error]'))
  const slice = firstError >= 0
    ? lines.slice(Math.max(0, firstError - 25), Math.min(lines.length, firstError + 3))
    : lines.slice(-40)
  const text = slice
    .filter(line => line.trim() && !line.startsWith('##[group]') && !line.startsWith('##[endgroup]'))
    .map(line => line.replace('##[error]', 'ERROR: '))
    .join('\n')
  const clipped = text.length > MAX_EXCERPT_CHARS ? `…${text.slice(text.length - MAX_EXCERPT_CHARS)}` : text
  return redactSecrets(clipped)
}

/**
 * The error evidence for one failed job: its log excerpt, else its annotations, else a plain statement that
 * neither could be read (never an empty string that looks like "no error").
 */
export async function jobFailureEvidence(request: Fetch, input: { owner: string; repo: string; token: string; jobId: number }): Promise<string> {
  const headers = { Authorization: `token ${input.token}`, Accept: 'application/vnd.github+json' }
  const base = `https://api.github.com/repos/${input.owner}/${input.repo}`
  try {
    const res = await request(`${base}/actions/jobs/${input.jobId}/logs`, { headers })
    if (res.ok) {
      const excerpt = failureExcerpt(await res.text())
      if (excerpt) return `Log excerpt (around the first error):\n${excerpt}`
    }
  } catch { /* the log file is served from another host; a browser may be refused: fall back below */ }
  try {
    const res = await request(`${base}/check-runs/${input.jobId}/annotations`, { headers })
    if (res.ok) {
      const notes = ((await res.json()) as Array<{ annotation_level?: string; message?: string; title?: string }>)
        .filter(note => note.annotation_level === 'failure' && note.message)
        .map(note => `ERROR: ${note.title ? `${note.title}: ` : ''}${note.message}`)
      if (notes.length) return `Error annotations (the log file could not be fetched from the browser):\n${redactSecrets(notes.join('\n')).slice(0, MAX_EXCERPT_CHARS)}`
    }
  } catch { /* nothing more to try */ }
  return 'The log text could not be read from here (open the run link to read it); only the step results above are known.'
}
