// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Self-sculpt key ─────────────────────────────────────────────────────────
// Self-modification (sculpt_self, shell_patch, /sculpt, /patch) is locked until the operator unlocks it
// with a key only they know. The key is never stored: this browser keeps a PBKDF2-SHA-256 hash with a
// random salt, and an unlock lasts for this tab session up to UNLOCK_TTL_MS.
//
// What this protects: someone using the owner's device (or a shared session) cannot start
// self-modification. Visitors cannot sculpt in any case: dispatching the sculpt workflows needs a
// GitHub token with write access, and the public relay only runs the chat model.

const STORE_KEY = 'fc_sculpt_key_v1'
const UNLOCK_KEY = 'fc_sculpt_unlocked_until'
export const SCULPT_KEY_MIN_LENGTH = 12
export const UNLOCK_TTL_MS = 2 * 60 * 60 * 1000
const ITERATIONS = 310_000

interface StoredKey { salt: string; hash: string; iterations: number }

const toHex = (bytes: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('')
const fromHex = (hex: string) => new Uint8Array((hex.match(/../g) ?? []).map(h => parseInt(h, 16)))

async function derive(passphrase: string, salt: Uint8Array, iterations: number): Promise<string> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, material, 256)
  return toHex(bits)
}

function read(): StoredKey | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || 'null') as StoredKey | null
    return parsed && typeof parsed.salt === 'string' && typeof parsed.hash === 'string' ? parsed : null
  } catch { return null }
}

/** Constant-time string comparison for equal-length hex digests. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function hasSculptKey(): boolean {
  return read() !== null
}

/** Set the key the first time (or change it, which requires the current key). Unlocks on success. */
export async function setSculptKey(passphrase: string, currentPassphrase?: string): Promise<void> {
  if (passphrase.length < SCULPT_KEY_MIN_LENGTH) throw new Error(`Use at least ${SCULPT_KEY_MIN_LENGTH} characters (a short phrase is easy to remember and hard to guess).`)
  if (hasSculptKey() && !(currentPassphrase && await verifySculptKey(currentPassphrase))) throw new Error('Enter the current self-sculpt key to change it.')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const stored: StoredKey = { salt: toHex(salt), hash: await derive(passphrase, salt, ITERATIONS), iterations: ITERATIONS }
  localStorage.setItem(STORE_KEY, JSON.stringify(stored))
  unlockFor(UNLOCK_TTL_MS)
}

export async function verifySculptKey(passphrase: string): Promise<boolean> {
  const stored = read()
  if (!stored) return false
  return same(await derive(passphrase, fromHex(stored.salt), stored.iterations || ITERATIONS), stored.hash)
}

function unlockFor(ms: number, now = Date.now()) {
  try { sessionStorage.setItem(UNLOCK_KEY, String(now + ms)) } catch { /* storage unavailable: stays locked */ }
}

export async function unlockSculpt(passphrase: string): Promise<boolean> {
  if (!await verifySculptKey(passphrase)) return false
  unlockFor(UNLOCK_TTL_MS)
  return true
}

export function lockSculpt(): void {
  try { sessionStorage.removeItem(UNLOCK_KEY) } catch { /* nothing to clear */ }
}

/** True only while an unlock from the correct key is in force in this tab. */
export function isSculptUnlocked(now = Date.now()): boolean {
  if (!hasSculptKey()) return false
  try { return Number(sessionStorage.getItem(UNLOCK_KEY) || 0) > now } catch { return false }
}

export const SCULPT_LOCKED_MESSAGE =
  '[GUARDIAN BLOCKED] Self-sculpt is locked. Unlock it in SETTINGS → Self-sculpt key (only the owner knows it), then ask again.'

/** Self-modification tools gated by the key. */
export const SCULPT_TOOLS: ReadonlySet<string> = new Set(['sculpt_self', 'shell_patch'])
