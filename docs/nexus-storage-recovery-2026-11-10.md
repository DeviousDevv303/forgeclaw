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

## Follow-on image failure — 2026-11-12

The owner reported that an explicit image request waited about 11 minutes and then ended with the same storage-full error. The image path had already dispatched `generate-image.yml`, downloaded the PNG, and registered it for the chat UI. It then awaited `appendImageGenerationLearning()`. When local browser storage could not accept that optional learning record, the exception escaped the image tool and ForgeClaw marked the entire tool call failed, discarding the successful image result from the visible turn.

The image generator and its artifact path were working; the failure was coupling non-critical learning persistence to successful delivery. `generate_image` now catches that persistence error and returns the generated image as a success, with a separate `[NEXUS LEARNING WARNING]` that preserves the storage reason. For a router-issued image, the chat UI surfaces that warning next to the image. The corpus does not evict approved knowledge to make room, and image delivery no longer depends on weakening that preservation rule.

The same debug session confirmed a separate shell-command failure: `git clone https://github.com/DeviousDevv303/forgeclaw.git` ran inside the GitHub Actions checkout, where the default `forgeclaw` clone destination already existed. The shell tool now appends targeted guidance for this exact collision; it still reports the command as failed and never claims a clone succeeded.

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
