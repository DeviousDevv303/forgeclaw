// Directive Item 4: the same downstream Guardian gate protects Tier-0 and Tier-1 inputs.
// These tests exercise the independent gate contract only; no provider, Guardian UI,
// persistence, admission, or live execution path is wired or changed here.
import { beforeAll, describe, expect, it } from 'vitest'
import { webcrypto } from 'node:crypto'
import {
  evaluateMandatoryGuardianGate,
  guardianApprovalSigningPayload,
  guardianSubjectDigest,
  type GuardianApprovalReceipt,
  type GuardianGateSubject,
} from './guardianGate'

Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })

const POLICY_VERSION = 'tier0-guardian-v1'
const KEY_ID = 'test-reviewer-key'
let privateKey: CryptoKey
let publicKeyBase64Url: string

function encodeBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

const tier0Subject: GuardianGateSubject = {
  kind: 'tier0-recommendation',
  id: 'recommendation-42',
  payload: { label: 'local', confidence: 0.94, retrieval: ['case-1'] },
  evidence: { evidenceSetId: 'evidence-9', digest: 'a'.repeat(64) },
}

const tier1Subject: GuardianGateSubject = {
  kind: 'tier1-result',
  id: 'execution-17',
  payload: { tool: 'shell_exec', result: 'tests passed' },
  evidence: { runId: 'run-17', outputDigest: 'b'.repeat(64) },
}

beforeAll(async () => {
  const keyPair = await webcrypto.subtle.generateKey(
    { name: 'Ed25519' } as AlgorithmIdentifier,
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair
  privateKey = keyPair.privateKey
  publicKeyBase64Url = encodeBase64Url(new Uint8Array(await webcrypto.subtle.exportKey('raw', keyPair.publicKey)))
})

async function makeReceipt(
  subject: GuardianGateSubject,
  overrides: Partial<Omit<GuardianApprovalReceipt, 'subjectDigest' | 'signature'>> = {},
): Promise<GuardianApprovalReceipt> {
  const issued = new Date()
  const issuedAt = overrides.issuedAt ?? issued.toISOString()
  const expiresAt = overrides.expiresAt ?? new Date(issued.getTime() + 5 * 60_000).toISOString()
  const receipt: GuardianApprovalReceipt = {
    version: 1,
    approvalId: 'approval-001',
    subjectDigest: await guardianSubjectDigest(subject),
    decision: 'approve',
    policyVersion: POLICY_VERSION,
    reviewerId: 'founder-7',
    keyId: KEY_ID,
    issuedAt,
    expiresAt,
    signature: '',
    ...overrides,
  }
  const signature = await webcrypto.subtle.sign(
    { name: 'Ed25519' } as AlgorithmIdentifier,
    privateKey,
    new TextEncoder().encode(guardianApprovalSigningPayload(receipt)),
  )
  return { ...receipt, signature: encodeBase64Url(new Uint8Array(signature)) }
}

const trustedKeys = { [KEY_ID]: '' }

function options(expectedPolicyVersion = POLICY_VERSION) {
  return {
    expectedPolicyVersion,
    trustedPublicKeys: { ...trustedKeys, [KEY_ID]: publicKeyBase64Url },
  }
}

describe('mandatory downstream Guardian gate', () => {
  it('accepts a signed, subject-bound Tier-0 recommendation', async () => {
    const receipt = await makeReceipt(tier0Subject)
    const result = await evaluateMandatoryGuardianGate(tier0Subject, receipt, options())
    expect(result).toMatchObject({
      status: 'approved',
      approvalId: 'approval-001',
      policyVersion: POLICY_VERSION,
      reviewerId: 'founder-7',
    })
  })

  it('accepts a signed, subject-bound Tier-1 result through the same function', async () => {
    const receipt = await makeReceipt(tier1Subject)
    const result = await evaluateMandatoryGuardianGate(tier1Subject, receipt, options())
    expect(result).toMatchObject({ status: 'approved', approvalId: 'approval-001' })
  })

  it('fails closed when approval is absent', async () => {
    await expect(evaluateMandatoryGuardianGate(tier0Subject, null, options())).resolves.toEqual({
      status: 'blocked',
      reason: 'missing-approval',
    })
  })

  it('rejects replay against a changed payload or evidence set', async () => {
    const receipt = await makeReceipt(tier0Subject)
    const changedSubject = { ...tier0Subject, payload: { label: 'remote', confidence: 0.94, retrieval: ['case-1'] } }
    const result = await evaluateMandatoryGuardianGate(changedSubject, receipt, options())
    expect(result).toMatchObject({ status: 'blocked', reason: 'subject-mismatch' })
  })

  it('rejects a receipt signed for the other tier/source', async () => {
    const receipt = await makeReceipt(tier0Subject)
    const result = await evaluateMandatoryGuardianGate(tier1Subject, receipt, options())
    expect(result).toMatchObject({ status: 'blocked', reason: 'subject-mismatch' })
  })

  it('rejects a different policy version', async () => {
    const receipt = await makeReceipt(tier0Subject, { policyVersion: 'tier0-guardian-v0' })
    const result = await evaluateMandatoryGuardianGate(tier0Subject, receipt, options())
    expect(result).toMatchObject({ status: 'blocked', reason: 'policy-mismatch' })
  })

  it('rejects an explicit signed Guardian rejection', async () => {
    const receipt = await makeReceipt(tier1Subject, { decision: 'reject' })
    const result = await evaluateMandatoryGuardianGate(tier1Subject, receipt, options())
    expect(result).toMatchObject({ status: 'blocked', reason: 'guardian-rejected' })
  })

  it('rejects expired or future-dated approval windows', async () => {
    const now = new Date()
    const expired = await makeReceipt(tier0Subject, {
      issuedAt: new Date(now.getTime() - 120_000).toISOString(),
      expiresAt: new Date(now.getTime() - 60_000).toISOString(),
    })
    await expect(evaluateMandatoryGuardianGate(tier0Subject, expired, { ...options(), now })).resolves.toMatchObject({
      status: 'blocked',
      reason: 'approval-expired',
    })

    const future = await makeReceipt(tier0Subject, {
      issuedAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
      expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
    })
    await expect(evaluateMandatoryGuardianGate(tier0Subject, future, { ...options(), now })).resolves.toMatchObject({
      status: 'blocked',
      reason: 'invalid-validity-window',
    })
  })

  it('requires a trusted key and a valid Ed25519 signature', async () => {
    const receipt = await makeReceipt(tier0Subject)
    await expect(evaluateMandatoryGuardianGate(tier0Subject, receipt, {
      expectedPolicyVersion: POLICY_VERSION,
      trustedPublicKeys: {},
    })).resolves.toMatchObject({ status: 'blocked', reason: 'unknown-reviewer-key' })

    const alteredReceipt = { ...receipt, approvalId: 'approval-altered' }
    await expect(evaluateMandatoryGuardianGate(tier0Subject, alteredReceipt, options())).resolves.toMatchObject({
      status: 'blocked',
      reason: 'invalid-signature',
    })
  })

  it('rejects malformed subjects and signature encodings', async () => {
    const invalidSubject = { ...tier0Subject, id: ' ' }
    await expect(evaluateMandatoryGuardianGate(invalidSubject, null, options())).resolves.toMatchObject({
      status: 'blocked',
      reason: 'invalid-subject',
    })

    const receipt = await makeReceipt(tier0Subject)
    await expect(evaluateMandatoryGuardianGate(tier0Subject, { ...receipt, signature: 'AA' }, options())).resolves.toMatchObject({
      status: 'blocked',
      reason: 'invalid-signature-encoding',
    })
  })
})
