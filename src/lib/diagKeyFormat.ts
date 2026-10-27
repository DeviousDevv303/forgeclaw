// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// F-017: the Diagnostics "Key format valid" hint must read the same format gate the request
// path enforces (anthropicProvider.ts:226 / moonshotProvider.ts:310 throw on !isConfigured),
// not mere presence — the Settings inputs write raw keystrokes into state, so a malformed key
// is reachable in-session while the provider treats it as no key at all.
import { ANTHROPIC_KEY_FORMAT, anthropicProvider } from './ai/providers/anthropicProvider'
import { MOONSHOT_KEY_FORMAT, moonshotProvider } from './ai/providers/moonshotProvider'
import { META_KEY_FORMAT, metaProvider } from './ai/providers/metaProvider'
import { cleanApiKey as cleanOpenRouterKey, OPENROUTER_KEY_FORMAT, openrouterProvider } from './ai/providers/openrouterProvider'
import { keyFormatProblem, type KeyFormatProblem } from './ai/keyFormat'

export function diagKeyFormatValid(provider: string, anthropicKey: string, moonshotKey: string, keyPresent: boolean, metaKey = '', openrouterKey = ''): boolean {
  // isConfigured is typed boolean | Promise<boolean> (some providers check async); both of
  // these providers implement it synchronously today. A Promise means "unknown yet" — fall
  // back to presence rather than asserting a format verdict we do not have.
  const check = provider === 'anthropic' ? anthropicProvider.isConfigured(anthropicKey)
    : provider === 'moonshot' ? moonshotProvider.isConfigured(moonshotKey)
    : provider === 'muse' ? metaProvider.isConfigured(metaKey)
    : provider === 'openrouter' ? openrouterProvider.isConfigured(openrouterKey)
    : null
  return typeof check === 'boolean' ? check : keyPresent
}

/**
 * The verdict (from the provider's own gate, as above) and, when it fails, why: worded from the same rule the gate
 * reads (ANTHROPIC_KEY_FORMAT / MOONSHOT_KEY_FORMAT / META_KEY_FORMAT / OPENROUTER_KEY_FORMAT), never from a copy of it in the panel.
 */
export function diagKeyFormat(provider: string, anthropicKey: string, moonshotKey: string, keyPresent: boolean, metaKey = '', openrouterKey = ''): { valid: boolean; problem: KeyFormatProblem | null } {
  const valid = diagKeyFormatValid(provider, anthropicKey, moonshotKey, keyPresent, metaKey, openrouterKey)
  if (valid) return { valid, problem: null }
  const problem = provider === 'anthropic' ? keyFormatProblem(anthropicKey, ANTHROPIC_KEY_FORMAT)
    : provider === 'moonshot' ? keyFormatProblem(moonshotKey, MOONSHOT_KEY_FORMAT)
    : provider === 'muse' ? keyFormatProblem(metaKey, META_KEY_FORMAT)
    : provider === 'openrouter' ? keyFormatProblem(cleanOpenRouterKey(openrouterKey), OPENROUTER_KEY_FORMAT)
    : null
  return { valid, problem }
}
