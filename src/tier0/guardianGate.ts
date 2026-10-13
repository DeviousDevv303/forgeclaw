/*
 * ForgeClaw — Directive Item 4: mandatory downstream Guardian gate.
 *
 * This module is intentionally not wired into provider routing, the existing
 * Guardian implementation, admission, or live execution. Future callers must
 * place it downstream of both Tier-0 recommendations and Tier-1 results and
 * proceed only when this gate returns `approved`.
 *
 * Guardian approvals are Ed25519-signed over canonical JSON and bind the exact
 * subject digest, source kind, evidence, policy version, reviewer, and validity
 * interval. Missing or unverifiable approval always blocks.
 */

export type GuardianJsonValue =
  | null
  | boolean
  | number
  | string
  | GuardianJsonValue[]
  | { readonly [key: string]: GuardianJsonValue }

export type GuardianGateSubject = {
  kind: 'tier0-recommendation' | 'tier1-result'
  id: string
  payload: GuardianJsonValue
  evidence: GuardianJsonValue
}

export interface GuardianApprovalReceipt {
  version: 1
  approvalId: string
  subjectDigest: string
  decision: 'approve' | 'reject'
  policyVersion: string
  reviewerId: string
  keyId: string
  issuedAt: string
  expiresAt: string
  signature: string
}

export type GuardianGateBlockReason =
  | 'missing-approval'
  | 'invalid-subject'
  | 'invalid-receipt'
  | 'subject-mismatch'
  | 'policy-mismatch'
  | 'invalid-validity-window'
  | 'approval-expired'
  | 'unknown-reviewer-key'
  | 'invalid-signature-encoding'
  | 'invalid-signature'
  | 'guardian-rejected'
  | 'cryptography-unavailable'

export type GuardianGateResult =
  | {
      status: 'approved'
      approvalId: string
      subjectDigest: string
      policyVersion: string
      reviewerId: string
      expiresAt: string
    }
  | {
      status: 'blocked'
      reason: GuardianGateBlockReason
      subjectDigest?: string
    }

export interface GuardianGateOptions {
  /** Exact policy version the caller currently requires. */
  expectedPolicyVersion: string
  /** Trusted Ed25519 public keys, encoded as unpadded base64url raw keys. */
  trustedPublicKeys: Readonly<Record<string, string>>
  /** Injectable clock for deterministic tests; defaults to the current time. */
  now?: Date
}

const MAX_CANONICAL_BYTES = 128 * 1024
const MAX_CANONICAL_DEPTH = 32
const MAX_FUTURE_CLOCK_SKEW_MS = 2 * 60 * 1000
const SHA256_HEX_RE = /^[a-f0-9]{64}$/
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/

