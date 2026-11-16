# Handoff to Muse — Phase C / Issue #235

**State:** Pack-based re-grade completed; follow-up audit changes are being prepared from current `main` (`233208dd`). PR #442 has merged at `233208ddd67c8adb3e64b6ad20ae2a2f135adaad`. This handoff is **not** a pilot approval: Gate A fails, Gate B is only summary-consistent, and the current generators are blocked by a grammar/spec conflict.

## Completed in this handoff

- Verified `PACK-V1.1.md` SHA-256: `df158f084162069733896724163c7703a89593e788d21749f7e4dba7b3214654`.
- Regraded Gate A against v1.1 §10 using the committed reproduction output: 0/2,410 recognition-only pairs; route-before-recognition 5,000/5,000 tranche-6 and 31,013/31,013 full mix; `funds_propose`-before-recognition 2,347/2,347 and 18,424/18,424; NO-side ask mismatch 893/1,184 (75.4%, max 2.9¢). Gate A does not pass.
- Added `audit_gate_b.py` and tests for the actual flat 96-row Gate B pair file. Pair geometry passes structural checks (48 pairs, 16 per family; only distance varies within each pair). The published summary reconciles to 24/96 correct and 0/48 full flips, but raw model outputs are still needed for independent reproduction.
- Replaced the obsolete conditional report with a pack-based `GATE-REVIEW.md` and corrected `README.md`.

## Blocking issues — do not train or promote

1. **§10 order conflict:** the pack requires recognition before the route token in every completion. `src/grammar.ts` and `train/constrain.py` currently require route-first output; the merged pair builders also put recognition in the prompt and emit route first. The current outputs therefore fail §10. Muse/spec owner must authorize a grammar/decoder change and tests, or resolve it via a new pack version. Do not count prompt text as emitted completion text.
2. **§12 evaluator mismatch:** `score.py` currently accepts an arbitrary five-threshold criteria file, which is not the frozen five-criterion pilot contract. Before a pilot, register the baseline comparison metric, meaningful-volume definition, frozen benchmark set/directions, per-regime denominators, and cap-fire denominator; do not invent them in a post-hoc criteria file.
3. **Raw evidence pending:** full Run 31 mix, tranche-6 source rows/build manifest, full Gate A report, and `gate-b-outputs.jsonl` are not present here. Muse said the Gate A report and Gate B outputs will land in a follow-up PR; checkpoint replay is on Muse’s machine. The checkpoint itself is not requested unless its published outputs leave a specific grading question unresolved.

## Next actions for Muse

- Add the full Gate A report and `gate-b-outputs.jsonl` to the promised follow-up PR; notify on Issue #235.
- Once those artifacts land, rerun the Gate B grading from raw outputs and update the Issue #235 grade. Rerun Gate A only if the raw inputs/report enable checks beyond the committed reproduction output.
- Decide the §10 transcript/decoder resolution before any generator output enters training.
- Replace the generic scorer criteria interface with a gate that implements the exact §12 criteria and refuses a pass when a required operational definition or denominator is absent.
- Keep the pilot stopped until Gate A generator proof and the §10 recognition-before-act order pass.

Current review and implementation notes: [GATE-REVIEW.md](./GATE-REVIEW.md), [README.md](./README.md). The follow-up PR link will be added to the Issue #235 comment after publication.
