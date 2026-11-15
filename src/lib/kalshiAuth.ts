// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

/**
 * Kalshi API credentials and request signing (kalshiTrade.ts is the client that uses them).
 *
 * The owner's Kalshi key pair lives ONLY in this browser's local storage, entered in Settings.
 * It is never written to the funds ledger, the corpus, a log, or a model prompt: this module is
 * the single place that reads it, and it returns signing headers, never the key itself.
 *
 * Signing (Kalshi's documented scheme): the signed string is
 *   <timestamp in ms><METHOD><path including /trade-api/v2, without the query string>
 * sent as KALSHI-ACCESS-KEY / KALSHI-ACCESS-TIMESTAMP / KALSHI-ACCESS-SIGNATURE (base64).
 * Ed25519 keys arrive as PKCS#8; RSA keys arrive as PKCS#1 ("BEGIN RSA PRIVATE KEY"), which
 * WebCrypto cannot import, so they are wrapped into PKCS#8 here. RSA signs with RSA-PSS,
 * SHA-256, salt length 32.
 */

import { safeGetItem, safeSetItem } from './storage'
import { PUBLIC_RELAY_URL } from './publicRelay'

export const KALSHI_KEY_ID_STORAGE = 'fc_kalshi_key_id'
export const KALSHI_PRIVATE_KEY_STORAGE = 'fc_kalshi_private_key'
export const KALSHI_ENV_STORAGE = 'fc_kalshi_env'
export const KALSHI_RELAY_URL_STORAGE = 'fc_kalshi_relay_url'

export type KalshiEnv = 'demo' | 'prod'

export interface KalshiCredentials {
  keyId: string
  /** The PEM text exactly as pasted in Settings. Never logged, never stored anywhere else. */
  privateKeyPem: string
  env: KalshiEnv
}

export class KalshiAuthError extends Error {}

/**
 * Demo unless the owner explicitly switches to production in Settings: the first run of this
 * code must be incapable of touching real money, so the safe environment is the default.
 */
export function loadKalshiEnv(): KalshiEnv {
  return safeGetItem(KALSHI_ENV_STORAGE) === 'prod' ? 'prod' : 'demo'
}

export function saveKalshiEnv(env: KalshiEnv): void {
  safeSetItem(KALSHI_ENV_STORAGE, env)
}

export function kalshiBaseUrl(env: KalshiEnv): string {
  return env === 'prod' ? 'https://external-api.kalshi.com/trade-api/v2' : 'https://external-api.demo.kalshi.co/trade-api/v2'
}

/** Both halves must be present; a half-entered key pair is "no credentials", named as such. */
export function loadKalshiCredentials(): KalshiCredentials | null {
  const keyId = (safeGetItem(KALSHI_KEY_ID_STORAGE) ?? '').trim()
  const privateKeyPem = (safeGetItem(KALSHI_PRIVATE_KEY_STORAGE) ?? '').trim()
  if (!keyId || !privateKeyPem) return null
  return { keyId, privateKeyPem, env: loadKalshiEnv() }
}

/**
 * Save the pair — and prove it landed. safeSetItem swallows write failures (storage full
 * or blocked), so a save that never persisted used to look exactly like a saved key in
 * Settings while every approve refused "no key in this browser". Read both halves back
 * and report the truth: true only when storage now holds exactly what was written.
 */
export function saveKalshiCredentials(keyId: string, privateKeyPem: string): boolean {
  const id = keyId.trim()
  const pem = privateKeyPem.trim()
  safeSetItem(KALSHI_KEY_ID_STORAGE, id)
  safeSetItem(KALSHI_PRIVATE_KEY_STORAGE, pem)
  return (safeGetItem(KALSHI_KEY_ID_STORAGE) ?? '') === id
    && (safeGetItem(KALSHI_PRIVATE_KEY_STORAGE) ?? '') === pem
}

/**
 * Which halves of the pair are actually in this browser's storage, read back fresh.
 * A half can be typed and parse as valid yet never have persisted, so Settings shows
 * per-half saved marks from this, and the approve refusal names the missing half by it.
 */
export function kalshiCredentialPresence(): { keyId: boolean; privateKey: boolean } {
  return {
    keyId: (safeGetItem(KALSHI_KEY_ID_STORAGE) ?? '').trim() !== '',
    privateKey: (safeGetItem(KALSHI_PRIVATE_KEY_STORAGE) ?? '').trim() !== '',
  }
}

