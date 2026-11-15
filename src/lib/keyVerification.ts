// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── A verified key stays verified ──────────────────────────────────────────────────────────────
// "Verified" used to live only in memory: leave the tab and come back (the phone may discard the page) and a key that
// had tested fine showed yellow again, as if it were about to stop working. Now a successful test remembers a
// fingerprint of that exact key; the key shows verified whenever the key in the box matches it, across reloads. It
// stops showing verified only on evidence: the key is changed, a test or a real request is rejected as unauthorised,
// or the owner clears it. A network failure on a re-test never downgrades it. (The key itself is stored in this
// browser as before; the fingerprint is not a secret and is not sent anywhere.)

import { safeGetItem, safeRemoveItem, safeSetItem } from './storage'

const PREFIX = 'fm_key_verified_'

/** cyrb53: a fast 53-bit string hash. Identity, not security. */
export function keyFingerprint(key: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let i = 0; i < key.length; i++) {
    const ch = key.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)
}

export function isKeyVerified(provider: string, key: string): boolean {
  const trimmed = key.trim()
  if (!trimmed) return false
  return safeGetItem(PREFIX + provider) === keyFingerprint(trimmed)
}

export function markKeyVerified(provider: string, key: string): void {
  if (key.trim()) safeSetItem(PREFIX + provider, keyFingerprint(key.trim()))
}

export function clearKeyVerified(provider: string): void {
  safeRemoveItem(PREFIX + provider)
}

/** Whether a failed test or request means the key was rejected (as opposed to a network problem). */
export function isKeyRejection(message: string): boolean {
  return /\b40[13]\b|unauthori[sz]ed|authentication|invalid.*(api.?key|token|auth)/i.test(message)
}
