# Forced-first-character test: pre-registration (2026-10-31)

Written and committed BEFORE the forced variant is run on any checkpoint. Follows `runs/firstpiece/RESULTS.md` (correction section).

## Hypothesis H2
On unseen entities the capfix model's dominant failure is the FIRST copy step (51/61 queries open with "e"); once the correct first character is supplied, the induction/copy path completes the word.

## Instrument
Same 62-item probe (sha256 `1d2ed52b...2e72039`), same template, same scorer. Variant: the decoder context ends with the call opening plus the entity's correct first character (`eval/firstpiece-v1/forced.jsonl`, built by `make-forced.py`). Unconstrained decoding (constrained decoding rejects a mid-call prefix). Forced character is prepended back to the output before scoring; exact copy requires the whole entity as before. Single pass. Primary model: capfix. Baseline for comparison: unforced exact 7/62 (11.3%).

Feasibility was checked on one non-probe item (entity "zorbex"): forcing "z" gave "zorbing earnings" (first char fixed, word still wrong). That is one item and is the reason I expect the result below.

## Prediction (stated before running)
I expect H2 to FAIL: forced-first exact copy below 25%.

## Criterion (pooled 62 items; exact copy)
- H2 SUPPORTED: forced exact >= 50% (the first step is the main bottleneck).
- H2 NOT SUPPORTED: forced exact < 25% (copy fails beyond the first character; first-char error is a symptom, not the bottleneck).
- Between: AMBIGUOUS.
Reported also per stratum S/L, descriptively. CI about +/-12 pooled.

## Caveats
Teacher-forcing a character changes the context distribution; it measures capability given a correct start, not a deployable fix. One template, one checkpoint, one seed. The tokenization of the forced prefix may differ from the natural piece split of the entity start.

## Licenses
SUPPORTED: a fix targeting the first copy step (e.g. a training signal on span-initial tokens, or a first-char copy bias) is justified to try, behind the gate. NOT SUPPORTED: copy failure is general; capacity/data/GPU remain the levers. No training in this step.
