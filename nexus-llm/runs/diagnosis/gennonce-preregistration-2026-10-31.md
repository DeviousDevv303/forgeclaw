# Generated-nonce run (run 9): pre-registration (2026-10-31)

Written and committed BEFORE the run is trained or scored. Inference/scoring on already-frozen probes; one training run on CPU.

## Hypothesis H3
The capfix model fails to copy unseen words partly because its only training signal for "arbitrary word" is a fixed pool of 48 nonce words (`NONCE` in `gen-synthetic-traces.ts`): a 4.5M model can memorise 48 words, so training never forces a general copy rule. Giving every copy target a freshly generated string (first letter uniform over a-z, about 80% pronounceable, about 20% arbitrary letters, rejection-sampled against all frozen eval text and both probes) should raise held-out exact copy.

Evidence that motivates it (all from this session): exact copy of unseen entities about 11% (7/62); 51/61 queries open with "e" for entities that do not; forcing the correct first character lifts exact to 40.3% only, so mid-word copying also fails; training pool is 48 words with skewed first letters and shared suffixes.

## Change (single variable)
`gen-synthetic-traces.ts --nonce generated` (flag; default OFF, flag-off output verified byte-identical to the previous generator on 800 rows, seed 5). Everything else as capfix: preset `small-copy-ind`, 30,000 rows, seed 31, 5,000 steps, batch 32, lr 6e-4, same pipeline (`GEN_ARGS='--nonce generated' pipeline.sh`). Row content still differs from capfix's because the nonce draws consume the RNG; that is inherent to the change and is disclosed.

## Primary criterion (fixed now)
Instrument: `eval/firstpiece-v1/probe.jsonl` (62 items, sha256 `1d2ed52b...2e72039`), UNFORCED, constrained decoding, single pass, no retries, scorer `score-probe.py`. Metric: pooled strict exact copy (S+L). Baseline capfix: 7/62 = 11.3%. Interpretable only if Kalshi routing >= 50% in each stratum, otherwise INCONCLUSIVE.
- H3 SUPPORTED: pooled exact >= 35% (at least +24 points; CI about +/-12).
- H3 NOT SUPPORTED: pooled exact < 20%.
- 20% to 35%: AMBIGUOUS.

## Prediction (stated before running)
Pooled exact between 15% and 30%. Honestly uncertain; I give SUPPORTED about 20%.

## Secondary, reported but not gating this hypothesis
capprobe-v1.2 strict exact (capfix: 4/60 = 6.7%); closed loop /18; gate vs run 4 (replace-only-if-better); v1 and domains-v1 per-suite change vs capfix (flag any drop over 1 point). Promotion is a separate decision and is NOT implied by H3 SUPPORTED: the gate decides.

## Caveats
One seed, one run, n = 62 (CI about +/-12). Random strings may not transfer to real words (the probe words are real brands/places); a pass on the probe would not by itself show better copying of real user text. Not ruled out: an improvement from more data diversity in general rather than from nonce novelty specifically; this run does not separate the two.

## Licenses
SUPPORTED: keep the flag as the recommended recipe for later runs and test it on the gate. NOT SUPPORTED: nonce-pool size is not the bottleneck; copy limits stay attributed to capacity/data/tokenizer, operator-gated levers. The model is not shipped either way without the gate and the operator.
