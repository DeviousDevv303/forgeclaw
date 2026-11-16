# Synthetic Intuition — Gate A / Gate B review

**Review basis:** Issue [#235 comment 6904278510](https://github.com/DeviousDevv303/forgeclaw/issues/235#issuecomment-6904278510) (Gate A) and [comment 6904925988](https://github.com/DeviousDevv303/forgeclaw/issues/235#issuecomment-6904925988) (Gate B). This is an arithmetic and inference review of the posted summaries, not a reproduction of the experiments.

## Gate A — conditional grade

The reported count identities reconcile:

| Check | Recalculation | Result |
|---|---:|---|
| Flip-designed pair classes | 400 + 160 + 1,200 | 1,760 |
| All tranche-6 pairs | 1,760 + 450 + 200 | 2,410 |
| Pair-half rows | 2 × 2,410 | 4,820 of 6,200 (77.7%) |
| Tranche-6 composition | 3,800 + 2,400 | 6,200 |
| Mix rows carrying a probability signal | 31,013 + 3,600 | 34,613 |
| Mix entry rows | 34,613 − 7,200 assess rows | 27,413 |
| Mix entry/pass split | 18,424 + 8,989 | 27,413 |
| New-dialect probability-before-side | 12,485 / 18,424 | 67.76% |
| NO-side ask leak | 893 / 1,184 | 75.42% |

**Grade:** arithmetic passes. If the row parsing, labels and denominators in the unavailable audit are correct, the report supports its structural finding that the existing pairs do not isolate recognition as the sole varied feature, and that the act precedes the model-emitted recognition in the reported completion ordering. It does **not** independently establish the source counts or the claimed row-level ordering.

The strongest causal wording should remain qualified: the reported near-noiseless action labels at decisive edges and the absence of recognition-only pairs make a row-design defect plausible, but they do not by themselves explain why the checkpoint produced zero entries. That is a model-output question, not a deduction from the static audit alone.

## Gate B — conditional grade

The reported count identities reconcile: 32 + 16 = 48 pairs; 2 × 48 = 96 rows; 88 + 8 = 96 outputs. The reported row accuracy is 24 / 96 = **25.00%**. A 0 / 48 expected-direction flip rate is arithmetically possible and, if reproduced, is a failure on this specified probe. The eight wrong-direction differences can align with eight propose outputs, but only the raw pair/output records can confirm that mapping.

**Grade:** reported sample-level result is a fail for expected flips; broader transfer claims are not established beyond this 48-pair probe. The eight corrupted propose outputs and the unseen-ticker recognition degradation are accepted as reported, not independently reproduced.

## Evidence and reproducibility limits

The checkout does not contain the Run 31 `data.jsonl`, tranche-6 source rows or generator, Gate A audit script/report, Gate B pair/output JSONL, or checkpoint. The frozen v1.1 pack file is also not present in this checkout; only its SHA-256 is posted in Issue #235 comment 6904925988. Consequently, these grades verify arithmetic and conditional logic only. No source-count, model-output, or pack-byte claim is independently reproduced here.