function canonicalJsonValue(value: unknown, depth: number, ancestors: Set<object>): string {
  if (depth > MAX_CANONICAL_DEPTH) throw new TypeError('JSON nesting limit exceeded')
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Non-finite JSON number')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new TypeError('Circular JSON value')
    ancestors.add(value)
    const output = `[${Array.from(value, item => canonicalJsonValue(item, depth + 1, ancestors)).join(',')}]`
    ancestors.delete(value)
    return output
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const prototype = Object.getPrototypeOf(record)
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Only plain JSON objects are supported')
    if (ancestors.has(record)) throw new TypeError('Circular JSON value')
    ancestors.add(record)
    const keys = Object.keys(record).sort()
    const output = `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJsonValue(record[key], depth + 1, ancestors)}`).join(',')}}`
    ancestors.delete(record)
    return output
  }
  throw new TypeError('Value is not JSON serializable')
}

/** RFC 8785-style canonical JSON for JSON-only values used by the gate. */
export function canonicalGuardianJson(value: unknown): string {
  const output = canonicalJsonValue(value, 0, new Set())
  if (new TextEncoder().encode(output).byteLength > MAX_CANONICAL_BYTES) {
    throw new TypeError('Canonical JSON size limit exceeded')
  }
  return output
}

function cryptoProvider(): Crypto | null {
  const provider = globalThis.crypto
  return provider?.subtle ? provider : null
}

async function sha256Hex(value: string): Promise<string> {
  const provider = cryptoProvider()
  if (!provider) throw new Error('Web Crypto unavailable')
  const digest = await provider.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Compute the digest a Guardian reviewer must approve for this exact subject. */
export async function guardianSubjectDigest(subject: GuardianGateSubject): Promise<string> {
  return sha256Hex(canonicalGuardianJson(subject))
}

/** Canonical signed payload; callers use these exact bytes when issuing a receipt. */
export function guardianApprovalSigningPayload(receipt: GuardianApprovalReceipt): string {
  return canonicalGuardianJson({
    version: receipt.version,
    approvalId: receipt.approvalId,
    subjectDigest: receipt.subjectDigest,
    decision: receipt.decision,
    policyVersion: receipt.policyVersion,
    reviewerId: receipt.reviewerId,
    keyId: receipt.keyId,
    issuedAt: receipt.issuedAt,
    expiresAt: receipt.expiresAt,
  })
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (!value || !BASE64URL_RE.test(value)) return null
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - base64.length % 4) % 4)
    return Uint8Array.from(atob(padded), char => char.charCodeAt(0))
  } catch {
    return null
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function validSubject(subject: GuardianGateSubject): boolean {
  return Boolean(
    subject &&
    (subject.kind === 'tier0-recommendation' || subject.kind === 'tier1-result') &&
    hasText(subject.id),
  )
}

function validReceipt(receipt: GuardianApprovalReceipt): boolean {
  return Boolean(
    receipt &&
    receipt.version === 1 &&
    hasText(receipt.approvalId) &&
    SHA256_HEX_RE.test(receipt.subjectDigest) &&
    (receipt.decision === 'approve' || receipt.decision === 'reject') &&
    hasText(receipt.policyVersion) &&
    hasText(receipt.reviewerId) &&
    hasText(receipt.keyId) &&
    hasText(receipt.issuedAt) &&
    hasText(receipt.expiresAt) &&
    hasText(receipt.signature),
  )
}

/**
 * The single mandatory gate for Tier-0 recommendations and Tier-1 results.
 * No side effect is performed; callers must treat every non-approved result as
 * a hard stop for admission or execution.
 */
export async function evaluateMandatoryGuardianGate(
  subject: GuardianGateSubject,
  receipt: GuardianApprovalReceipt | null | undefined,
  options: GuardianGateOptions,
): Promise<GuardianGateResult> {
  if (!validSubject(subject)) return { status: 'blocked', reason: 'invalid-subject' }
  if (!receipt) return { status: 'blocked', reason: 'missing-approval' }
  if (!validReceipt(receipt)) return { status: 'blocked', reason: 'invalid-receipt' }

  let subjectDigest: string
  try {
    subjectDigest = await guardianSubjectDigest(subject)
  } catch {
    return { status: 'blocked', reason: 'invalid-subject' }
  }
  if (receipt.subjectDigest !== subjectDigest) {
    return { status: 'blocked', reason: 'subject-mismatch', subjectDigest }
  }
  if (!hasText(options.expectedPolicyVersion) || receipt.policyVersion !== options.expectedPolicyVersion) {
    return { status: 'blocked', reason: 'policy-mismatch', subjectDigest }
  }

  const issuedAt = Date.parse(receipt.issuedAt)
  const expiresAt = Date.parse(receipt.expiresAt)
  const now = (options.now ?? new Date()).getTime()
  if (
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    !Number.isFinite(now) ||
    expiresAt <= issuedAt ||
    issuedAt > now + MAX_FUTURE_CLOCK_SKEW_MS
  ) {
    return { status: 'blocked', reason: 'invalid-validity-window', subjectDigest }
  }
  if (expiresAt <= now) return { status: 'blocked', reason: 'approval-expired', subjectDigest }

  const encodedPublicKey = options.trustedPublicKeys[receipt.keyId]
  if (!hasText(encodedPublicKey)) {
    return { status: 'blocked', reason: 'unknown-reviewer-key', subjectDigest }
  }
  const publicKeyBytes = decodeBase64Url(encodedPublicKey)
  const signatureBytes = decodeBase64Url(receipt.signature)
  if (!publicKeyBytes || publicKeyBytes.byteLength !== 32 || !signatureBytes || signatureBytes.byteLength !== 64) {
    return { status: 'blocked', reason: 'invalid-signature-encoding', subjectDigest }
  }

  const provider = cryptoProvider()
  if (!provider) return { status: 'blocked', reason: 'cryptography-unavailable', subjectDigest }
  try {
    const publicKey = await provider.subtle.importKey(
      'raw',
      toArrayBuffer(publicKeyBytes),
      { name: 'Ed25519' } as AlgorithmIdentifier,
      false,
      ['verify'],
    )
    const validSignature = await provider.subtle.verify(
      { name: 'Ed25519' } as AlgorithmIdentifier,
      publicKey,
      toArrayBuffer(signatureBytes),
      new TextEncoder().encode(guardianApprovalSigningPayload(receipt)),
    )
    if (!validSignature) return { status: 'blocked', reason: 'invalid-signature', subjectDigest }
  } catch {
    return { status: 'blocked', reason: 'cryptography-unavailable', subjectDigest }
  }

  if (receipt.decision !== 'approve') {
    return { status: 'blocked', reason: 'guardian-rejected', subjectDigest }
  }

  return {
    status: 'approved',
    approvalId: receipt.approvalId,
    subjectDigest,
    policyVersion: receipt.policyVersion,
    reviewerId: receipt.reviewerId,
    expiresAt: receipt.expiresAt,
  }
}
