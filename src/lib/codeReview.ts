// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Code review on GitHub Actions ───────────────────────────────────────────
// review_code used to return "dispatched" and nobody saw the review. This dispatches code-review.yml
// (DeepSeek-Coder 6.7B, 4-bit GGUF), waits for the correlated run and reads the review from the
// review-results branch, which the workflow's write-only mirror job publishes (also for a failed run).

import type { GithubRequest } from './githubPublish'
import { dispatchAndWait, newInvocationId } from './workflowRun'

export const CODE_REVIEW_WORKFLOW = 'code-review.yml'
export const REVIEW_RESULT_BRANCH = 'review-results'
export const REVIEW_MAX_WAIT_MS = 20 * 60 * 1000
/** Same bound as .github/scripts/review_code.py MAX_CODE_CHARS. */
export const MAX_REVIEW_CODE_CHARS = 12_000

export interface CodeReviewInput {
  owner: string
  repo: string
  token: string
  code: string
  language?: string
  signal?: AbortSignal
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

export async function runCodeReview(request: GithubRequest, input: CodeReviewInput): Promise<{ review: string; model: string; runUrl: string; invocationId: string }> {
  const code = input.code.trim()
  if (!code) throw new Error('review_code needs the code to review')
  if (code.length > MAX_REVIEW_CODE_CHARS) throw new Error(`review_code takes at most ${MAX_REVIEW_CODE_CHARS} characters (got ${code.length}); review a smaller part`)
  const language = (input.language || 'typescript').trim().slice(0, 40) || 'typescript'
  const invocationId = newInvocationId('review')
  const run = await dispatchAndWait(request, {
    owner: input.owner, repo: input.repo, token: input.token, workflow: CODE_REVIEW_WORKFLOW,
    inputs: { code_content: code, language, invocation_id: invocationId },
    invocationId, maxWaitMs: REVIEW_MAX_WAIT_MS, signal: input.signal, sleep: input.sleep, now: input.now,
  })
  const read = (file: string) => request(`https://api.github.com/repos/${input.owner}/${input.repo}/contents/${REVIEW_RESULT_BRANCH}/${file}?ref=${REVIEW_RESULT_BRANCH}`, {
    headers: { Authorization: `token ${input.token}`, Accept: 'application/vnd.github.raw+json' }, cache: 'no-store',
  })
  const res = await read(`${invocationId}.txt`)
  if (!res.ok) throw new Error(`code review run #${run.run_number} concluded "${run.conclusion}" and its review could not be read (GitHub ${res.status}). Logs: ${run.html_url}`)
  const review = (await res.text()).trim()
  if (run.conclusion !== 'success' || !review || /^REVIEW FAILED/.test(review)) throw new Error(`code review run #${run.run_number} failed (${run.conclusion}). Logs: ${run.html_url}`)
  const meta = await read(`${invocationId}.meta.txt`).then(r => r.ok ? r.text() : '').catch(() => '')
  const model = /^model=(.+)$/m.exec(meta)?.[1] || 'DeepSeek-Coder 6.7B'
  return { review, model, runUrl: run.html_url, invocationId }
}

export function formatCodeReview(result: { review: string; model: string; runUrl: string }): string {
  return `✓ Code review by ${result.model} · run ${result.runUrl}\n${result.review}`
}
