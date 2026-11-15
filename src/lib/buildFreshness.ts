// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
//
// Stale-build detection. Each build emits version.json with its commit; a tab
// that stays open on a phone keeps running the bundle it first loaded, so the
// app compares its own commit to the deployed one and offers a reload.

export interface DeployedBuild {
  commit: string
  builtAt?: string
}

/** True only when both commits are real and differ; dev/unknown builds never nag. */
export function isNewerBuildAvailable(currentCommit: string, deployed: DeployedBuild | null): boolean {
  if (!deployed?.commit) return false
  const unknown = (commit: string) => !commit || commit === 'dev' || commit === 'unknown'
  if (unknown(currentCommit) || unknown(deployed.commit)) return false
  return deployed.commit !== currentCommit
}

/** Read the deployed version.json, bypassing HTTP caches. Failures return null (offline is not stale). */
export async function fetchDeployedBuild(
  baseUrl: string,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): Promise<DeployedBuild | null> {
  try {
    const url = `${baseUrl.replace(/\/?$/, '/')}version.json?t=${Date.now()}`
    const response = await fetchImpl(url, { cache: 'no-store' })
    if (!response.ok) return null
    const data = await response.json() as Partial<DeployedBuild>
    return typeof data.commit === 'string' ? { commit: data.commit, builtAt: data.builtAt } : null
  } catch {
    return null
  }
}
