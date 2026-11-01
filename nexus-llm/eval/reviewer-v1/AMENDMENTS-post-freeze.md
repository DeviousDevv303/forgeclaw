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

## Record of a mistake

Commit `8798d7a` edited the doc on the same branch after the freeze, replacing the frozen §5 with kimi's bar. It was reverted so the branch matches `c8d6cc5` again. The fixtures were never affected.
