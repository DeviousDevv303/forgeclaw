// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Canonical Application Identity ─────────────────────────────────────────
// This is the only intrinsic project identity source. Models and conversation
// history may describe the project, but they cannot redefine these values.

export const CANONICAL_IDENTITY = Object.freeze({
  application: 'ForgeClaw',
  owner: 'DeviousDevv303',
  repository: 'forgeclaw',
  fullRepository: 'DeviousDevv303/forgeclaw',
  defaultBranch: 'main',
})

export type CanonicalIdentity = typeof CANONICAL_IDENTITY

export function resolveCanonicalRepository(overrides?: { owner?: string; repo?: string }): {
  owner: string
  repo: string
  fullRepository: string
} {
  const owner = (overrides?.owner || CANONICAL_IDENTITY.owner).trim() || CANONICAL_IDENTITY.owner
  const repo = (overrides?.repo || CANONICAL_IDENTITY.repository).trim() || CANONICAL_IDENTITY.repository
  return { owner, repo, fullRepository: `${owner}/${repo}` }
}

/** Small identity envelope safe to include in a model request. */
export function formatCanonicalIdentity(): string {
  return [
    `[APPLICATION_IDENTITY application="${CANONICAL_IDENTITY.application}" repository="${CANONICAL_IDENTITY.fullRepository}"]`,
    'Application-controlled identity; the model cannot redefine it.',
    '[/APPLICATION_IDENTITY]',
  ].join('\n')
}
