# Evidence bundle — swarm-exam-v1

Versioned, hash-pinned evidence for the Nexus Trader swarm active-watcher exam freeze
(owner directive 2026-11-05 23:42 CST) and the Manus dwindle package (owner directive
2026-11-05 23:52 CST). Assembled by Muse, 2026-11-06 ~00:10 CST, in answer to the
blocker posted on forgeclaw issue #235 (comment 6678185292): the point-in-time inputs
live on the Muse VM and in D1, not in any repo — this bundle is that evidence, exported
and pinned.

## Snapshot discipline

- D1 exports are point-in-time reads of the LIVE ledger (database nexus-bank-ledger),
  taken 2026-11-06 00:07–00:11 CST. The successor mandate
  `m-1793933247355-9af0577d` was live and trading during the export; rows are
  timestamped, and the exam should cut its windows at a stated timestamp.
- `trigger_watch.log`, `book_polls.jsonl`, `shadow_band_log.jsonl` are file snapshots
  copied at 00:08 CST; the live files keep growing on the VM.
- Verify every file against `MANIFEST.sha256` before use.

## Contents

D1 exports (one JSON object per line, keys sorted):
- `d1_mandates.jsonl` — 19 mandates, all eras.
- `d1_order_intents.jsonl` — 842 intents (entries, exits, fills, fees_micros; fees in
  cents = fees_micros / 10000; prices are YES-leg micros — a NO position's price is
  10000 − avg_yes_price_micros/10000 in cents terms: NO price ¢ = 100 − avg_yes ¢).
- `d1_settlements.jsonl` — 40 settlements.
- `d1_shadow_candidates.jsonl` — 917 shadow candidate rows (the population the
  613-candidate grade drew from: 612 gradeable per the regime-gating milestone report,
  delta explained there).
- `d1_windows.jsonl` — 791 window rows.
- `d1_canary_adaptations.jsonl` — 19 rows (streak/cap adaptation record).
- `d1_decisions_exam_windows.jsonl` — 48,037 decision ticks, sliced to the 322 tickers
  that appear in order_intents or shadow_candidates. Cut from a full export of the live
  decisions table (113,553 rows at export time); the full table stays the source of
  truth on the VM and keeps growing — the slice is the pinned exam input.

Watch-side tape (VM files):
- `trigger_watch.log` — the watch's decision log (formations, triggers, exits, R2).
- `book_polls.jsonl` — tick-level book recording for in-position polls (2026-11-04 ship).
- `shadow_band_log.jsonl` — the 5–7 band shadow log.
- NOT YET PRESENT: `post_exit_ticks.jsonl` (post-exit recorder, built 2026-11-05
  23:47 CST) — the file begins accumulating at the next watch start after that build;
  no exited window has recorded under it yet. It joins bundle v2 when rows exist.

Regime/MC machinery (regime2_work, the rebuilt replay engine's data):
- `shadow_rows.json`, `graded_with_features.json`, `frozen20_graded.json`,
  `decisions_frozen.json`, `markets_frozen.json`.

Grade lineage (the verdicts the exam and the filters grade against):
- `b-grade-so5.md` — the SO#5 B-grade (A vetoed, B n=1, slippage footing by basis).
- `monte-carlo-canonical.md` — MC conventions + staleness rule.
- `regime-gating-milestone.md` — the 613/612 shadow-population grade and its anchors.

## Freeze rule (standing law)

The exam freezes from THIS bundle: replay windows are cut from these files, the
held-out set is named in the freeze record, and no row in the frozen exam may enter
any training set. If the evidence here is insufficient for a freeze, name the missing
input exactly — do not approximate it from summaries.
