# CORPUS Admission Route Map

**Date:** 2026-10-13
**Status:** Documents implementation after Gaps 1+2

## Entry Points

### 1. TypeScript/Browser Path
- **File:** `src/lib/corpus.ts`
- **Method:** `CorpusRepository.admitCandidate(candidateId, authorization)`
- **Caller:** `executeTool()` in `src/lib/forgeTools.ts` via `corpus_admit` tool
- **Trigger:** Agent emits `corpus_admit` tool call, or operator approves via Guardian

### 2. Native CLI Path
- **File:** `nexus/native/src/nexus_cli.cpp`
- **Command:** `nexus_cli corpus admit <id> [--deny] [reason]`
- **Protocol:** Sends `CORPUS_ADMIT` via Unix socket to `nexusd`
- **Trigger:** Operator runs CLI directly, or script automation

### 3. Webhook Path (if applicable)
- **File:** `src/lib/corpus.ts` → `handleWebhookCandidate()` (check if exists)
- **Note:** Webhook candidates enter as unapproved; still require `admitCandidate` for admission

## Auth Verification Chain

### TypeScript Path

```
admitCandidate(candidateId, authorization)
  → strictGetItem(CANDIDATE_PREFIX + candidateId)
      → if !ok: return { status: 'rejected', reason: 'storage_unavailable' }
      → if !value: return { status: 'rejected', reason: 'candidate_not_found' }
  → JSON.parse(candidate)
      → if fail: return { status: 'rejected', reason: 'candidate_malformed' }
  → validate candidate fields
      → if invalid: return { status: 'rejected', reason: 'candidate_invalid' }
  → verifyCandidateAuthorization(authorization, candidate, trustConfig)
      → checks: keyId trusted, candidateId match, integrity match,
                issuedAt < now < expiresAt, Ed25519 signature valid
      → if !valid: return { status: 'rejected', reason: <specific_reason> }
  → integrityHash(candidate content)
      → if mismatch: return { status: 'rejected', reason: 'candidate_integrity_invalid' }
  → strictGetItem(RECORD_PREFIX + approvedId)
      → if exists and approved: return { status: 'already_admitted' }
  → saveRecordStrict(approved)
      → if !ok: return { status: 'rejected', reason: 'storage_unavailable' }
  → return { status: 'admitted', record: approved }
```

**Auth reasons** (from `corpusAdmissionAuth.ts`):
- `authorization_missing` — no authorization object provided
- `test_key_rejected_in_production` — RFC8032 test key used in production mode
- `untrusted_key` — keyId not in trusted keys map
- `candidate_id_mismatch` — authorization for different candidate
- `candidate_integrity_mismatch` — integrity hash doesn't match
- `invalid_authorization_window` — expiresAt <= issuedAt or unparseable
- `authorization_expired_or_not_yet_valid` — now outside [issuedAt, expiresAt)
- `invalid_signature_encoding` — pubkey not 32 bytes or signature not 64 bytes
- `signature_invalid` — Ed25519 verification failed
- `signature_verification_failed` — crypto operation threw

### Native Path

```
nexus_cli corpus admit <id>
  → constructs 8-field CORPUS_ADMIT payload:
      id, guardian_approved, reason_b64, key_id, issued_at, expires_at, signature_hex
  → writes to Unix socket (/tmp/nexus.sock)
  → nexusd receives and parses (tab-separated)

nexusd CORPUS_ADMIT handler:
  → if fields.size() == 4: return "error=unsigned_protocol_rejected"
  → if fields.size() != 8: return "error=malformed_protocol"
  → verify_admit_authorization(id, key_id, issued_at, expires_at, signature_hex)
      → key_id in TRUSTED_ADMIT_KEYS?
          → no: error="untrusted_key"
      → issued_at < expires_at and non-empty?
          → no: error="invalid_authorization_window"
      → hex_to_bytes(pubkey) == 32 bytes and hex_to_bytes(sig) == 64 bytes?
          → no: error="invalid_signature_encoding"
      → crypto_sign_verify_detached(sig, message, pubkey) == 0?
          → no: error="signature_invalid"
  → corpus.admit_candidate(id, guardian_approved, reason)
      → if record not LearningCandidate: return false
      → if integrity check fails or !guardian_approved: mark Rejected
      → else: mark VerifiedRecord
  → return "admitted=1" or "admitted=0"
```

