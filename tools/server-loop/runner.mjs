// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

/**
 * Server loop, Stage 1 — the runner a GitHub Actions workflow invokes.
 *
 * One tick: fetch the channel thread (issue #235), the open PRs with their
 * check runs, main's HEAD, and the deployed version.json; hand it all to
 * the pure decision layer (lib.mjs); post at most one comment — an answer
 * or a Guardian refusal — or post nothing when the board is quiet.
 *
 * Deterministic: no model is called, ever, at this stage. The only network
 * writes are the single comment post. State lives in the channel thread
 * itself (calls, answers, refusals are all comments), so the runner keeps
 * nothing between runs and any runner can pick the loop up.
 *
 * Environment:
 *   GH_TOKEN       required — the workflow's token (issues: write).
 *   REPO           owner/name (the workflow sets this from the run context;
 *                  defaults to GITHUB_REPOSITORY, then the channel repo).
 *   CHANNEL_ISSUE  channel issue number (default 235).
 *   RUN_ID         run identifier printed in the post signature.
 *   DRY_RUN        when "1", print the would-be post instead of posting.
 */

import { decide, stateFromApi } from './lib.mjs'

const API = 'https://api.github.com'
const repoSlug = process.env.REPO || process.env.GITHUB_REPOSITORY || 'DeviousDevv303/forgeclaw'
const [owner, repoName] = repoSlug.split('/')
const issue = Number(process.env.CHANNEL_ISSUE || 235)
const runId = process.env.RUN_ID || process.env.GITHUB_RUN_ID || 'local'
const dryRun = process.env.DRY_RUN === '1'
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || ''

async function fetchJson(url, { auth = true } = {}) {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  if (auth && token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`)
  return res.json()
}

/** Follow ?per_page=100 pagination to the end of a list endpoint. */
async function fetchAllPages(url) {
  const out = []
  let page = 1
  for (;;) {
    const sep = url.includes('?') ? '&' : '?'
    const items = await fetchJson(`${url}${sep}per_page=100&page=${page}`)
    out.push(...items)
    if (items.length < 100) return out
    page += 1
  }
}

async function main() {
  if (!token && !dryRun) throw new Error('GH_TOKEN is required (the workflow provides it).')

  const comments = await fetchAllPages(`${API}/repos/${repoSlug}/issues/${issue}/comments`)
  const pulls = await fetchAllPages(`${API}/repos/${repoSlug}/pulls?state=open`)
  const mainCommit = await fetchJson(`${API}/repos/${repoSlug}/commits/main`)

  const checkRunsBySha = {}
  for (const pr of pulls) {
    checkRunsBySha[pr.head.sha] = await fetchJson(
      `${API}/repos/${repoSlug}/commits/${pr.head.sha}/check-runs?per_page=100`,
    )
  }

  // The deployed truth lives outside the API: the Pages version file.
  // Unreachable means "unknown" in the report — never a guessed state.
  let version = null
  try {
    const res = await fetch(`https://${owner.toLowerCase()}.github.io/${repoName}/version.json`)
    if (res.ok) version = await res.json()
  } catch {
    version = null
  }

  const state = stateFromApi({ mainCommit, pulls, checkRunsBySha, version })
  const now = new Date().toISOString()
  const decision = decide({ comments, state, now, repoSlug, runId, owner })

  if (decision.action === 'quiet') {
    console.log(`server-loop tick (run ${runId}): board quiet — no actionable unanswered call. Nothing posted.`)
    return
  }

  console.log(`server-loop tick (run ${runId}): ${decision.action} call ${decision.call.id}`)
  if (dryRun) {
    console.log('--- DRY RUN: would post ---')
    console.log(decision.post)
    return
  }

  const res = await fetch(`${API}/repos/${repoSlug}/issues/${issue}/comments`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body: decision.post }),
  })
  if (!res.ok) throw new Error(`POST comment -> ${res.status} ${res.statusText}: ${await res.text()}`)
  const posted = await res.json()
  console.log(`posted comment ${posted.id}: ${posted.html_url}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
