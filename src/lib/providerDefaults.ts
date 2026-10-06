// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

export const PROVIDER_IDS = ['corpus', 'local', 'anthropic', 'nexus'] as const
export type ProviderId = typeof PROVIDER_IDS[number]

/** DeepSeek 16B GitHub Actions is the canonical ForgeClaw reasoning runtime. */
export const DEFAULT_PROVIDER: ProviderId = 'corpus'

export function resolveInitialProvider(savedProvider: string | null): ProviderId {
  if (savedProvider === 'nexus') return DEFAULT_PROVIDER
  return PROVIDER_IDS.includes(savedProvider as ProviderId) ? savedProvider as ProviderId : DEFAULT_PROVIDER
}
