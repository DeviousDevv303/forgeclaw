# CORPUS Admission Gaps — Implementation Spec

**For:** Manus (implementation) → Muse (review)
**Branch:** `feat/corpus-admission-boundary-20261013` (auth schema base)
**Date:** 2026-10-13

## Context

The Ed25519 auth schema (`src/lib/corpusAdmissionAuth.ts`) is complete on the feature branch. Three gaps prevent trustworthy admission. This spec defines exact changes for each.

---

## Gap 1: Native CLI Enforcement

### Problem

The C++ native CLI bypasses the Ed25519 auth schema entirely.

**Current protocol** (`nexus/native/src/nexus_cli.cpp:90`):
```
CORPUS_ADMIT\t<id>\t<guardian_approved: 0|1>\t<reason>
```

**Current verification** (`nexus/native/src/nexusd.cpp:120`):
```cpp
if (fields[0] == "CORPUS_ADMIT" && fields.size() == 4u) {
    // ... admits based on guardian_approved flag only
    // NO signature verification
}
```

Any process that can write to the daemon socket can admit candidates with `guardian_approved=1` and no cryptographic proof.

### Required Change

Extend the protocol to carry Ed25519 signature material. The daemon must verify before admitting.

**New protocol:**
```
CORPUS_ADMIT\t<id>\t<guardian_approved: 0|1>\t<reason>\t<key_id>\t<issued_at>\t<expires_at>\t<signature_hex>
```

Field definitions:
- `id`: candidate ID (existing)
- `guardian_approved`: 0|1 (existing, retained for backward-compat logging)
- `reason`: human-readable reason (existing)
- `key_id`: Ed25519 key identifier (new) — must match a trusted key
- `issued_at`: ISO 8601 timestamp (new) — authorization issue time
- `expires_at`: ISO 8601 timestamp (new) — authorization expiry, must be > issued_at and > now
- `signature_hex`: hex-encoded Ed25519 signature (new) — signs the canonical payload

**Canonical payload** (must match `authorizationPayload()` in `corpusAdmissionAuth.ts`):
```
JSON canonicalization (RFC 8785/JCS) of:
{
  "candidateId": "<id>",
  "candidateIntegrity": "<sha256 of candidate content>",
  "expiresAt": "<expires_at>",
  "issuedAt": "<issued_at>",
  "keyId": "<key_id>",
  "purpose": "forgeclaw.corpus.admit.v1"
}
```
Keys sorted lexicographically. No whitespace.

**Verification point:** `nexusd.cpp`, in the `CORPUS_ADMIT` handler, before `admit_candidate` is called:
1. Parse all 8 fields (reject if != 8 fields)
2. Look up `key_id` in daemon's trusted keys config
3. Verify `issued_at` < now < `expires_at`
4. Compute candidate integrity hash (must match stored candidate)
5. Verify Ed25519 signature using libsodium (`crypto_sign_verify_detached`)
6. Only then call `admit_candidate`

**Backward compatibility:** If only 4 fields are present (old protocol), reject with `CORPUS_ADMIT\terror=unsigned_protocol_rejected`. Do not fall back to unsigned admission.

### Files to Modify

| File | Change |
|------|--------|
| `nexus/native/src/nexus_cli.cpp` | Extend `CORPUS_ADMIT` payload construction to include key_id, issued_at, expires_at, signature_hex. CLI must obtain signature from operator (via env var `FORGECLAW_ADMIT_KEY` or prompt). |
| `nexus/native/src/nexusd.cpp` | Add Ed25519 verification in `CORPUS_ADMIT` handler before `admit_candidate`. Link libsodium. Reject unsigned (4-field) protocol. |
| `nexus/native/src/corpus_selftest.cpp` | Add tests for signed/unsigned paths (see below). |

### Test Requirements

