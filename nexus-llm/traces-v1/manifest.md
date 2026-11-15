# traces-v1 — manifest

Built 2026-10-31T05:58:10Z by `build_traces_v1.py` (in this directory; re-runnable, deterministic apart from shaped_at). Design law: trace-shaper-design.md (one trace per graded episode, provenance sidecar §3.2 embedded in-row under `provenance`, classes labeled honestly). **No training was launched.** Local files only.

## Files
- `tool-use-v1.jsonl` — **40 traces** (wc-verified line count after write)
- `context-v1.jsonl` — **6 traces** (wc-verified line count after write)
- `shell-census.md` — the Part 1 census
- `build_traces_v1.py` — the shaper that produced all three

## Real / synthetic split
- Real (`synthetic: false`, provenance `label: "real"`): **46 of 46 traces (100%)**. Synthetic traces in these files: **0**. Nothing synthetic is passed off as real; no trace in either file is Guardian-eligible unless its evidence token is `<|ev:verified|>` (see counts below), per the standing rule that only the verified subset can be Guardian data.

## Composition and provenance by class

| File | Kind | Traces | Source corpus | Provenance (source / ref) |
|---|---|---|---|---|
| tool-use-v1.jsonl | verify_claim_real | 35 | fallacy-audit LEDGER.md §1/§2 (F-002..F-039 minus exclusions) | source `fallacy-audit`, ref `LEDGER.md F-0xx`, check = claim -> artifact -> verdict |
| tool-use-v1.jsonl | grade_report_real | 4 | fleet/watcher-proving.json grades 6-9 | source `fleet-watcher`, ref `watcher-proving.json grades[n]` |
| tool-use-v1.jsonl | route_live_data_real | 1 | tonight's live-search incident: intake lines 545-546 + the full-stack trace vs the Actions API | source `fallacy-audit`, ref `github actions run 41173397044` |
| context-v1.jsonl | context_state_real | 4 | fleet/watcher-proving.json Reports 6-9 (the Report 6 stale-local-file failure + Reports 7-9 corrections on the same surfaces) | source `fleet-watcher` |
| context-v1.jsonl | context_bleed_real | 2 | PR #337 corpus context-bleed incident + its fix (forgeclaw main f81aad448ae5) | sources `owner-report` / `fallacy-audit` |

Verdict split inside verify_claim_real: {'CONFIRMED': 33, 'DENIED': 1, 'CANDIDATE': 1} (the DENIED and CANDIDATE traces are deliberate: a denied claim and an unasserted candidate teach that verification can come back "no" or "not yet").

Guardian-eligible (evidence token `<|ev:verified|>`): tool-use 24, context 4. All other traces are ordinary corpus, not Guardian data.

## Leakage control (hard ban — no frozen-exam item in training)

Frozen sets loaded before shaping: 27 files (eval v1 + domains-v1 + CAPBENCH v1.1 + heldout + affect + UNRESTRICTION v1 + heldout, frozen-prompts.ts, coding/ and loop/ assets, Watcher-Q fixtures, Curator fixtures, trading frozen-set-v1). Checks per trace: (1) normalized prompt match against every frozen prompt; (2) ticker match against the trading benchmark; (3) 48-char normalized shingle overlap between the trace's fact-carrying content (prompt + result blocks + answer block) and the frozen content (fixture/trading files shingled whole; eval suites shingled on each item's prompt + expected-call/answer string values). The `<|call|>` transcript header is excluded from the shingle check on both sides: it is the grammar scaffolding every run-9 training row and every eval gold share by design — the ban protects exam content, not the shared format. (An earlier whole-text version of this check dropped 14 traces purely on the shared `github_read_file` call header; the calibration and its reason are recorded here rather than silently loosened — the content check still runs at full strength on everything that carries facts.)

**Total leakage drops: 13**
- `fallacy:F-001` — frozen_item_identity:curator-fixtures CU-01 candidate is this finding's intake record
- `fallacy:F-008` — frozen_item_identity:curator-fixtures CU-15 candidate is this finding's record with the ref mutated to F-099 (near-duplicate of a frozen item)
- `fallacy:F-037` — frozen_item_identity:curator-fixtures CU-09..CU-13 candidates are the five intake records this finding is about
- `fallacy:F-038` — frozen_item_identity:curator-fixtures CU-03/CU-14 candidate ref m-1793294098053-1ddd3534 is this finding's subject record
- `watcher-grading-episode:report-1` — frozen_item_identity:watcher-q-fixtures WQ-01..WQ-12 source Reports 1-5
- `watcher-grading-episode:report-2` — frozen_item_identity:watcher-q-fixtures WQ-01..WQ-12 source Reports 1-5
- `watcher-grading-episode:report-3` — frozen_item_identity:watcher-q-fixtures WQ-01..WQ-12 source Reports 1-5
- `watcher-grading-episode:report-4` — frozen_item_identity:watcher-q-fixtures WQ-01..WQ-12 source Reports 1-5
- `watcher-grading-episode:report-5` — frozen_item_identity:watcher-q-fixtures WQ-01..WQ-12 source Reports 1-5
- `watcher-context-episode:report-2` — frozen_item_identity:watcher-q-fixtures WQ-01..WQ-12 source Reports 1-5
- `watcher-context-episode:report-3` — frozen_item_identity:watcher-q-fixtures WQ-01..WQ-12 source Reports 1-5
- `watcher-context-episode:report-4` — frozen_item_identity:watcher-q-fixtures WQ-01..WQ-12 source Reports 1-5
- `watcher-context-episode:report-5` — frozen_item_identity:watcher-q-fixtures WQ-01..WQ-12 source Reports 1-5

Notes on the big ones: the Watcher-Q exam (WQ-01..WQ-12) is built from Watcher Reports 1-5, so the Report 2 stale-head failure and the Reports 3-5 corrections — the pair the program §4.4 names first — are exam material and are excluded; the Report 6 failure + Reports 7-9 corrections carry the same lesson from episodes no exam touches. The Curator exam is built from real intake lines, which excludes F-001, F-008 (via its F-099 mutation), F-037 and F-038 by identity.

## Disclosed overlaps and limits
- The four Watcher episodes (Reports 6-9) appear in BOTH files, shaped for different skills (grading a report vs discriminating stale-vs-current state). Disclosed here rather than hidden in the counts: unique episodes = 42.
- Fallacy traces render the ledger's verdicts from its own recorded evidence (`value_source: prose` in every sidecar): the ledger is the graded record of checks that were actually run (headless runs, API read-backs, live fetches), and the traces quote its deciding facts without inventing command output beyond what the ledger states.
- F-017 has no §1/§2 table row; it lives in the ledger's pass prose (Pass 13/14). Its trace is shaped from that text and its sidecar says so via ref `LEDGER.md F-017`.
- The intake file is live (it grew from 546 to 548 lines during this build as jobs appended records). Census numbers are the count at build time; the two live-search records (lines 545-546) are stable and are the routing trace's source.
- Watcher Report 10 had run (and its grade landed during this build — the proving file now holds 10 grades); traces use Reports 6-9 only, the graded set that existed as a stable record when shaping began.