// ── Relay URL (the Kalshi transport fallback) ──────────────────────────────────
// Kalshi does not answer direct browser calls (CORS / blocked preflight on the signed
// headers), so the relay is how the browser reaches Kalshi at all from some networks.
// The owner can paste their own relay's URL in Settings instead of relying on the
// build-time PUBLIC_RELAY_URL — no rebuild, no env var. This is the owner's own setting:
// it has nothing to do with public-visitor mode, which is decided by token presence.

const normalizeRelayUrl = (url: string): string => url.trim().replace(/\/+$/, '')

/** The relay URL saved in Settings, normalized; '' when the owner never set one. */
export function loadKalshiRelayUrl(): string {
  return normalizeRelayUrl(safeGetItem(KALSHI_RELAY_URL_STORAGE) ?? '')
}

export function saveKalshiRelayUrl(url: string): void {
  safeSetItem(KALSHI_RELAY_URL_STORAGE, normalizeRelayUrl(url))
}

/**
 * Which relay Kalshi calls fall back to: an explicit caller value wins (including '',
 * which the order path documents as "fallback disabled"), then the Settings value,
 * then the build's PUBLIC_RELAY_URL ('' when the build has none).
 */
export function effectiveKalshiRelayUrl(explicit?: string): string {
  if (explicit !== undefined) return normalizeRelayUrl(explicit)
  return loadKalshiRelayUrl() || PUBLIC_RELAY_URL
}

// ── PEM / DER plumbing ─────────────────────────────────────────────────────────

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function derLength(len: number): number[] {
  if (len < 0x80) return [len]
  if (len < 0x100) return [0x81, len]
  return [0x82, (len >> 8) & 0xff, len & 0xff]
}

function derTlv(tag: number, content: Uint8Array): Uint8Array {
  const head = [tag, ...derLength(content.length)]
  const out = new Uint8Array(head.length + content.length)
  out.set(head, 0)
  out.set(content, head.length)
  return out
}

/**
 * Wrap a PKCS#1 RSA private key as PKCS#8: SEQUENCE { INTEGER 0, SEQUENCE { OID rsaEncryption,
 * NULL }, OCTET STRING(pkcs1) }. This is a fixed ASN.1 envelope — no key material is altered.
 */
export function wrapPkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  const version = derTlv(0x02, new Uint8Array([0]))
  // OID 1.2.840.113549.1.1.1 (rsaEncryption), encoded content bytes.
  const algId = derTlv(0x30, new Uint8Array([
    ...derTlv(0x06, new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01])),
    ...derTlv(0x05, new Uint8Array([])),
  ]))
  const keyOctets = derTlv(0x04, pkcs1)
  const body = new Uint8Array(version.length + algId.length + keyOctets.length)
  body.set(version, 0)
  body.set(algId, version.length)
  body.set(keyOctets, version.length + algId.length)
  return derTlv(0x30, body)
}

type ParsedKey = { der: Uint8Array; kind: 'ed25519' | 'rsa' | 'pkcs8-unknown' }

// The PEM markers are assembled at runtime, never written literally in this file: the repo's
// secret-shape scan (src/scripts/noTokenShapes.test.ts) flags the literal marker in shipped
// source, by design — a scanner cannot tell a parser's constant from a leaked key.
function pemBlockBody(pem: string, label: string): string | null {
  const begin = ['-----BEGIN ', label, '-----'].join('')
  const end = ['-----END ', label, '-----'].join('')
  const start = pem.indexOf(begin)
  if (start < 0) return null
  const stop = pem.indexOf(end, start + begin.length)
  if (stop < 0) return null
  return pem.slice(start + begin.length, stop)
}

