# Corpus IndexedDB Migration — SPEC (owner-approved 2026-11-15 23:14 CST)

## Owner's intent
Keep the corpus. Feed it as much as we want. The corpus must stop throwing learning away because of a browser storage wall.

## Current state (verified from the record)
- Corpus persistence lives in browser `localStorage`: one key per record under the corpus's own keys.
- The origin's ~5M-character localStorage quota is shared with settings, the GitHub token, and chat history.
- Owner ruling 2026-11-12 (PR #420): corpus budget `MAX_CORPUS_STORAGE_CHARS = 4,000,000`; room-making ladder = prune unapproved first, then evict oldest records (raw interactions before the knowledge they produced); the record being written never evicts itself.
- Prompt selection is a separate concern and does NOT change: newest-500 scan, caps 12 rules / 4 lessons (owner decision 2026-11-15).

## The change
Migrate corpus persistence from localStorage to **IndexedDB** (quota: hundreds of MB), as a storage-backend swap behind the existing corpus API. No admission, schema, or prompt-selection behavior changes.

### Requirements
1. **Backend swap, same contract.** All corpus reads/writes go through an async IndexedDB layer with the same record schema and the same public functions' semantics. Callers that assume synchronous localStorage access must be audited and converted — list every caller touched.
2. **One-time migration.** On first run after deploy: read every legacy localStorage corpus key, write all records to IndexedDB, verify record count and total bytes match, and only then remove the legacy keys (reclaiming the shared localStorage wall for settings/token/chat). If verification fails, keep the legacy store intact and surface the failure on the Nexus tab — never a silent partial move.
3. **Eviction retires to last resort.** With IndexedDB headroom, the 4M-char budget no longer governs. Replace it with an IndexedDB-scale budget (propose the number in the PR, with the quota math shown); the ladder (unapproved → oldest raw → oldest knowledge; never the record being written) survives only as the last-resort path under that budget.
4. **Export / Wipe keep working.** The Nexus tab's EXPORT and WIPE act on the IndexedDB store; export format stays byte-compatible with today's export so existing exports remain importable.
5. **Tab truthfulness.** Any Nexus tab display that references storage (counts, budgets, "in this browser") must reflect the new backend. Coordinate with the Nexus tab audit findings (Muse's audit, 2026-11-15) — do not reintroduce a display the audit flags.
6. **Tests.** Port/extend `corpus.test.ts` + `corpusStorage.test.ts` to the new backend (fake-indexeddb or the repo's existing test double, per repo convention); add a migration test over a populated legacy store including the verification-failure path. Full gate at ship: `tsc -b`, full vitest, eslint, build — report full-suite numbers, not a subset.
7. **Ship discipline.** Branch → PR with a claim→diff map → green gate + live head re-verified in the same breath → merge → Pages deploy in the same pass (keep-main-current law). Post the PR and the merge on #235.

## Out of scope
- Prompt-selection changes (newest-500 stands).
- Admission-policy changes (auto-admit of verified #235 pairs is its own ruling, 2026-11-15, and consumes this storage — it is a beneficiary, not part of this build).
- Server-side corpus storage (a later option; IndexedDB is the structural fix for this client).

## Why now
The #235 auto-admit ruling (2026-11-15) means corpus inflow grows by design. Running an ever-growing corpus against a 4M-char eviction budget guarantees the oldest verified learning is exactly what gets thrown away. Storage first, then inflow.
