# Phase B — Invariant Log

This log records each Phase B invariant as it is implemented and
committed. Order is the frozen sequence.

---

## Invariant 1 — guardian-replacement

- Test: `tests/foundation/guardian-replacement.test.ts`
- Implementation: `foundation/guardian/replacement.ts`
- Commit: 95b550a
- Invariant: Guardian replacement cannot execute without an
  authorized procedure originating from `foundation/codex/`.
- Verification: 1 passed | 11 failed after commit.

---

## Invariant 2 — tool-side-effect

- Test: `tests/foundation/tool-side-effect.test.ts`
- Implementation: `foundation/contracts/toolSideEffectBoundary.ts`
- Commit: 52116a9
- Invariant: A tool cannot cause a side effect outside the controlled
  dispatcher.
- Note: Initial GPT output inverted the assertion. Corrected on
  second iteration.
- Verification: 2 passed | 10 failed after commit.

---

## Invariant 3 — provider-egress

- Test: `tests/foundation/provider-egress.test.ts`
- Implementation: `foundation/contracts/providerEgressBoundary.ts`
- Commit: 94c2d82
- Invariant: Provider network calls are Guardian-gated.
- Verification: 3 passed | 9 failed after commit.

---

## Invariant 4 — evidence-schema

- Test: `tests/foundation/evidence-schema.test.ts`
- Implementation: `foundation/evidence/record.ts`
- Commit: 8bccc8c
- Invariant: VERIFIED requires a matching evidence record.
- Verification: 4 passed | 8 failed after commit.

---

## Invariant 5 — ground-truth-provenance

- Test: `tests/foundation/ground-truth-provenance.test.ts`
- Implementation: `foundation/evidence/provenance.ts`
- Commit: 354d94c
- Invariant: Unauthenticated feedback cannot train or replace
  Guardian.
- Verification: 5 passed | 7 failed after commit.

---

## Invariant 6 — corpus-admission

- Test: `tests/foundation/corpus-admission.test.ts`
- Implementation: `foundation/guardian/corpusAdmission.ts`
- Commit: bb8a512
- Invariant: Guardian-originated material cannot evaluate Guardian.
- Verification: 6 passed | 6 failed after commit.

---

## Invariant 7 — self-editing-prohibition

- Test: `tests/foundation/self-editing-prohibition.test.ts`
- Implementation: `foundation/guardian/selfEditProhibition.ts`
- Commit: 5c384a7
- Invariant: A self-edit targeting `foundation/codex/` returns a
  Guardian block.
- Verification: 7 passed | 5 failed after commit.

---

## Invariant 8 — concurrency-ownership

- Test: `tests/foundation/concurrency-ownership.test.ts`
- Implementation: `foundation/runtime/taskOwnership.ts`
- Commit: PENDING
- Invariant: Two runs cannot simultaneously own the same task.
- Verification: PENDING
- Note: First invariant to introduce mutable runtime state.

---
