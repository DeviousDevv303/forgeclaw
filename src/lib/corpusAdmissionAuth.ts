// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

export interface CandidateAuthorization {
  keyId: string
  candidateId: string
  candidateIntegrity: string
  issuedAt: string
  expiresAt: string
  signature: string
}

export type AdmissionTrustMode = 'production' | 'test'

export const RFC8032_TEST_KEY_ID = 'rfc8032-test-vector'
export const RFC8032_TEST_PUBLIC_KEY = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a'

/** Production trust is intentionally explicit; the RFC test key is never in it. */
export const PRODUCTION_TRUSTED_KEYS: Readonly<Record<string, string>> = Object.freeze({})

export interface AdmissionTrustConfig {
  mode?: AdmissionTrustMode
  trustedKeys?: Readonly<Record<string, string>>
  now?: () => Date
}

export interface AuthorizationCandidate {
  id: string
  integrity: string
}

export interface AuthorizationValidation {
  valid: boolean
  reason?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** RFC 8785-compatible JSON canonicalization for the authorization fields. */
export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('JCS does not permit non-finite numbers')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalizeJson).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`).join(',')}}`
  }
  throw new Error('JCS cannot canonicalize this value')
}

export function authorizationPayload(authorization: Omit<CandidateAuthorization, 'signature'>): string {
  return canonicalizeJson({
    candidateId: authorization.candidateId,
    candidateIntegrity: authorization.candidateIntegrity,
    expiresAt: authorization.expiresAt,
    issuedAt: authorization.issuedAt,
    keyId: authorization.keyId,
    purpose: 'forgeclaw.corpus.admit.v1',
  })
}

function hexToBytes(value: string): Uint8Array | null {
  if (!/^[0-9a-f]{2,}$/i.test(value) || value.length % 2 !== 0) return null
  const bytes = new Uint8Array(value.length / 2)
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  return bytes
}

function base64ToBytes(value: string): Uint8Array | null {
  try {
    const binary = atob(value)
    return Uint8Array.from(binary, character => character.charCodeAt(0))
  } catch {
    return null
  }
}

function asBufferSource(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer
}

export async function verifyCandidateAuthorization(
  authorization: CandidateAuthorization,
  candidate: AuthorizationCandidate,
  config: AdmissionTrustConfig = {},
): Promise<AuthorizationValidation> {
  if (!authorization || typeof authorization !== 'object') return { valid: false, reason: 'authorization_missing' }
  if (config.mode !== 'test' && authorization.keyId === RFC8032_TEST_KEY_ID) return { valid: false, reason: 'test_key_rejected_in_production' }
  const trustedKeys = config.trustedKeys || (config.mode === 'test' ? { [RFC8032_TEST_KEY_ID]: RFC8032_TEST_PUBLIC_KEY } : PRODUCTION_TRUSTED_KEYS)
  const publicKeyHex = trustedKeys[authorization.keyId]
  if (!publicKeyHex) return { valid: false, reason: 'untrusted_key' }
  if (authorization.candidateId !== candidate.id) return { valid: false, reason: 'candidate_id_mismatch' }
  if (authorization.candidateIntegrity !== candidate.integrity) return { valid: false, reason: 'candidate_integrity_mismatch' }
  const issuedAt = Date.parse(authorization.issuedAt)
  const expiresAt = Date.parse(authorization.expiresAt)
  const now = (config.now || (() => new Date()))().getTime()
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) return { valid: false, reason: 'invalid_authorization_window' }
  if (issuedAt > now || expiresAt <= now) return { valid: false, reason: 'authorization_expired_or_not_yet_valid' }
  const publicKeyBytes = hexToBytes(publicKeyHex)
  const signatureBytes = hexToBytes(authorization.signature) || base64ToBytes(authorization.signature)
  if (!publicKeyBytes || publicKeyBytes.length !== 32 || !signatureBytes || signatureBytes.length !== 64) return { valid: false, reason: 'invalid_signature_encoding' }
  try {
    const key = await globalThis.crypto.subtle.importKey('raw', asBufferSource(publicKeyBytes), { name: 'Ed25519' }, false, ['verify'])
    const valid = await globalThis.crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      asBufferSource(signatureBytes),
      new TextEncoder().encode(authorizationPayload(authorization)),
    )
    return valid ? { valid: true } : { valid: false, reason: 'signature_invalid' }
  } catch {
    return { valid: false, reason: 'signature_verification_failed' }
  }
}
