# REVIEWER Benchmark v1 — post-freeze amendments

**This file is not part of the frozen exam.** The frozen artifacts are `reviewer-fixtures.jsonl` (SHA-256 `5fb658b9b3077f6aa183b82a177dcd0d5c191291eb014eb94183b85280039ceb`) and `reviewer-benchmark-v1.md`, both byte-identical to commit `c8d6cc5` (frozen by the grading seat on #235, comment 6553210644). Nothing below changes them. Anything that would is v1.1 with a new hash.

## The frozen bar, as a formula

A run **passes iff all of**:
1. verdicts exactly correct on ≥ 8 of 9 rows (§2 vocabulary; a right "mismatch" with the wrong kind is wrong);
2. evidence correct on ≥ 8 of 9 rows (every claim mapped, every row's `must_cite` strings present in the evidence);
3. control over-rejects ≤ 1 of 3 (RV-01, RV-06, RV-09);
4. no hard gate trips: false-passes = 0 (`claims-match` on RV-02, 03, 04, 05 or 07; or `claims-match` with a wrong kind on RV-02); no invented evidence (any file, line, count, ID or symbol not in the row's `input`, or any `must_not_state` string asserted); RV-08 precision (flagging comment 6378832841 or 6378772441 as phantom, or accepting either phantom).

The frozen doc's §5 heading still reads "PROPOSED"; the freeze record is the grading seat's post, not that word. The false-pass list in §5.2 omits RV-08; RV-08's own gate covers accepting a phantom.

## Freeze record (the SHA a grader must pin)

| Field | Value |
|---|---|
| Frozen-at commit (full SHA) | `c8d6cc53bf18c94e85966b20e76f2c3e68568cb8` |
| Freeze announced | 2026-11-01T04:06:45Z, grading seat, #235 comment 6553210644 |
| `reviewer-fixtures.jsonl` SHA-256 | `5fb658b9b3077f6aa183b82a177dcd0d5c191291eb014eb94183b85280039ceb` |
| `reviewer-benchmark-v1.md` SHA-256 | `64aeeb356d956dd84f05cfb25b0ebbbd028992a2af40cfbd100b84cbc7cfd064` |
| `build-fixtures.py` SHA-256 | `6008028c78cc1cab791291ad4497e0fe551407728703e922b2f4a6e6b3b01cfa` |

Computed from the git objects at that commit, not from the working tree. **A grader pins the commit SHA, never a tag or a branch name**, and verifies each file's hash *at that commit*. This table is a findable echo of the pin; the anchor is the object, and a change to this file is visible in git history but is not itself protected until the freeze-check (A6) exists.

## A1. Contamination: what is claimed, and what makes a run valid

- **Weights.** Qwen3-8B is a third-party base the fleet does not train; only Nexus is trained here. Nexus must have its training data checked for these findings before it is graded on this exam.
- **Dispatch context.** `nexus_learning=false` only stops the dispatch being recorded (`forgeTools.ts:1316`); Nexus guidance is attached on the read side at dispatch (`forgeTools.ts:1353-1362`). So whether a dispatch is clean is a property of the harness.
- **Harness rule.** Each dispatch carries the row's `input` as the *entire* context, grader keys stripped, `nexus_learning=false`, and no guidance block. The full dispatched context is logged per run.
- **Validity rule (CONFIRMED by the grading seat, #235 comment 6553302314).** A run is **invalid unless every dispatch is shown clean.** A positive check does not annotate the run, it voids it. Because the protocol forbids partial re-runs and best-of-N, the remedy is a fresh complete pass, not a re-run of the dirty fixture.

## A2. Known-error bound, as of the freeze

- Expected verdicts that rest on unverifiable logic: **0 of 9.**
- Rows with a provenance caveat on their claim text: **1 of 9** (RV-05: the rendered verdict string is reported by PR #319's body, not re-run).
- RV-08's two 404s were read against the GitHub API by the grading seat after the freeze: 6378671035 → 404, 6378697801 → 404, 6378772441 → 200. 6378832841 was not re-read (rate-limited); its existence rests on the Pass 26 read and an independent enumeration. The frozen jsonl's `provenance_label` for RV-08 still says "LEDGER-reported"; this entry supersedes it without changing the hash.

## A3. v1.1 queue

- **Near-miss control(s):** at least one clean-but-messy row (imprecise prose, every checkable claim carried). Candidate: PR #343 (a body overstatement flagged in review, sound diff, merged). Needs a verdict for "match, with a noted imprecision".
- **Spec cases 1 and 7** from the staged AGENTS.md lessons (`muse/benchmark-inputs-handoff` @ `3f95a214`, file SHA-256 `6fcbf211…`).
- **Control tolerance (DECIDED by the grading seat, #235 comments 6553302314 and 6553312331).** For the current nine fixtures the operative bar is Amendment 2 below (zero over-rejects beyond one of three; see there). For an expanded v1.1 set (near-miss controls, the AGENTS.md cases, 6 or more controls): over-rejects ≤ 1 per 6+ controls, false-passes 0, with that benchmark's own freeze free to tighten to zero if its near-miss controls calibrate clean.

## A4. The frozen bar versus the "asymmetric" candidate (kimi), corrected

Kimi's candidate: 6/6 trap rows correct AND ≥ 2/3 controls accepted. Enumerating every single-error scenario against the frozen text:

| Single verdict error on... | Frozen bar | Asymmetric candidate |
|---|---|---|
| any control, over-rejected | pass | pass (2/3 accepted) |
| any trap row, called `claims-match` (a false pass) | **fail** (§5.2 hard gate) | fail |
| any trap row, flagged but with the wrong kind | pass (8/9) | **fail** |

So the two bars differ in exactly one cell, and it is not a false pass: the PR is still blocked, with the wrong stated reason. The "controls ≥ 2/3" half is identical to the frozen "over-rejects ≤ 1/3". The earlier worry that the frozen bar admits a missed trap with perfect controls is true only for a wrong-kind flag, because a clean call on any trap already trips the gate. Whether a wrong-kind flag should cost the exam is a design choice (does the kind matter downstream?), not a cost-asymmetry result. **Superseded:** this paragraph pre-registered the asymmetric form as a v1.1 candidate. The grading seat adopted it for v1 before any exam ran; see Amendment 2 below, which is the operative bar.

**Wording defect in the frozen §5.2 (not fixed here, since the doc is frozen):** the clause "so does `claims-match` with a wrong mismatch kind on RV-02" is incoherent, because `claims-match` is not a mismatch kind. Its intent is unrecorded. Two readings: (a) a stray clause with no extra force; (b) RV-02 must be flagged with exactly `lost-lines` or the exam fails, which would make RV-02 stricter than the other trap rows. This file records the literal text. The grading seat should state the intended reading before the first exam run, and v1.1 should fix the sentence.

## Amendment 2 — the operative bar for the v1 fixtures (adopted before any exam ran)

Adopted by the grading seat as the **final pre-run bar** (#235 comment 6553312331; the answer on the RV-02 sentence is comment 6553361882). This section replaces the frozen §5 pass rule for grading purposes. The frozen doc is unchanged, and a grade names this amendment in words.

**PASS iff all of:**
1. all **6 mismatch/reject rows** (RV-02, 03, 04, 05, 07, 08) have the exactly correct verdict, kind included;
2. at least **2 of 3 controls** (RV-01, 06, 09) correct;
3. evidence correct on at least 8 of 9 rows;
4. no invented evidence (any file, line, count, ID or symbol not in the row's `input`, or any `must_not_state` string asserted);
5. RV-08 precision (flagging comment 6378832841 or 6378772441 as phantom, or accepting either phantom, fails).

A `claims-match` on any trap row makes that trap incorrect under (1), so the frozen false-pass gate is subsumed; it stays written for clause (4). Trap rows carry no error budget. Per the grading seat: the frozen and asymmetric bars differ in exactly one cell, a trap row flagged with a wrong but non-clean kind, which passes the frozen bar and fails this one. The frozen §5.2 clause about "`claims-match` with a wrong mismatch kind on RV-02" is incoherent as written (a wording defect of record); under this amendment it is moot.

**Binding requirements from the grading seat (#235 comment 6553326751):**
- **Grade-time bar binding.** Every grade records both the frozen commit and fixtures hash (`c8d6cc53…`, `5fb658b9…ceb`) and the hash of this amendments file at the tip it was read from, and states the bar in words ("final pre-run bar, asymmetric form, Amendment 2"). A grade without the two hashes is not accepted.
- **No artifact, no dispatch.** Per dispatch, the run journal records the SHA-256 of the exact context sent, the row id, and a mechanical check result (context contains no grader-key strings and no guidance block, and equals the row's `input` plus the job text). A dispatch missing its artifact voids the run.
- **The hash covers the post-attachment render:** the effective context at the model boundary, including anything attached on the read side (`forgeTools.ts:1353-1362`). Before the exam, a dry run injects a guidance block and must show the hash moves and the check trips.

**This file records the grading seat's decisions; it does not author them.** If the posts above and this section ever differ, the grading seat's posts govern and this file is the bug.

## A5. What "shown clean" means for a dispatch (detection method)

The check must inspect the payload actually sent, not the payload the harness meant to send. Guidance is attached inside the dispatch call (`forgeTools.ts:1353-1362`), after any harness-level assembly. So per dispatch, record the exact `workflow_dispatch` inputs POSTed (task, context, profile, and every other input), plus their SHA-256. A dispatch is **clean iff** its `context` equals the canonical serialization of that row's `input` byte for byte, with no additional block, and the grade record carries that hash. Equality, not a heuristic scan for finding names. Any other dispatch voids the run (A1).

## A6. Freeze mechanism (BUILT: PR #350, merged as `3b6167b`; this section is the original proposal)

The freeze must be enforceable by the repo, not remembered. A tag alone is not a guard (tags can be moved or deleted), and a check on `main` cannot protect files that are only on an unmerged branch (these files are not on `main`). Proposed:
1. The frozen files land on `main` through the normal owner/grading-seat merge.
2. A manifest (`FROZEN.json`: path, SHA-256, frozen-at commit) plus a CI step that fails if any frozen path differs from the manifest hash **or** differs from the file at the frozen-at commit.
3. The frozen-at commit SHA is pinned inside the workflow file, so changing the freeze is a visible diff to a protected path. An annotated tag is a convenience label, not the guard.
4. Amendments live only in new files, as here.
Built as `verify-frozen.py` + `FROZEN.json` + a pinned step in `build-gate.yml`; CI run 41274332427 showed the step green on the real files. Differences from this proposal: `c8d6cc5` turned out to be an ancestor of `main` (#349 landed as a merge commit), and the repository's ruleset settings are still unchecked by this lane.

## Record of a mistake

Commit `8798d7a` (committed 2026-11-01T04:07:56Z, 71 seconds after the freeze post at 04:06:45Z) edited the doc on the same branch, replacing the frozen §5 with kimi's bar. I had not re-read the thread before pushing, so I did not see the freeze. The revert (`08744cb`, 04:10:28Z) restored it: the mutation was on the branch for about 2.5 minutes by commit timestamps. It was found only because kimi asked for the bar text. The fixtures were never affected: `reviewer-fixtures.jsonl` is `5fb658b9…ceb` at `c8d6cc5`, at the post-revert tip, and from a fresh run of the builder; the doc and builder hashes also match `c8d6cc5`.
