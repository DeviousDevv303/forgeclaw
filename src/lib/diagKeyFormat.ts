// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// F-017: the Diagnostics "Key format valid" hint must read the same format gate the request
// path enforces (anthropicProvider.ts:226 / moonshotProvider.ts:310 throw on !isConfigured),
// not mere presence — the Settings inputs write raw keystrokes into state, so a malformed key
// is reachable in-session while the provider treats it as no key at all.
import { anthropicProvider } from './ai/providers/anthropicProvider'
import { moonshotProvider } from './ai/providers/moonshotProvider'

export function diagKeyFormatValid(provider: string, anthropicKey: string, moonshotKey: string, keyPresent: boolean): boolean {
  // isConfigured is typed boolean | Promise<boolean> (some providers check async); both of
  // these providers implement it synchronously today. A Promise means "unknown yet" — fall
  // back to presence rather than asserting a format verdict we do not have.
  const check = provider === 'anthropic' ? anthropicProvider.isConfigured(anthropicKey)
    : provider === 'moonshot' ? moonshotProvider.isConfigured(moonshotKey)
    : null
  return typeof check === 'boolean' ? check : keyPresent
}
