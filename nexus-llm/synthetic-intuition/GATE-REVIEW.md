# Synthetic Intuition — pack-based Gate A / Gate B re-grade

**Review basis:** frozen `PACK-V1.1.md` at SHA-256 `df158f084162069733896724163c7703a89593e788d21749f7e4dba7b3214654`, verified from the merged repository; `gate-a-reproduction-output.txt`; `gate-b-pairs.jsonl`; and `gate-b-summary.json`. Muse’s latest directive is [Issue #235 comment 6904925988](https://github.com/DeviousDevv303/forgeclaw/issues/235#issuecomment-6904925988). This is a pack-based grade of the committed output and pair artifacts. It is **not** an independent rerun of the Run 31 data or Gate B model outputs because those large/raw artifacts are not in the repository yet.

## Gate A — Run 31 static audit

The committed reproduction output reports 7,000 tranche-6 rows and 91,989 full-mix rows. Applying v1.1 §10 to its published counts:

| Frozen Gate A requirement | Published evidence | Grade |
|---|---:|---|
| Recognition-signal-only pairs, with action ranking flipped | 0 / 2,410 tranche-6 pairs varied only the stated probability while the prompt/state/book stayed identical | **Fail** |
| Recognition before the act in emitted token order | Route preceded first recognition in 5,000 / 5,000 tranche-6 and 31,013 / 31,013 full-mix desk rows | **Fail** |
| Recognition before `funds_propose` | Call name preceded recognition in 2,347 / 2,347 tranche-6 and 18,424 / 18,424 full-mix calls | **Fail** |
| NO-side operative ask stated in prompt | 893 / 1,184 tranche-6 NO-side asks were not derivable from the prompt; maximum discrepancy 2.9¢ | **Fail** |
| Generator pre-training flip proof | No passing recognition-only proof is evidenced; the reported legacy family flips do not vary recognition alone | **Not satisfied** |

The `probability`-before-`side` key order (2,347 / 2,347 tranche-6 and 12,485 / 18,424 full-mix calls) does not cure the earlier route-before-recognition failure. Likewise, the desk-pass and assessment ordering counts do not satisfy the recognition-before-act requirement.

**Grade:** Run 31 does not pass Gate A under v1.1 §10. This is a grade of the posted reproduction output, not a rerun from raw `data.jsonl` and tranche-6 sources; those files and the full Gate A report are still absent from this checkout. The output is consistent with the pack’s stated structural diagnosis, but does not independently prove that row design alone caused the checkpoint behavior.

## Gate B — Run 31 checkpoint probe

`audit_gate_b.py` independently validates the committed pair file’s structure against the pack pin and reconciles the published summary with that file:

- 96 rows / 48 pairs, with 16 pairs in each of the exact families `magnitude_pos`, `magnitude_neg` and `sign`. `magnitude_pos` and `magnitude_neg` vary strength within one sign; `sign` varies the sign at matched magnitude.
- Within every pair, the prompt differs only in the numeric distance; shared ticker, YES book, mode and prefix remain fixed. Gold labels total 32 `pass`, 32 `propose_yes` and 32 `propose_no`.
- There are 24 unique tickers reused across pairs. The raw training mix and tranche-6 are not available here, so their claimed train/eval disjointness cannot be checked independently.
- The published summary is internally consistent: 24 / 96 rows correct (25%), 0 / 48 full expected flips, and 0 / 16 flips in each exact family. It reports 88 `pass` and 8 `propose_unknown_side` outputs. All eight listed corrupt row IDs map to expected-`pass` halves in the pair file.

**Interpretation:** Under v1.1 §13, a near-zero flip rate on this checkpoint is the diagnostic result that the trait is absent from the current weights and should be built from scratch; it is not evidence that the checkpoint possesses the trait. The report’s 0 / 48 result is a reported probe failure and supports that diagnosis. The raw `gate-b-outputs.jsonl` is not yet present, so the 24/96, 0/48, action-distribution and corruption counts are **summary-consistent, not independently reproduced from model outputs**.

## Pilot criteria and implementation blockers

The five exact v1.1 §12 criteria are:

1. Beat the frozen baseline on identical rows.
2. Zero exam-raw trait violations at meaningful volume; any violation fails.
3. No regression on any existing frozen benchmark.
4. Per-regime calibration reported with denominators.
5. Journal cap-fire rate; a pass that exists only because the clamp rescued it is void.

The merged `score.py` still accepts an arbitrary five-item metric/operator/threshold JSON. That is not the same as evaluating these five frozen requirements. In particular, the pack does not itself supply a numeric definition of “meaningful volume,” a single baseline comparison scalar, or a run’s frozen-benchmark comparison results. Do not invent these in a score file; register the experiment’s operational definitions and required denominators before grading a pilot.

There is also a concrete §10/decoder contract conflict that blocks training output: v1.1 requires the recognition element to appear **before** the route token in each emitted completion. The current `nexus-llm/src/grammar.ts` parser expects the route token first, and `nexus-llm/train/constrain.py` starts constrained decoding in the route state. The merged pair builders likewise emit route-first completions and put recognition in the prompt. Those rows do not satisfy §10’s token-order gate. They must not be used for a pilot until the transcript grammar/decoder is deliberately updated and tested to permit recognition text before the route token, or the spec owner resolves the conflict through an authorized pack revision. No new special token is assumed here.

## Reproducibility status and next artifacts

The pack, errata, Gate A reproduction script/output, Gate B pair file and Gate B summary are present on main; the pack hash matches exactly. Still pending from Muse’s machine are the full Run 31 `data.jsonl`, tranche-6 source rows, full Gate A report, and `gate-b-outputs.jsonl`. The Run 31 checkpoint remains on Muse’s machine; Muse said her replay probe runs there and the raw outputs will be published. A new independent Gate B output grade can be completed when those outputs land. The checkpoint itself is not requested at this stage.
