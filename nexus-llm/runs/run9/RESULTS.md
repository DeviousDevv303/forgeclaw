# Run 9 (generated nonces): result (2026-10-31)

Hypothesis H3, criterion and prediction committed first: 6a31a5e (`runs/diagnosis/gennonce-preregistration-2026-10-31.md`). Single change vs capfix: `--nonce generated`.
Preset `small-copy-ind` (4,479,234 params), 30,000 rows seed 31, 5,000 steps, lr 6e-4, generator 6a31a5e. data.jsonl sha256 `d74fb89f7b96a9c62df3d314c197359764b821c0b549dbf06b5d849ce77eb385`; model.pt sha256 `16283d7623dc9377b11abc8754ef42d6731548751610f71dec690b0da155775f` (model.pt NOT pushed). Ran uninterrupted (one pass, no resume).

## Pre-registered primary: H3 NOT SUPPORTED (borderline)
Pooled exact copy on firstpiece-v1 (unforced, constrained, single pass): **12/62 = 19.4%** (S 7/31 = 22.6%, L 5/31 = 16.1%); routing 62/62. Rule: < 20% NOT SUPPORTED. capfix was 7/62 = 11.3%. My prediction (15-30%) held.
Read this honestly: the result is 0.6 points under the line (one more correct item would have made it AMBIGUOUS), the 95% CI is roughly 11-30%, and the +8 point gain over capfix is not statistically separable at n = 62. The line is not moved after seeing the number.

## Secondary (pre-registered as non-gating; reported as specified)
| Measure | capfix | run 9 | run 4 incumbent |
|---|---|---|---|
| capprobe-v1.2 strict exact (n=60) | 4/60 = 6.7% | **40/60 = 66.7%** (CI 54-77) | not scored |
| - generate_image arm | 1/30 | **30/30** | |
| - kalshi_markets arm | 3/30 | 10/30 = 33.3% | |
| capprobe cap vs low gap | 0.0 | 1.7 pts (lowercase higher) | |
| general v1 | 63.1% | **72.6%** (best of any run; run 8 67.9) | 60.7% |
| domains-v1 | 76.6% | **70.2%** | 76.6% (v1.1) |
| closed loop | 8/18 (44.4%) | 6/18 (33.3%) | 6/18 |
Format 97.6% / 91.5%, schema 100/100, overclaim 0/0, fabrication 0/0 on v1 / domains-v1.

**Gate vs run 4: REJECTED** (`gate.txt`): domains-v1 70.2% is below the incumbent's 76.6%. Run 4 remains the incumbent. Not a ship decision either way.

## What the secondary numbers do and do not say
- The capprobe jump is large, but it is dominated by ROUTING: capfix routed 1/30 image prompts to generate_image, run 9 routes 30/30 and copies the entity in all 30. That is a different failure than the one H3 targeted (copy of Kalshi entities), so it must not be read as "H3 confirmed". The Kalshi arm (the arm that matches the primary probe's template) went 10% -> 33% on capprobe and 11% -> 19% on firstpiece: same direction, small n.
- capprobe entities were guarded against in the generator (rejection sampling vs both probes) and were held out of training, so leakage is not the explanation I can see; I have not audited it beyond that guard.
- Cannot separate "novel nonces" from "more word diversity in general" (stated in the pre-registration).
- One seed. Run 7/8 replicate spread was several points on v1, so v1 72.6% vs 67.9% is suggestive, not established.

## Consequences
- Do not claim the copy blocker is solved: Kalshi exact copy is ~19-33% by probe, the closed loop is 6/18 (capfix 8/18, run 4 6/18), so no end-to-end gain.
- The domains-v1 drop (76.6 -> 70.2) is what blocks promotion; diagnose by lane (tool_choice 57.7%, no_tool 66.7%) before another run. Next candidate: this recipe plus a data-mix change targeting the domains lanes, pre-registered.
- Flag `--nonce generated` stays default OFF; recommended for the next run's recipe on the secondary evidence only.
