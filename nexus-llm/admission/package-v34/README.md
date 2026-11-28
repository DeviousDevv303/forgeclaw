# Run 36 admission checks — v3.4.0 (candidate)

**Label: v3.4 CANDIDATE — C1–C6 and C9 active; C7/C8/C10 blocked. This
candidate supersedes nothing; supersession follows independent package
verification, never precedes it. Verification targets are named by digest,
not version label: the newest posted digest-set is the target (v3.1 is
REJECTED on token grounds — amendment, #235 comment 7230645402).** Route C:
this tool never prints ADMIT and never exits 0; admission is a gate-5 seat
decision. C10 stays BLOCKED — the canonical 11-check text does not exist yet
(object-verified: #235 comment 7230201506); the constitution step (Muse's
assembly proposal, owner-decides) gives C10 its byte-compare target.

## v3 delta (GPT Run-36 audit)
- Item 1 CONCEDED IN FULL: the record reads 640 = model context, 630 =
  admission row limit — distinct quantities v2 conflated. The ceiling is now
  the hard constant `ROW_TOKEN_CEILING = 630`; no CLI flag can dilute it, and
  a manifest declaring any other ceiling FAILs C3 (harness T9a/T9b/T10).
- Items 2-5 retained from v2 (allowlist-absent BLOCKs; tokenizer
  implementation+version+KAT verified; spawn counts normalized so string "1"
  cannot evade C9; duplicate IDs and malformed row/manifest schemas rejected).
- Item 6 preserved: C10 BLOCKED. C7/C8 are also BLOCKED — their mechanical
  definitions were not byte-available to this build session and are not
  reconstructed from memory.

## v3.1 delta (self-found defect, disclosed)
v3's C9 was tier-blind and rejected `spawn_count` 0 — the canonical RESTRAINT
boundary. Verified on the object at `dcfcadd5`: frozen benchmark rows
sw-001..sw-005 (`eval-swarm.jsonl`, sha256 `e5ba5013…4adb` — independently
recomputed by this lane from the raw bytes) expect zero spawns and
`swarm_grade.py` hard-fails any observed spawn on them; per #235 comment
7230313007 the pilot's restraint rows must match that form and boundary.
C9 is now tier-aware (restraint MUST be zero; justification cannot rescue a
spawning restraint row) and accepts the grader's `{min,max}` range form
(a restraint range must cap at 0). Harness T13–T15 pin the boundary.

## v3.2 delta (GPT findings 1–3, answered on the object)
- **Tokenizer corrected (finding 3).** The trainer counts rows with
  SentencePiece `nexus.model` v1 (vocab 4,000), not cl100k. Measured on the
  fixture rows: nexus counts run +9..+29 (mean +20) vs cl100k on identical
  text — cl100k counting would misplace the 630 boundary. This candidate ships
  the canonical tokenizer bytes (`fixtures/nexus.model`, sha256
  `323458df…b935a`, attested on #235 comments 7230139327 + 7174989158) and
  hash-verifies them like the allowlist. Both sentencepiece and tiktoken
  loaders are supported and harness-tested (T17/T18).
- **KAT circularity bounded (finding 2).** The external anchor is the pinned
  tokenizer file hash (three independent on-object attestations); the KAT
  guards loader/version drift against those bytes.
- **Ceiling provenance restated (finding 1).** 640 = model context is
  object-verified (incl. truncation audit, comment 7230139327: rows >640
  dropped whole). 630 as the admission row limit is NOT stated on #235;
  provenance is GPT's audit + Muse's record-reading, consistent with the
  audit's "13 rows at 630+" tail band. The constant stays enforced at 630
  with that provenance, pending the canonical-text constitution.
- Full #235 pull this session: 1,518 comments via API. The truncation audit
  (7230139327) and restraint-boundary post (7230313007) are object-verified;
  the canonical 11-check text does not exist (7230201506); no branch is
  prepared or authorized.

## v3.3 delta (GPT consolidated adjudication — tier authority + rejection table)
- **Tier authority moved to the manifest (the highest-priority finding).**
  v3.x read the tier from the row being checked — a row could steer its own
  C9 rule. Now `manifest.tiers` (`{row_id: tier}`, inside the hash-pinned,
  seat-controlled manifest) is the sole authority: every row id must be
  classified (unclassified → C4 FAIL closed), stale classifications fail,
  a row-declared tier conflicting with the manifest fails (C4) and C6/C9
  refuse to run on untrusted classification (BLOCKED). The grader's own
  restraint authority (frozen eval IDs sw-001..005) stays separate and
  preserved — eval-side classification by ID set, pilot-side by manifest.
- **Enforcement, not just normalization:** a non-restraint row at zero
  spawns FAILs (classification lie); negative counts are invalid in every
  tier (normalization rejects them outright).
- **GPT's full rejection table is harness-pinned:** T19 restraint {0,1}→FAIL;
  T20 multi-spawn at 0→FAIL; T21 negatives in both classes→FAIL; T22
  self-mislabeled tier→C4 FAIL + C9 BLOCKED; T23 unclassified row→FAIL
  closed; T24 stale classification→FAIL closed; T25 rows with no tier field
  at all still PASS (manifest alone governs). 25/25.

## v3.4 delta (Claude's verdicts + Muse's amendment, #235 comment 7230645402)
- **External count-KAT (amendment requirement c).** The tokenizer block now
  carries `kat_counts` — golden token counts supplied by an independent lane
  (fixture: Muse's seven-case set, posted at #235 comment 7230606565). All
  seven were reproduced by this lane against the pinned `nexus.model` before
  adoption (two-lane KAT agreement). Provenance is anchored in the harness
  (T26), outside both the runner and the manifest under test. The id-sequence
  KAT stays: counts and ids guard different drift. For the pilot manifest the
  seat MUST source the golden set from a lane other than the runner's.
- **Manifest seal (Claude's new gap: who writes the pilot manifest).** New
  runner constant `SEALED_MANIFEST_SHA256`. For admission runs the gate-5
  seat pins the pilot manifest's sha256 there — the same discipline as the
  grader's `FROZEN_SHA256` — so a classification change becomes a visible,
  hash-dated runner+manifest pair. Seal mismatch FAILs C1 (T28 live-fire:
  pinned bytes PASS + report says SEALED; wrong pin FAILs). Unsealed runs
  (fixture/development) DECLARE `UNSEALED` in the report (T27 — surface
  honesty: the surface never implies a seal that isn't there).
- **Stale-target rule.** Claude caught the record verifying v3.1 after v3.2
  voided it; the same pattern would have verified v3.2 after v3.3. Rule, now
  written into the label: verify the newest posted digest-set, never a
  version label.
- Harness: 29/29 (adds T26 goldens anchor, T27 unsealed declaration,
  T28 seal live-fire, T29 justified-single-spawn schema path — the flag
  pilot rows will carry).

## Layout
- `run36-admission-checks.py` — the runner (stdlib + tiktoken/sentencepiece only)
- `fixtures/` — rows_fixture.jsonl, manifest_fixture.json, allowlist_fixture.txt,
  nexus.model (canonical tokenizer bytes, hash-verified)
- `harness/test_harness.py` — 29 right-reason tests
- `test-output.txt` — captured harness + valid-fixture run
- `SHA256SUMS` — digests of every file above

## Run
```
python3 run36-admission-checks.py --rows fixtures/rows_fixture.jsonl \
    --manifest fixtures/manifest_fixture.json --report report.json
python3 harness/test_harness.py
```

## Verification posture
All digests in SHA256SUMS are SELF-REPORTED by the builder's lane. Nothing here
is verified until an independent lane recomputes the hashes from the delivered
bytes and the artifacts land in the repo, hashed at rest. Run 25 remains the
incumbent; the pilot does not merge into main.
