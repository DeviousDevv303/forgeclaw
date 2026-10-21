// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Merge a pull request, with the checks a person would make ─────────────────────────────────
// github_merge_pr is co-signed under every posture (guardianGate.ts) and locked behind the self-sculpt key. On top of
// that the tool itself refuses anything a careful reviewer would not merge, and tells the model why:
// not open, a draft, not targeting the default branch, conflicts, a head that moved since it was looked at,
// a protected path in the change (.github/, Guardian, build configs: merged by the owner on GitHub, never from chat),
// or checks that are missing, running or not green. The merge request carries the head SHA it checked, so GitHub
// refuses it if anything was pushed in between.

import { isProtectedPath, parseProtectedList } from './protectedPaths'

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export interface MergeInput {
  owner: string
  repo: string
  token: string
  pullNumber: number
  /** If given, the merge is refused unless the pull request's head is exactly this commit. */
  expectedHeadSha?: string
  method?: 'squash' | 'merge' | 'rebase'
  sleep?: (ms: number) => Promise<void>
}

interface Pull {
  number: number; title: string; state: string; draft?: boolean; merged?: boolean
  mergeable: boolean | null; mergeable_state?: string; changed_files: number
  head: { sha: string }
  base: { ref: string; repo?: { default_branch?: string } }
  labels?: Array<{ name: string }>
}

const GREEN = new Set(['success', 'skipped', 'neutral'])
const MAX_FILES = 300

async function getJson<T>(request: Fetch, url: string, what: string, headers: Record<string, string>): Promise<T> {
  const res = await request(url, { headers })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string }
    throw new Error(`Could not read ${what}: GitHub ${res.status}${body.message ? ` ${body.message}` : ''}. Nothing was merged.`)
  }
  return await res.json() as T
}

export async function mergePullRequest(request: Fetch, input: MergeInput): Promise<string> {
  const headers = { Authorization: `token ${input.token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }
  const base = `https://api.github.com/repos/${input.owner}/${input.repo}`
  const sleep = input.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const n = input.pullNumber
  if (!Number.isInteger(n) || n < 1) throw new Error('pull_number must be a positive whole number.')

  let pr = await getJson<Pull>(request, `${base}/pulls/${n}`, `pull request #${n}`, headers)
  if (pr.mergeable === null) { await sleep(2000); pr = await getJson<Pull>(request, `${base}/pulls/${n}`, `pull request #${n}`, headers) }
  if (pr.merged || pr.state !== 'open') throw new Error(`Pull request #${n} is ${pr.merged ? 'already merged' : pr.state}; nothing to merge.`)
  if (pr.draft) throw new Error(`Pull request #${n} is still a draft. Mark it ready for review first.`)
  const defaultBranch = pr.base.repo?.default_branch ?? 'main'
  if (pr.base.ref !== defaultBranch) throw new Error(`Pull request #${n} targets "${pr.base.ref}", not the default branch "${defaultBranch}"; refusing.`)
  if (pr.mergeable === false || pr.mergeable_state === 'dirty') throw new Error(`Pull request #${n} has merge conflicts. Resolve them first; nothing was merged.`)
  if (input.expectedHeadSha && input.expectedHeadSha !== pr.head.sha) {
    throw new Error(`Pull request #${n} changed since it was reviewed (head is now ${pr.head.sha.slice(0, 7)}, expected ${input.expectedHeadSha.slice(0, 7)}). Review it again.`)
  }
  const head = pr.head.sha

  // Protected paths: the policy comes from the default branch, never from the change under review.
  if (pr.changed_files > MAX_FILES) throw new Error(`Pull request #${n} changes ${pr.changed_files} files; too many to check here (limit ${MAX_FILES}). Merge it on GitHub.`)
  const policyFile = await getJson<{ content?: string; encoding?: string }>(request, `${base}/contents/.github/protected-paths.txt?ref=${encodeURIComponent(defaultBranch)}`, 'the protected-paths policy', headers)
  if (!policyFile.content || policyFile.encoding !== 'base64') throw new Error('Could not read the protected-paths policy, so the change cannot be checked. Nothing was merged.')
  const entries = parseProtectedList(new TextDecoder().decode(Uint8Array.from(atob(policyFile.content.replace(/\s/g, '')), c => c.charCodeAt(0))))
  const paths: string[] = []
  for (let page = 1; paths.length < pr.changed_files && page <= 3; page++) {
    const files = await getJson<Array<{ filename: string; previous_filename?: string }>>(request, `${base}/pulls/${n}/files?per_page=100&page=${page}`, `the files of pull request #${n}`, headers)
    if (!files.length) break
    for (const f of files) { paths.push(f.filename); if (f.previous_filename) paths.push(f.previous_filename) }
  }
  const protectedHits = [...new Set(paths.filter(p => isProtectedPath(p, entries)))]
  if (protectedHits.length) {
    throw new Error(`Pull request #${n} changes protected paths (${protectedHits.slice(0, 5).join(', ')}${protectedHits.length > 5 ? ', …' : ''}). Those are merged by the owner on GitHub, never from chat. Nothing was merged.`)
  }

  // Checks on exactly this head: at least one, all finished, all green.
  const runs = await getJson<{ total_count: number; check_runs: Array<{ name: string; status: string; conclusion: string | null }> }>(request, `${base}/commits/${head}/check-runs?per_page=100`, 'the checks', headers)
  if (!runs.check_runs.length) throw new Error(`No checks ran on pull request #${n} (head ${head.slice(0, 7)}). Pull requests opened by the default Actions token get none; nothing was merged.`)
  const notGreen = runs.check_runs.filter(r => r.status !== 'completed' || !GREEN.has(r.conclusion ?? ''))
  if (notGreen.length) {
    throw new Error(`Checks are not all green on pull request #${n}: ${notGreen.map(r => `${r.name} (${r.status === 'completed' ? r.conclusion : r.status})`).join(', ')}. Nothing was merged.`)
  }

  const res = await request(`${base}/pulls/${n}/merge`, {
    method: 'PUT', headers,
    body: JSON.stringify({ merge_method: input.method ?? 'squash', sha: head }),
  })
  const body = await res.json().catch(() => ({})) as { merged?: boolean; sha?: string; message?: string }
  if (!res.ok || body.merged === false) throw new Error(`GitHub refused the merge of pull request #${n}: ${res.status} ${body.message ?? ''}`.trim() + '. Nothing was merged.')
  return `✓ Merged pull request #${n} "${pr.title}" into ${defaultBranch} (${input.method ?? 'squash'}) as ${(body.sha ?? '').slice(0, 7) || 'a new commit'}. ` +
    `Checks green on ${head.slice(0, 7)}: ${runs.check_runs.map(r => r.name).join(', ')}. The site redeploys from ${defaultBranch}. This cannot be undone from here; revert it on GitHub if needed.`
}
