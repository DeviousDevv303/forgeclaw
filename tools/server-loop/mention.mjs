// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

/**
 * ForgeClaw's answer to an @ForgeClaw mention, for the Channel Watch (.github/workflows/channel-watch.yml).
 *
 * Reads the mention text from MENTION_TEXT, fetches live state only when the ask is a report (main HEAD, open PRs
 * with their checks, the deployed version.json), and prints the reply body to stdout. It never posts: the Channel
 * Watch posts it, on whichever surface the mention came from. Exits non-zero, with the failing request, when a
 * GitHub read fails — a report is never assembled from a partial read.
 *
 * Environment: MENTION_TEXT (required), GH_TOKEN, REPO (owner/name), RUN_ID.
 */

import { buildMentionReply, classifyCall, stateFromApi } from './lib.mjs'

const API = 'https://api.github.com'
const repoSlug = process.env.REPO || process.env.GITHUB_REPOSITORY || 'DeviousDevv303/forgeclaw'
const [owner, repoName] = repoSlug.split('/')
const runId = process.env.RUN_ID || process.env.GITHUB_RUN_ID || 'local'
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || ''

async function fetchJson(url) {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`)
  return res.json()
}

async function liveState() {
  const mainCommit = await fetchJson(`${API}/repos/${repoSlug}/commits/main`)
  const pulls = await fetchJson(`${API}/repos/${repoSlug}/pulls?state=open&per_page=100`)
  const checkRunsBySha = {}
  for (const pr of pulls) {
    checkRunsBySha[pr.head.sha] = await fetchJson(`${API}/repos/${repoSlug}/commits/${pr.head.sha}/check-runs?per_page=100`)
  }
  let version = null
  try {
    const res = await fetch(`https://${owner.toLowerCase()}.github.io/${repoName}/version.json`)
    if (res.ok) version = await res.json()
  } catch {
    version = null
  }
  return stateFromApi({ mainCommit, pulls, checkRunsBySha, version })
}

async function main() {
  const text = process.env.MENTION_TEXT ?? ''
  if (!text.trim()) throw new Error('MENTION_TEXT is empty.')
  const state = classifyCall(text).kind === 'report' ? await liveState() : null
  const reply = buildMentionReply({ text, state, now: new Date().toISOString(), repoSlug, runId })
  process.stdout.write(reply.body)
}

main().catch((err) => {
  console.error(`ForgeClaw mention reply failed: ${err.message}`)
  process.exit(1)
})
