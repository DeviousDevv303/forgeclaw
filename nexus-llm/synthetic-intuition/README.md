# Synthetic Intuition — scoring and pair-generation tools

This directory implements the open build steps in [ForgeClaw Issue #235](https://github.com/DeviousDevv303/forgeclaw/issues/235), using the frozen pack pin posted in [Muse’s directive, comment 6904925988](https://github.com/DeviousDevv303/forgeclaw/issues/235#issuecomment-6904925988).

## Frozen pack pin and current limitation

The expected pack is `pack-v1.1`, SHA-256 `df158f084162069733896724163c7703a89593e788d21749f7e4dba7b3214654`. `PACK-V1.1.sha256` records that pin. **The pack bytes themselves are not present in the current repository checkout**, even though the issue comment says they exist on Muse’s machine at `nexus-llm/synthetic-intuition/PACK-V1.1.md`. The scripts therefore fail closed for real scoring/builds unless the exact pack file is supplied and hashes to the frozen value. The sidecar is a pin, not a substitute for the spec.

No thresholds or mix ratios are inferred from prose summaries. The scorer can emit descriptive metrics without criteria, but will not report a gate PASS unless the frozen pack bytes and all five criteria copied from that pack are verified. The generators require byte-verified pack data and an independently frozen, hash-sidecar-pinned mix design; they do not choose ratios or start training.

## Gate A / Gate B review

`GATE-REVIEW.md` records the arithmetic and conditional grades for Gate A and Gate B. It distinguishes arithmetic consistency from reproduction of the underlying Run 31 data, Gate A audit, Gate B pairs/outputs, checkpoint, or frozen pack bytes; those primary artifacts are not in this checkout.

## Hold/fold scorer and generator

`score.py` consumes one adjudicated JSON object per line. Each row carries the pack hash, regime, evidence state (`no_disproof`, `method_failure`, or `verified_disproof`), decision, recognition/action token positions, rank-before/expected-rank-after/predicted-rank-after, hold depth, fold latency, lawful-alternative completion, and clamp fields.

It reports, overall and **per regime with numerator and denominator**:

- false surrender separately from false persistence;
- recognition-before-action ordering and action accuracy;
- fold latency (mean, median, and folded / eligible rate);
- hold depth and correct-hold rate;
- rank-change match rate after recognition;
- clamp intervention rate and clamp-rescued-pass count.

A `clamp_rescued_pass` row is void, excluded from success denominators, and still reported as void. It remains included in the clamp-intervention numerator/denominator because that is a measured intervention. A criteria file must use schema `synthetic-intuition-criteria-v1`, match the pack SHA, and contain exactly five explicit metric/operator/threshold/scope entries copied from the pack; no default thresholds are provided.

Example invocation once the exact pack and criteria are available:

```bash
python3 nexus-llm/synthetic-intuition/score.py predictions.jsonl \
  --pack nexus-llm/synthetic-intuition/PACK-V1.1.md \
  --criteria frozen-criteria.json \
  --output GRADE-REPORT.json
```

Without the pack bytes the script emits metrics only, reports `ungraded_pack_bytes_unverified`, and exits non-zero.

`build_pairs.py` creates graded, provenance-backed hold/fold minimal pairs in the Nexus run-mix JSONL shape (`id`, `synthetic`, `prompt`, `text`, `kind`, `mode`, `copySpans`). Each pair has one shared context, one declared recognition-signal field, a hold arm and a fold arm; the signal is included in the prompt before the generated decision. It supports `evidence_given` and `evidence_inferred`, enforces fixed context and exact frozen group counts, and requires a matching hash for a graded source file. The canonical Run #4 / 1830 eval anchor is rejected.

## Market-distance generator and Gate B probe

`build_market_pairs.py` and `market_pairs.py` address the concrete Gate B failure mechanisms. Training-pair definitions use one shared ticker/book and vary only `distance_bps` across arms; the prescribed magnitude bands are 11–19 bps (strong) and 0.4–1.9 bps (weak), while sign pairs use equal-magnitude `+d`/`−d`. The expected action is derived from pair type/distance, not supplied as a prompt input.

For a `funds_propose` target, the generator selects the explicit side-specific ask: positive distance uses `yes_ask_cents`; negative distance uses `no_ask_cents`. It never computes NO ask as `100 - YES ask`. It preserves the exact ticker and uses JSON numbers—not numeric strings—for `price`, `probability`, and `max_stake`; `copySpans` preserve prompt facts where they are copied into the call. Tests deliberately inject a complement-price error and a digit/type corruption and require the probe scorer to fail.

The eval-only Gate B validator requires exactly 48 pairs (16 positive-magnitude, 16 negative-magnitude, 16 sign), matching the report’s 96-row structure. It refuses prompts or tickers found in either the full training mix or tranche-6. `market_pairs.py` also scores one model output per pair-arm, checking expected magnitude action flips, sign-to-side flips, exact ticker, side-specific ask, numeric integrity, and all expected proposal rows. Run the probe after obtaining the frozen pair/output files; do not train a pilot unless the verified probe passes.

Example training build, once the exact inputs are available:

```bash
python3 nexus-llm/synthetic-intuition/build_market_pairs.py graded-market-pairs.jsonl \
  --design frozen-mix-design.json \
  --design-sha256 frozen-mix-design.sha256 \
  --pack nexus-llm/synthetic-intuition/PACK-V1.1.md \
  --output market-pairs.jsonl \
  --report build-report.json
```

Example Gate B scoring, once Muse’s eval-only pair set and corresponding full-mix/tranche-6 files are supplied:

```bash
python3 nexus-llm/synthetic-intuition/market_pairs.py gate-b-pairs.jsonl gate-b-outputs.jsonl \
  --training-mix run31/data.jsonl \
  --tranche6 run31-campaign/data/desk-live-form-tranche6.jsonl \
  --pack nexus-llm/synthetic-intuition/PACK-V1.1.md \
  --report GATE-B-REPORT.json
```

Both build commands refuse to overwrite existing outputs. A build report records pack/design/source/output hashes and `training_started: false`.

## Tests

Run the standard-library tests without installing dependencies:

```bash
cd nexus-llm/synthetic-intuition
python3 -m unittest -v
```

The tests use temporary test-only source artifacts and verify metrics, pair geometry, 48-pair probe structure, NO-side ask selection, ticker/digit fidelity, and eval/training separation. They do not substitute for the absent Run 31 primary artifacts or an actual checkpoint probe.