In `corpus_selftest.cpp`:
1. **Signed valid:** Construct a valid 8-field `CORPUS_ADMIT` with correct signature → assert admitted.
2. **Signed invalid signature:** Tamper with signature → assert rejected with `signature_invalid`.
3. **Unsigned (old protocol):** Send 4-field `CORPUS_ADMIT` → assert rejected with `unsigned_protocol_rejected`.
4. **Expired authorization:** `expires_at` in the past → assert rejected.
5. **Untrusted key:** `key_id` not in trusted set → assert rejected.

Use the RFC 8032 test vector key for test mode (matches `RFC8032_TEST_KEY_ID` in the TS schema).

### Acceptance Criteria

- [ ] `nexusd` rejects all unsigned `CORPUS_ADMIT` messages
- [ ] `nexusd` verifies Ed25519 signatures before admitting
- [ ] `nexus_cli` sends signed protocol by default
- [ ] All 5 selftest cases pass
- [ ] No unsigned admission path remains

---

## Gap 2: Persistence-Failure Tests

### Problem

`src/lib/storage.ts` silently swallows all localStorage errors:

```typescript
export function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Silently fail on mobile private mode
  }
}
```

When storage fails (private mode, quota exceeded, disabled), `admitCandidate()` in `corpus.ts` cannot distinguish "candidate not found" from "storage unavailable." Both return `null`. This masks data loss.

### Required Change

Add strict variants that surface errors. Update `admitCandidate`/`rejectCandidate` to use them and propagate failure explicitly.

**New functions in `src/lib/storage.ts`:**

```typescript
export interface StorageResult<T> {
  ok: boolean
  value?: T
  error?: string
}

export function strictGetItem(key: string): StorageResult<string | null> {
  try {
    return { ok: true, value: localStorage.getItem(key) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'storage_read_failed' }
  }
}

export function strictSetItem(key: string, value: string): StorageResult<void> {
  try {
    localStorage.setItem(key, value)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'storage_write_failed' }
  }
}

export function strictRemoveItem(key: string): StorageResult<void> {
  try {
    localStorage.removeItem(key)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'storage_delete_failed' }
  }
}
```

**Update `corpus.ts`:**

`admitCandidate(candidateId)`:
- Replace `safeGetItem` with `strictGetItem`
- If `!result.ok`: return `{ status: 'rejected', reason: 'storage_unavailable', detail: result.error }` (or throw `StorageUnavailableError` — Manus to choose, must be documented)
- If `result.ok` but `value` is null: return `null` (candidate not found, existing behavior)

`rejectCandidate(candidateId)` (if exists, else add):
- Same strict pattern for the removal

**Do not change** existing `safeGetItem`/`safeSetItem`/`safeRemoveItem` — they are used elsewhere for non-critical paths. Only the admission path needs strict handling.

### Files to Modify

| File | Change |
|------|--------|
| `src/lib/storage.ts` | Add `StorageResult<T>`, `strictGetItem`, `strictSetItem`, `strictRemoveItem` |
| `src/lib/corpus.ts` | Update `admitCandidate` (and `rejectCandidate` if exists) to use strict variants |
| `src/lib/corpus.test.ts` | Add persistence-failure tests (see below) |

### Test Requirements

In `src/lib/corpus.test.ts`:

1. **Storage write failure on admit:** Mock `localStorage.setItem` to throw `QuotaExceededError`. Call `admitCandidate` with a valid candidate. Assert result indicates `storage_unavailable` (not silent null).
2. **Storage read failure on admit:** Mock `localStorage.getItem` to throw. Call `admitCandidate`. Assert `storage_unavailable`.
3. **Normal path unaffected:** Without mocks, `admitCandidate` works as before (existing tests must pass).
4. **Safe variants unchanged:** `safeSetItem` still swallows errors (no regression).

Mock approach:
```typescript
const originalSetItem = Storage.prototype.setItem
beforeEach(() => { /* setup */ })
afterEach(() => { Storage.prototype.setItem = originalSetItem })
it('surfaces storage failure on admit', () => {
  Storage.prototype.setItem = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError') }
  // ... assert
})
```

### Acceptance Criteria