## Storage Interactions

### TypeScript Path

| Step | Function | Key | On Failure |
|------|----------|-----|------------|
| Read candidate | `strictGetItem` | `candidate:{id}` | Return `storage_unavailable` |
| Check existing | `strictGetItem` | `record:knowledge-{integrity}` | Return `storage_unavailable` |
| Write approved | `strictSetItem` | `record:knowledge-{integrity}` | Return `storage_unavailable` |
| Read index | `strictGetItem` | `corpus:index` | Return `storage_unavailable` |
| Write index | `strictSetItem` | `corpus:index` | Return `storage_unavailable` |

**Key prefixes:**
- `CANDIDATE_PREFIX` = `"candidate:"` (unapproved candidates)
- `RECORD_PREFIX` = `"record:"` (approved records)
- `INDEX_KEY` = `"corpus:index"` (approved record IDs)
- `CANDIDATE_INDEX_KEY` = `"corpus:candidates"` (candidate IDs)

**Non-admission paths** still use `safe*` variants (silent failure OK):
- `appendInteraction` — raw interaction logging
- `readIndex`/`writeIndex` for non-critical reads
- UI state persistence

### Native Path

| Step | Storage | On Failure |
|------|---------|------------|
| Load corpus | `CorpusStore::load()` from file | Daemon fails to start |
| Admit candidate | `CorpusStore::admit_candidate()` → append to log file | Returns false, marked Rejected |

**Storage:** Append-only log file (default `/tmp/nexus-corpus.log`)

## Guardian Gate Insertion Point

### Where Guardian Fits

```
Operator/Agent requests admission
  → executeTool('corpus_admit', ...)
    → requiresCoSign('corpus_admit', posture)
        → 'autonomous': proceed (no approval)
        → 'operator-shell': check ALWAYS_COSIGN set
        → 'full-cosign': require approval
    → if requiresCoSign and !requestGuardianApproval():
        → return "[GUARDIAN BLOCK]"
    → CorpusRepository.admitCandidate(candidateId, authorization)
        → verifyCandidateAuthorization(...)  // Ed25519 check
        → strict storage operations
```

### Decision Tree

1. **Guardian check first:** Is `corpus_admit` in the co-sign set for current posture?
2. **If co-sign required:** Prompt operator. Denial → `[GUARDIAN BLOCK]`, no auth check.
3. **If approved or not required:** Proceed to Ed25519 verification.
4. **Ed25519 verification:** Cryptographic proof of authorization. Failure → `rejected`.
5. **Storage:** Persist with strict variants. Failure → `storage_unavailable`.

**Key insight:** Guardian approval and Ed25519 verification are independent layers.
- Guardian = "should this happen?" (policy)
- Ed25519 = "is this authorized?" (cryptography)
- Both must pass.

### Current Posture Behavior

| Posture | corpus_admit Co-sign? | Notes |
|---------|---------------------|-------|
| `autonomous` | No | Admits without prompting |
| `operator-shell` | Depends on ALWAYS_COSIGN | Check if `corpus_admit` is in set |
| `full-cosign` | Yes | Always prompts |

**TODO:** Verify `corpus_admit` is in `ALWAYS_COSIGN` set in `guardianGate.ts`. If not, add it.

## Failure Mode Table

