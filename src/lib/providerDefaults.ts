// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

export const PROVIDER_IDS = ['corpus', 'nexus', 'local', 'anthropic'] as const
export type ProviderId = typeof PROVIDER_IDS[number]

/** Combined default: CORPUS/NEXUS is the runtime layer; DeepSeek is its primary reasoning workflow. */
export const DEFAULT_PROVIDER: ProviderId = 'corpus'

export function resolveInitialProvider(savedProvider: string | null): ProviderId {
  return PROVIDER_IDS.includes(savedProvider as ProviderId)
    ? savedProvider as ProviderId
    : DEFAULT_PROVIDER
}