- [ ] `strictGetItem`/`strictSetItem`/`strictRemoveItem` return `{ ok, value?, error? }`
- [ ] `admitCandidate` returns explicit `storage_unavailable` on storage failure
- [ ] `admitCandidate` still returns `null` for genuinely missing candidates
- [ ] All 4 new tests pass
- [ ] All existing corpus tests pass (no regression)
- [ ] `safe*` functions unchanged

---

## Gap 3: Route Map

### Problem

No documentation exists for the CORPUS admission flow. A new contributor (or auditor) cannot trace how a candidate goes from creation to admission, where auth is verified, or where the Guardian gate sits.

### Required Change

Create `docs/corpus-admission-route-map.md` documenting the complete flow.

### Required Contents

**1. Entry Points** — Every way a candidate can enter the system:
- `corpus.ts` → `proposeCandidate()` (browser/TS path)
- `nexus_cli.cpp` → `CORPUS_ADMIT` (native CLI path)
- Any other callers of `admitCandidate`

**2. Auth Verification Chain** — Step-by-step for each entry point:
- TS path: Where is `verifyCandidateAuthorization()` called? What happens on failure? (List each `reason` code and its handling)
- Native path: Where in `nexusd.cpp` is the signature verified? What libsodium function? What happens on each failure mode?

**3. Storage Interactions** — For each step:
- Which storage function is called (`safe*` vs `strict*`)?
- What key prefix? (`CANDIDATE_PREFIX`, `INDEX_KEY`, etc.)
- What happens on storage failure at each point?

**4. Native Daemon Path** — Complete flow:
- `nexus_cli.cpp` constructs `CORPUS_ADMIT` → socket → `nexusd.cpp` parses → verifies signature → calls `admit_candidate` → writes to daemon storage → returns result
- Include the socket protocol details

**5. Guardian Gate Insertion Point** — Precisely where Guardian co-sign fits:
- Does Guardian approval happen before or after Ed25519 verification?
- In `operator-shell` posture, is `admitCandidate` gated? (Currently: check `requiresCoSign` — is `corpus_admit` in the co-sign set?)
- Diagram the decision tree: `requiresCoSign` → `requestGuardianApproval` → `verifyCandidateAuthorization` → `strictSetItem`

**6. Failure Mode Table:**

| Failure | Where Detected | Return Value / Error | User Visible? |
|---------|---------------|---------------------|---------------|
| Unsigned native protocol | `nexusd.cpp` | `unsigned_protocol_rejected` | Daemon log |
| Invalid signature | `verifyCandidateAuthorization` | `{ valid: false, reason: 'signature_invalid' }` | ? |
| Storage unavailable | `admitCandidate` | `{ status: 'rejected', reason: 'storage_unavailable' }` | ? |
| Candidate not found | `admitCandidate` | `null` | ? |
| Integrity mismatch | `admitCandidate` | `null` | ? |
| Guardian denied | `executeTool` | `[GUARDIAN BLOCK]` | Activity log |

(Manus to fill in the "User Visible?" column based on actual code.)

### Files to Create

| File | Contents |
|------|----------|
| `docs/corpus-admission-route-map.md` | All sections above |

### Acceptance Criteria

- [ ] All entry points documented
- [ ] Auth chain traced for both TS and native paths
- [ ] Storage interactions listed with function names and key prefixes
- [ ] Guardian gate position explicitly stated
- [ ] Failure mode table complete with all 6+ rows
- [ ] A new contributor can follow the doc to understand the flow without reading code

---

## Implementation Order

1. **Gap 2 first** (storage) — smallest, no dependencies, unblocks testing
2. **Gap 1 second** (native CLI) — requires libsodium, larger change
3. **Gap 3 last** (route map) — documents the final state of Gaps 1+2

## Branch Strategy

Implement on `feat/corpus-admission-boundary-20261013` (the auth schema branch). Do not merge to main until all three gaps are complete and reviewed.

## Review

Muse reviews the PR. Focus areas:
- Ed25519 verification correctness (constant-time compare, proper key handling)
- No unsigned bypass paths
- Storage failure modes are explicit, not silent
- Route map matches actual code (not aspirational)
