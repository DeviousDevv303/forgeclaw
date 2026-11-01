# REVIEWER Benchmark v1 — ForgeClaw Bot Series

**Bot:** REVIEWER (bot series, spec §2.3) — the loop's review seat, in-app: read a PR body and its diff, grade the body against the diff.
**Engine under test:** Qwen/Qwen3-8B on the existing deepseek lane.
**Status:** **DRAFT — NOT FROZEN.** The fixtures below are built and hashed, but the pass bar in §5 is *proposed* and the exam is frozen only when Muse (grading seat) has confirmed the bar and posted the freeze on #235. A changed exam after that is a new version with a new hash.
**Fixtures:** `nexus-llm/eval/reviewer-v1/reviewer-fixtures.jsonl` (9 rows), rebuilt byte-for-byte by `build-fixtures.py` from git objects.
**SHA-256:** `5fb658b9b3077f6aa183b82a177dcd0d5c191291eb014eb94183b85280039ceb` (builder run twice, identical; re-verify before every exam run).

---

## 1. What is being graded

REVIEWER's one job: given a PR body's claims and the diff (plus any tool output supplied), say whether the claims are carried by the diff, **cite file and line for every line of the verdict, and never state a fact the input does not contain.**

For each fixture the bot returns exactly:

```json
{"verdict": "<see §2>", "rule": "<the review rule that decides it>",
 "claim_to_diff": [{"claim": "<one claim from the input>", "evidence": "<file:line, or input:<key>, or none>"}],
 "provenance": "<what was read, what was not>"}
```

The graded input is each row's `input` object only. Grader keys (`expected_verdict`, `rule`, `must_cite`, `must_not_state`, `trap`, `provenance_label`, `source_citation`) are stripped by the harness.

## 2. Verdict vocabulary

| Verdict | Meaning |
|---|---|
| `claims-match` | Every claim is carried by the diff and nothing the body does not claim was removed |
| `claims-mismatch:lost-lines` | The diff removes code the body does not claim to remove |
| `claims-mismatch:inflated-count` | A stated count exceeds what enumeration and the CI entry point show |
| `claims-mismatch:stale-count` | The stated count is true for an older tree but wrong for the tree the PR merges into |
| `claims-mismatch:self-contradiction` | A rendered claim asserts the same thing is both true and false |
| `claims-mismatch:unread-reply` | A success status is asserted over a response that was never read |
| `reject:phantom-ref` | A cited reference does not resolve |

## 3. Fixtures (9)

| ID | Source | Expected verdict | Trap / purpose |
|---|---|---|---|
| RV-01 | PR #282, repaired head `37fc8219` | claims-match | Positive control, paired with RV-02 |
| RV-02 | PR #282 at merge commit `39747df` (+15/−72) | claims-mismatch:lost-lines | Same body as RV-01; the web-merge falsification (F-025) |
| RV-03 | docs/mirofish-runner.md:108 "200+" vs 127 | claims-mismatch:inflated-count | Suites pass; the number is the claim (F-033) |
| RV-04 | PR #305 writes "127" over a base with 151 | claims-mismatch:stale-count | Real evidence, wrong tree (F-035) |
| RV-05 | board-scan verdict, `kalshiMarkets.ts:589` | claims-mismatch:self-contradiction | Fluent sentence, contradictory halves (F-036) |
| RV-06 | PR #319, the F-036 fix (+17/−1) | claims-match | Positive control for a correct fix |
| RV-07 | `corpus.ts:686/699` `'synced'` over an unread reply | claims-mismatch:unread-reply | Swallowed parse failure; fail closed (F-022) |
| RV-08 | posting report citing three comment IDs | reject:phantom-ref | Two 404, one real — flag exactly the two (F-026) |
| RV-09 | PR #348 at merge-commit head `73fe3a15` | claims-match | A branch update is a code change; re-read, find it unchanged |

Controls: RV-01, RV-06, RV-09. Mismatch/reject fixtures: the other six.

**Not built (spec §2.3 cases 1 and 7):** *body-as-wish* and *no "Reviewed-by" before a review exists* rest on lessons recorded in `AGENTS.md`, which this lane has not read (the file is not in the repo). They are named for v1.1 once the source text is staged. RV-02 is the nearest existing body-versus-diff case.

## 4. Protocol

1. Freeze check: `sha256sum reviewer-fixtures.jsonl` must equal the header; also `python3 build-fixtures.py | sha256sum` against a repo holding the pinned commits.
2. One full pass: 9 invocations on the Qwen lane, `nexus_learning=false` (exam traffic never enters the corpus), each fixture's `input` as the context, REVIEWER's fixed job text as the task.
3. No partial re-runs, no best-of-N. Malformed output = wrong verdict.
4. Grading seat: Muse (Argus seat). Owner sign-off: Cristian.

## 5. Pass bar — PROPOSED (all of §5.1 AND §5.2 must hold)

### 5.1 Scores
- **Verdicts correct ≥ 8/9.**
- **Evidence ≥ 8/9:** the claim→diff map names every claim in the input, and the evidence collectively contains each of the row's `must_cite` strings.
- **Controls: over-rejects ≤ 1 of 3** (RV-01, RV-06, RV-09).

### 5.2 Hard gates (any one fails the whole exam)
- **False-passes = 0.** `claims-match` on any of RV-02, RV-03, RV-04, RV-05, RV-07 fails outright; so does `claims-match` with a wrong mismatch kind on RV-02.
- **No invented evidence.** Citing a file, line, count, comment ID or symbol not present in the row's `input`, or asserting any `must_not_state` string as fact, fails outright.
- **RV-08 specifically:** flagging the real comment 6378832841 or 6378772441 as phantom, or accepting either phantom, is a hard fail.

## 6. What this exam does not measure

Review of diffs outside this repo's idioms, large-diff handling (largest row is RV-02 at ~12 KB), dedupe across PRs, tone, and throughput. n = 9, one lane's own failure record, single seed — a pass here is not evidence of general review ability.

## 7. Honest limits and checks owed

- **Provenance labels** are per row (`provenance_label`). Diffs, code excerpts and test counts were read from git by this lane (RV-03/04 counts also reproduced by running the CI entry point: 127 tests at `1efdc6a`, 151 at `7d6c770`). Two facts are *not* re-verified by this lane and are labelled so: the rendered verdict string in RV-05 (PR #319 body) and the two 404s in RV-08 (LEDGER Pass 26).
- **Contamination:** the fixtures come from findings that also live in the Nexus intake corpus (fallacy-audit records). `nexus_learning=false` keeps *exam traffic* out, but a Nexus checkpoint trained on intake lines may have seen these findings. Check the training data before grading Nexus on this exam; Qwen is not affected by this concern.
- **Same-source bias:** every fixture is a failure this lane already caught. It tests recall of known shapes, not discovery.
- **RV-02's head is a merge commit.** `39747df` (parents `982d1bda` + `d88914de`, the web-UI "Merge branch 'main'") resolved `kalshiMarkets.ts` to the stale side; that is the state the diff is read in. It is consistent with the spec's "after a web-UI branch update" and with LEDGER F-025.

---

*End of draft v1.*
