# Synthetic Intuition — scoring and pair-generation tools

This directory tracks the Phase C work from [ForgeClaw Issue #235](https://github.com/DeviousDevv303/forgeclaw/issues/235). Muse’s latest directive is [comment 6904925988](https://github.com/DeviousDevv303/forgeclaw/issues/235#issuecomment-6904925988).

## Frozen pack and committed evidence

`PACK-V1.1.md` is present and pinned to SHA-256 `df158f084162069733896724163c7703a89593e788d21749f7e4dba7b3214654`; `PACK-V1.1-ERRATA.md` is also present. The Gate A reproduction script/output and Gate B pair/summary artifacts are committed beside them. The pack hash is verified by the audit scripts.

`GATE-REVIEW.md` contains the pack-based grade and clearly distinguishes published-summary consistency from a raw-data/model-output reproduction. The Gate A Run 31 source files and full report, Gate B raw outputs, and checkpoint remain unavailable in this checkout per Muse’s handoff.

## Gate B artifact audit

The committed `gate-b-pairs.jsonl` is a flat 96-row file (48 pairs), not a 48-row nested-pair file. `audit_gate_b.py` checks the actual schema, pair geometry, distance-only prompt variation, expected-label/family counts, pack hash, and internal consistency of `gate-b-summary.json`. The family identifiers are exact: `magnitude_pos`, `magnitude_neg`, and `sign`; the retired prose labels positive-magnitude/negative-magnitude are not accepted as data. It deliberately reports `raw_output_reproduced: false`: the summary can be reconciled to the pair artifact, but independent output grading requires Muse’s `gate-b-outputs.jsonl`.

```bash
cd nexus-llm/synthetic-intuition
python3 audit_gate_b.py gate-b-pairs.jsonl gate-b-summary.json --report GATE-B-AUDIT.json
```

A structurally consistent summary with 0/48 flips remains a reported checkpoint failure/diagnostic under §13, not a pass for the model. The audit also finds 24 unique tickers reused across the 48 pairs; training-mix disjointness cannot be checked without the Run 31 source rows.

## Scorer status — §12 criteria

`score.py` computes row-level behavior metrics by regime, with explicit numerators and denominators, including false surrender versus false persistence, recognition/action ordering, fold latency, hold depth, rank-change accuracy, clamp interventions and clamp-rescued rows.

The exact five frozen pilot criteria in §12 are: beat the frozen baseline on identical rows; zero exam-raw violations at meaningful volume; no regression on any existing frozen benchmark; per-regime calibration with denominators; and a journaled cap-fire rate, with a clamp-rescued-only pass void. `score.py` now accepts only the canonical five-criterion contract (`synthetic-intuition-frozen-pilot-v1`); arbitrary metric/operator/threshold JSON is rejected. Criteria whose baseline, meaningful-volume, benchmark, or calibration evidence has not been registered remain `not-evaluable`, never a pass. The scorer never invents those operational choices or a denominator.

## Generator status — do not train from current output

`build_pairs.py` and `build_market_pairs.py` contain provenance, design-count, and minimal-pair checks, but their current transcript targets begin with `<|route:...|>` while recognition is only in the prompt. That conflicts with v1.1 §10, which requires the recognition element to precede the route token in every emitted completion. The canonical parser in `nexus-llm/src/grammar.ts` and constrained decoder in `nexus-llm/train/constrain.py` currently require route-first output.

Consequently, the generators are not cleared for a training mix or pilot. Resolve this by deliberately updating and testing the transcript grammar/decoder to support a recognition-first completion, or by obtaining an authorized spec-owner resolution. Do not work around the gate by counting prompt text as emitted completion text. The training generator’s NO-side operative ask must also be explicit in the prompt for every proposal row.

## Handoff and validation

See `HANDOFF.md` for current branch/PR state, verified results, missing source artifacts, and specific next actions for Muse. Run the standard-library tests with:

```bash
cd nexus-llm/synthetic-intuition
python3 -m unittest -v
python3 -m py_compile *.py
```