| Failure | Where Detected | Return Value / Error | User Visible? |
|---------|---------------|---------------------|---------------|
| Unsigned native protocol | `nexusd.cpp` handler | `error=unsigned_protocol_rejected` | Daemon log, CLI stderr |
| Malformed protocol | `nexusd.cpp` handler | `error=malformed_protocol` | Daemon log, CLI stderr |
| Untrusted key (native) | `verify_admit_authorization` | `error=untrusted_key` | Daemon log, CLI stderr |
| Invalid signature (native) | `verify_admit_authorization` | `error=signature_invalid` | Daemon log, CLI stderr |
| Invalid auth window (native) | `verify_admit_authorization` | `error=invalid_authorization_window` | Daemon log, CLI stderr |
| Unauthorized (TS) | `verifyCandidateAuthorization` | `{ valid: false, reason: '...' }` | Returned to caller |
| Storage unavailable (TS read) | `admitCandidate` | `{ status: 'rejected', reason: 'storage_unavailable' }` | Returned to caller |
| Storage unavailable (TS write) | `saveRecordStrict` | `{ status: 'rejected', reason: 'storage_unavailable' }` | Returned to caller |
| Candidate not found | `admitCandidate` | `{ status: 'rejected', reason: 'candidate_not_found' }` | Returned to caller |
| Candidate malformed | `admitCandidate` | `{ status: 'rejected', reason: 'candidate_malformed' }` | Returned to caller |
| Integrity mismatch | `admitCandidate` | `{ status: 'rejected', reason: 'candidate_integrity_invalid' }` | Returned to caller |
| Guardian denied | `executeTool` | `"[GUARDIAN BLOCK]"` | Activity log, chat UI |
| Guardian approval timeout | `requestGuardianApproval` | Depends on UI | Chat UI |

## Native Daemon Path (Complete)

```
$ nexus_cli corpus admit <candidate-id> --reason "Approved"

1. nexus_cli.cpp:
   - Parse args: subcommand="admit", id=<id>, reason="Approved"
   - guardian_approved = true (no --deny flag)
   - Read FORGECLAW_ADMIT_SIG env for signature_hex
   - Read FORGECLAW_ADMIT_KEY_ID env for key_id (default: rfc8032-test-vector)
   - Construct payload:
     "CORPUS_ADMIT\t<id>\t1\t<base64(reason)>\t<key_id>\t<issued_at>\t<expires_at>\t<sig_hex>\n"
   - Connect to Unix socket (/tmp/nexus.sock)
   - Write payload, read response lines until "END"

2. nexusd.cpp (handler):
   - Split payload by '\t' → fields[]
   - Verify fields.size() == 8 (reject 4-field unsigned)
   - Extract: id, guardian_approved, reason_b64, key_id, issued_at, expires_at, sig_hex
   - verify_admit_authorization(...):
     - Lookup key_id in TRUSTED_ADMIT_KEYS
     - Validate timestamps
     - hex_to_bytes(pubkey), hex_to_bytes(signature)
     - sodium_init()
     - crypto_sign_verify_detached(sig, message, pubkey)
   - If valid: corpus.admit_candidate(id, true, base64_decode(reason_b64))
   - Return "CORPUS_ADMIT\tid=<id>\tadmitted=1\n" or error

3. corpus_store.cpp (admit_candidate):
   - Find record by id
   - Verify status == LearningCandidate
   - Verify content_sha256 == sha256(content)
   - If !guardian_approved or integrity fail: mark Rejected
   - Else: mark VerifiedRecord, append event to log

4. Response to CLI:
   - "OK\tCORPUS_ADMIT\tid=<id>\tadmitted=1\n"
   - "END\n"
   - CLI prints result, exits 0
```

## Open Questions

1. **Guardian set membership:** Is `corpus_admit` in `ALWAYS_COSIGN`? Verify in `guardianGate.ts`.
2. **Production keys:** How are trusted Ed25519 keys configured in production? (Currently hardcoded test key.)
3. **Timestamp validation:** Native side has TODO for ISO 8601 parsing. TS side uses `Date.parse()`.
4. **Canonical payload:** Native side uses simplified `id|key_id|issued_at|expires_at`. TS side uses full JCS. These must match for cross-verification.
5. **Webhook path:** Does `handleWebhookCandidate` exist? If so, document its auth flow.
