# Forced-first-character result (2026-10-31)

Criterion committed first (dd6fcdf, `runs/diagnosis/forcedfirst-preregistration-2026-10-31.md`). capfix, unconstrained, single pass.

| | n | exact copy | 95% CI |
|---|---|---|---|
| unforced baseline (pooled) | 62 | 7 (11.3%) | |
| forced first char, S | 31 | 19 (61.3%) | 44-76 |
| forced first char, L | 31 | 6 (19.4%) | 9-36 |
| **forced first char, pooled** | 62 | **25 (40.3%)** | about 29-53 |

## Verdict (pre-registered reading): AMBIGUOUS
Pooled 40.3% sits between the 25% (NOT SUPPORTED) and 50% (SUPPORTED) lines. My stated prediction (below 25%) was WRONG.

What it does show: supplying the first character lifts exact copy from 11.3% to 40.3% pooled, so the first step is a large part of the failure. It is not the whole failure: 60% still fail, typically by dropping or substituting middle characters (audi -> "aing", kenya -> "kya", barclays -> "bays", cleveland -> "clevelanland").

## Do not read the S vs L split
S 61% vs L 19% reverses the first-piece direction, but this is confounded exactly as the caveat warned: for S entities the forced character equals the entity's natural first piece; for L entities (first piece "ire", "ken", ...) forcing one character splits a multi-character piece into an off-distribution tokenization. The stratum comparison under forcing is not a clean test of anything. The pre-registered first-piece verdict (NOT SUPPORTED) is unchanged and not revisited.

## Consequences
- A first-step intervention could plausibly recover part of the gap, but a ceiling near 40-60% on this probe even with a correct start says copy remains weak mid-word. No fix is licensed as sufficient; any attempt (e.g. a training signal on span-initial tokens) would need its own pre-registered probe and the replace-only-if-better gate.
- Capacity/data/GPU levers stay relevant. Nothing here changes the operator-gated list.

Caveats: one checkpoint, one seed, one template, n = 62; forced prefixes are not a deployable path.
