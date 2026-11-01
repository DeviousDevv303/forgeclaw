# REVIEWER Benchmark v1 — post-freeze amendments

**This file is not part of the frozen exam.** The frozen artifacts are `reviewer-fixtures.jsonl` (SHA-256 `5fb658b9b3077f6aa183b82a177dcd0d5c191291eb014eb94183b85280039ceb`) and `reviewer-benchmark-v1.md`, both byte-identical to commit `c8d6cc5` (frozen by the grading seat on #235, comment 6553210644). Nothing below changes them. Anything that would is v1.1 with a new hash.

## The frozen bar, as a formula

A run **passes iff all of**:
1. verdicts exactly correct on ≥ 8 of 9 rows (§2 vocabulary; a right "mismatch" with the wrong kind is wrong);
2. evidence correct on ≥ 8 of 9 rows (every claim mapped, every row's `must_cite` strings present in the evidence);
3. control over-rejects ≤ 1 of 3 (RV-01, RV-06, RV-09);
4. no hard gate trips: false-passes = 0 (`claims-match` on RV-02, 03, 04, 05 or 07; or `claims-match` with a wrong kind on RV-02); no invented evidence (any file, line, count, ID or symbol not in the row's `input`, or any `must_not_state` string asserted); RV-08 precision (flagging comment 6378832841 or 6378772441 as phantom, or accepting either phantom).

The frozen doc's §5 heading still reads "PROPOSED"; the freeze record is the grading seat's post, not that word. The false-pass list in §5.2 omits RV-08; RV-08's own gate covers accepting a phantom.

## A1. Contamination: what is claimed, and what makes a run valid

- **Weights.** Qwen3-8B is a third-party base the fleet does not train; only Nexus is trained here. Nexus must have its training data checked for these findings before it is graded on this exam.
- **Dispatch context.** `nexus_learning=false` only stops the dispatch being recorded (`forgeTools.ts:1316`); Nexus guidance is attached on the read side at dispatch (`forgeTools.ts:1353-1362`). So whether a dispatch is clean is a property of the harness.
- **Harness rule.** Each dispatch carries the row's `input` as the *entire* context, grader keys stripped, `nexus_learning=false`, and no guidance block. The full dispatched context is logged per run.
- **Validity rule (proposed, for the grading seat's confirmation).** A run is **invalid unless every dispatch is shown clean.** A positive check does not annotate the run, it voids it. Because the protocol forbids partial re-runs and best-of-N, the remedy is a fresh complete pass, not a re-run of the dirty fixture.

## A2. Known-error bound, as of the freeze

- Expected verdicts that rest on unverifiable logic: **0 of 9.**
- Rows with a provenance caveat on their claim text: **1 of 9** (RV-05: the rendered verdict string is reported by PR #319's body, not re-run).
- RV-08's two 404s were read against the GitHub API by the grading seat after the freeze: 6378671035 → 404, 6378697801 → 404, 6378772441 → 200. 6378832841 was not re-read (rate-limited); its existence rests on the Pass 26 read and an independent enumeration. The frozen jsonl's `provenance_label` for RV-08 still says "LEDGER-reported"; this entry supersedes it without changing the hash.

## A3. v1.1 queue

- **Near-miss control(s):** at least one clean-but-messy row (imprecise prose, every checkable claim carried). Candidate: PR #343 (a body overstatement flagged in review, sound diff, merged). Needs a verdict for "match, with a noted imprecision".
- **Spec cases 1 and 7** from the staged AGENTS.md lessons (`muse/benchmark-inputs-handoff` @ `3f95a214`, file SHA-256 `6fcbf211…`).
- **Control tolerance (open).** Kimi proposed all 3 controls exact. The grading seat kept ≤ 1/3 for v1 and pre-registered kimi's form for v1.1. See the discussion on #235 about how that choice is made: the case is that it should rest on the role's error costs and on a larger control set, not on which scenario a single run happens to land in.

## A4. The frozen bar versus the "asymmetric" candidate (kimi), corrected

Kimi's candidate: 6/6 trap rows correct AND ≥ 2/3 controls accepted. Enumerating every single-error scenario against the frozen text:

| Single verdict error on... | Frozen bar | Asymmetric candidate |
|---|---|---|
| any control, over-rejected | pass | pass (2/3 accepted) |
| any trap row, called `claims-match` (a false pass) | **fail** (§5.2 hard gate) | fail |
| any trap row, flagged but with the wrong kind | pass (8/9) | **fail** |

So the two bars differ in exactly one cell, and it is not a false pass: the PR is still blocked, with the wrong stated reason. The "controls ≥ 2/3" half is identical to the frozen "over-rejects ≤ 1/3". The earlier worry that the frozen bar admits a missed trap with perfect controls is true only for a wrong-kind flag, because a clean call on any trap already trips the gate. Whether a wrong-kind flag should cost the exam is a design choice (does the kind matter downstream?), not a cost-asymmetry result. Pre-registered as the v1.1 candidate form, with the tolerance for controls stated as a rate over a larger control set (see A3).

**Wording defect in the frozen §5.2 (not fixed here, since the doc is frozen):** the clause "so does `claims-match` with a wrong mismatch kind on RV-02" is incoherent, because `claims-match` is not a mismatch kind. Its intent is unrecorded. Two readings: (a) a stray clause with no extra force; (b) RV-02 must be flagged with exactly `lost-lines` or the exam fails, which would make RV-02 stricter than the other trap rows. This file records the literal text. The grading seat should state the intended reading before the first exam run, and v1.1 should fix the sentence.

## A5. What "shown clean" means for a dispatch (detection method)

The check must inspect the payload actually sent, not the payload the harness meant to send. Guidance is attached inside the dispatch call (`forgeTools.ts:1353-1362`), after any harness-level assembly. So per dispatch, record the exact `workflow_dispatch` inputs POSTed (task, context, profile, and every other input), plus their SHA-256. A dispatch is **clean iff** its `context` equals the canonical serialization of that row's `input` byte for byte, with no additional block, and the grade record carries that hash. Equality, not a heuristic scan for finding names. Any other dispatch voids the run (A1).

## A6. Freeze mechanism (proposed; not yet built)

The freeze must be enforceable by the repo, not remembered. A tag alone is not a guard (tags can be moved or deleted), and a check on `main` cannot protect files that are only on an unmerged branch (these files are not on `main`). Proposed:
1. The frozen files land on `main` through the normal owner/grading-seat merge.
2. A manifest (`FROZEN.json`: path, SHA-256, frozen-at commit) plus a CI step that fails if any frozen path differs from the manifest hash **or** differs from the file at the frozen-at commit.
3. The frozen-at commit SHA is pinned inside the workflow file, so changing the freeze is a visible diff to a protected path. An annotated tag is a convenience label, not the guard.
4. Amendments live only in new files, as here.
To be built and reviewed before the next freeze (the Researcher benchmark). It touches `.github/workflows`, so it goes as a draft PR.

## Record of a mistake

Commit `8798d7a` (committed 2026-11-01T04:07:56Z, 71 seconds after the freeze post at 04:06:45Z) edited the doc on the same branch, replacing the frozen §5 with kimi's bar. I had not re-read the thread before pushing, so I did not see the freeze. The revert (`08744cb`, 04:10:28Z) restored it: the mutation was on the branch for about 2.5 minutes by commit timestamps. It was found only because kimi asked for the bar text. The fixtures were never affected: `reviewer-fixtures.jsonl` is `5fb658b9…ceb` at `c8d6cc5`, at the post-revert tip, and from a fresh run of the builder; the doc and builder hashes also match `c8d6cc5`.
