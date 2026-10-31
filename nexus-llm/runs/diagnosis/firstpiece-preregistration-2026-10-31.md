# First-piece-length probe: pre-registration (2026-10-31)

Written and committed BEFORE the probe is scored on any checkpoint. Probe, builder, scorer and manifest are in the same commit.

## Origin of the hypothesis (post-hoc, disclosed)

While reading the capfix result (`runs/capfix/RESULTS.md`, FAIL), an exploratory split of held-out copy errors showed that entities whose tokenizer-v1 first piece is a single character were copied exactly in 3/21, versus 19/39 for entities whose first piece is longer. That split was chosen after seeing the data, on small, unmatched samples. It is a lead, not a finding. This probe exists to test it on fresh, matched items.

## Hypothesis H

For an unseen entity word, copy accuracy is lower when the tokenizer's FIRST piece is a single character, and the characteristic error is a wrong or dropped first character (the rest of the word is copied).

## Instrument

- `eval/firstpiece-v1/probe.jsonl`, 62 items = 31 matched pairs, sha256 `1d2ed52b0623a63bef5b01e2e8730beeaa649b3ba4e1bcdbf1146e94edd72039` (see `PROBE-MANIFEST.json`).
- Stratum S: first piece length 1. Stratum L: first piece length >= 3. Pairs matched on exact number of pieces and word length +/-1. Mean pieces 3.419 in both strata; mean length S 7.03, L 7.39.
- One fixed template: `What are the Kalshi odds on {entity} beating earnings?` Gold: route `kalshi_markets`, entity string in the `query` argument.
- Every entity is absent (word-boundary, lowercase) from the generator source, v1 and domains-v1 cases, loop scenarios, capprobe-v1 and the capfix training data.
- NOT a gated frozen suite: no `cases.jsonl`/`MANIFEST.json`, so the gate and frozen-prompt checks ignore it.
- Scorer `eval/firstpiece-v1/score-probe.py`: strict case-sensitive exact copy; first-char-error = `entity[1:]` present in the argument but not `entity`; Wilson 95% CIs; routing reported separately. Self-tested on synthetic predictions (perfect / S-loses-first-char / never-routes) before seeing any model output.

## Model and decoding

Primary: the capfix checkpoint (run-8 design + capitalized nonces), `predict.py --constrained`, single pass, no retries. Secondary, non-gating: run-7 control checkpoint.

## Criterion (fixed now)

Let exact(X) = exact-copy rate in stratum X among all 31 items; fce(X) = first-char-error rate in stratum X.

- Interpretable only if Kalshi routing >= 50% in EACH stratum. Otherwise INCONCLUSIVE, whatever the copy numbers say.
- H SUPPORTED: exact(L) - exact(S) >= 25 points AND fce(S) - fce(L) >= 25 points.
- H NOT SUPPORTED: exact(L) - exact(S) < 10 points.
- Anything between: AMBIGUOUS. Reported as such; no further claims.

## Caveats stated in advance

1. n = 31 per stratum; Wilson CIs are about +/-17 points. A 25-point threshold is near the noise floor.
2. Association, not causation. Even SUPPORTED does not show the single-character piece causes the error.
3. Word-likeness is not controlled. Both strata mix brands, countries and place compounds; S leans toward brand/compound names, L toward countries and common place names. A difference could come from familiarity rather than segmentation.
4. The candidate pool was widened BEFORE any scoring because the builder's `>=30 pairs` assertion first yielded only 16. The assertion was kept; the pool (English place and compound names) was extended. Entity lists are frozen in the manifest.
5. Run-7 control is secondary and cannot change the verdict.

## What each outcome licenses

- SUPPORTED: tokenizer v2 (entity words with a multi-character first piece, or no single-character fallback at word start) becomes a justified, operator-gated proposal. It is still not shipped without a replace-only-if-better gate.
- NOT SUPPORTED: drop the lead. The copy blocker stays attributed to capacity and data; no tokenizer claim.
- AMBIGUOUS / INCONCLUSIVE: no change in conclusions.

No training is run in this step. Inference only.