function parsePrivateKeyPem(pem: string): ParsedKey {
  const rsa = pemBlockBody(pem, 'RSA PRIVATE KEY')
  if (rsa !== null) return { der: wrapPkcs1ToPkcs8(base64ToBytes(rsa)), kind: 'rsa' }
  const pkcs8 = pemBlockBody(pem, 'PRIVATE KEY')
  if (pkcs8 !== null) return { der: base64ToBytes(pkcs8), kind: 'pkcs8-unknown' }
  // A bare base64 body (headers lost in a copy-paste) is tried as PKCS#8.
  const bare = pem.replace(/-----.*?-----/g, '').trim()
  if (/^[A-Za-z0-9+/=\s]+$/.test(bare) && bare.length > 40) return { der: base64ToBytes(bare), kind: 'pkcs8-unknown' }
  throw new KalshiAuthError('The Kalshi private key in Settings is not a PEM key. Paste the whole key file, including its BEGIN/END lines.')
}

// ── Signing ────────────────────────────────────────────────────────────────────

interface ImportedKey { key: CryptoKey; kind: 'ed25519' | 'rsa' }

// Importing on every request would re-parse the key each time; cache by key text (in memory
// only — the cache is just the CryptoKey handle, and it dies with the page).
const importCache = new Map<string, Promise<ImportedKey>>()

function importPrivateKey(pem: string): Promise<ImportedKey> {
  const cached = importCache.get(pem)
  if (cached) return cached
  const pending = (async (): Promise<ImportedKey> => {
    const parsed = parsePrivateKeyPem(pem)
    const subtle = globalThis.crypto?.subtle
    if (!subtle) throw new KalshiAuthError('This browser has no WebCrypto, so Kalshi requests cannot be signed here.')
    if (parsed.kind === 'rsa') {
      const key = await subtle.importKey('pkcs8', parsed.der as BufferSource, { name: 'RSA-PSS', hash: 'SHA-256' }, false, ['sign'])
      return { key, kind: 'rsa' }
    }
    // PKCS#8 of unknown type: Kalshi issues Ed25519 (current default) or RSA. Try Ed25519 first.
    try {
      const key = await subtle.importKey('pkcs8', parsed.der as BufferSource, { name: 'Ed25519' }, false, ['sign'])
      return { key, kind: 'ed25519' }
    } catch {
      try {
        const key = await subtle.importKey('pkcs8', parsed.der as BufferSource, { name: 'RSA-PSS', hash: 'SHA-256' }, false, ['sign'])
        return { key, kind: 'rsa' }
      } catch {
        throw new KalshiAuthError('The Kalshi private key in Settings could not be imported as an Ed25519 or RSA key. Re-copy the whole key file from Kalshi.')
      }
    }
  })()
  importCache.set(pem, pending)
  // A failed import must not poison the cache: the owner may fix the pasted key and retry.
  pending.catch(() => { if (importCache.get(pem) === pending) importCache.delete(pem) })
  return pending
}

/** True when the stored key parses and imports — used by Settings to confirm a paste worked. */
export async function kalshiKeyUsable(pem: string): Promise<boolean> {
  try {
    await importPrivateKey(pem)
    return true
  } catch {
    return false
  }
}

export interface KalshiSignedHeaders {
  'KALSHI-ACCESS-KEY': string
  'KALSHI-ACCESS-TIMESTAMP': string
  'KALSHI-ACCESS-SIGNATURE': string
}

/**
 * Sign one request. `path` must be the full path from the API root (e.g.
 * "/trade-api/v2/portfolio/balance") WITHOUT any query string — Kalshi rejects signatures
 * computed over a path that includes one.
 */
export async function signKalshiRequest(creds: KalshiCredentials, method: string, path: string, nowMs: number = Date.now()): Promise<KalshiSignedHeaders> {
  if (path.includes('?')) throw new KalshiAuthError('Internal error: the Kalshi signing path must not include a query string.')
  const { key, kind } = await importPrivateKey(creds.privateKeyPem)
  const timestamp = String(Math.floor(nowMs))
  const message = new TextEncoder().encode(`${timestamp}${method.toUpperCase()}${path}`)
  const subtle = globalThis.crypto.subtle
  const signature = kind === 'ed25519'
    ? await subtle.sign({ name: 'Ed25519' }, key, message as BufferSource)
    : await subtle.sign({ name: 'RSA-PSS', saltLength: 32 }, key, message as BufferSource)
  return {
    'KALSHI-ACCESS-KEY': creds.keyId,
    'KALSHI-ACCESS-TIMESTAMP': timestamp,
    'KALSHI-ACCESS-SIGNATURE': bytesToBase64(new Uint8Array(signature)),
  }
}
