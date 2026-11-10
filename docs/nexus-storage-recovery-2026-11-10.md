# NEXUS storage recovery — 2026-11-10

## Failure

ForgeClaw reported:

```text
[TOOL ERROR] NEXUS storage is full and nothing older could be removed to make room
```

The failure occurred when the browser-local corpus contained approved NEXUS knowledge. Quota recovery only considered unapproved candidates. An approved intake record consisted of three persisted pieces: the raw interaction, an approved candidate retained for provenance/UI, and the approved knowledge record. The raw interaction duplicated the knowledge content but was classified as protected because its candidate was approved, so no reclaimable space was found.

## Fix

`CorpusRepository.pruneUnapproved()` now reclaims storage in this order:

1. Remove the oldest unapproved candidate and its raw interaction, as before.
2. For an approved candidate, remove only its redundant raw interaction while retaining the approved candidate and knowledge record.
3. If a later retry still needs space and no unapproved entry can help, remove the approved candidate metadata while retaining the knowledge record itself. This last step is deferred until the complete candidate list has been considered, so normal unapproved churn preserves approved provenance in the UI.

The knowledge index and candidate index are rewritten after pruning, and the approved knowledge record is never evicted by quota recovery.

## Regression coverage

`src/lib/corpusStorage.test.ts` now verifies that with a constrained 12,000-character browser storage:

- two approved intake records can be written;
- both approved knowledge records remain retrievable and count toward the approved total; and
- a subsequent learning event records successfully instead of returning a false failure.

The existing test that protects approved knowledge and the broader corpus/NEXUS suites remain green.

## Verification

- Focused storage suite: **6 passed**.
- Corpus/NEXUS suites: **109 passed** across 4 files.
- Production build: **passed**.
- ESLint: **0 errors, 2 pre-existing warnings in `src/App.tsx`**.
- Full suite: **2,650 passed, 12 skipped, 1 unrelated pre-existing failure** in `src/scripts/mirofishRunner.test.ts`; its fixture reports that the CPU torch wheel lacks the required 64-hex SHA-256 pin. That failure is independent of this storage change.
