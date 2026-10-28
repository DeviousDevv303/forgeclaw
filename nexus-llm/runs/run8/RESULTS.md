# Run 8 — RESULTS

Preset `small-copy-ind` · 4,479,234 params · 30,000 rows · seed 24 · 5,000 steps · LR 6e-4 · copy rows 15,491

## Technique (writer-side design only)
1. **Nonce augmentation** — 48 invented words in the generator, verified DISJOINT from the frozen eval suites.
2. **Mode tokens** — `<|mode:copy|>` / `<|mode:create|>` added to `nexus-llm/spec/special-tokens.json`.
3. **Copy-token loss weighting 2.0×** — `COPY_LOSS_WEIGHT` in `nexus-llm/train/common.py` (`encode_row_w`).

## Gate (from gate.txt, this directory)
| suite | pass | format | schema | overclaim | fabrication |
|---|---|---|---|---|---|
| general v1 | **67.9%** | 98.8% | 100.0% | 0.0% | 0.0% |
| domains-v1 | **76.6%** | 100.0% | 100.0% | 0.0% | 0.0% |

Closed loop: 10/18 scenarios (55.6%).
Comparators: run 7 replicate 65.5 / 72.3 · run 4 (incumbent) 60.7 / 76.6 — **run 4's domains score was on domains-v1.1; run 8's is on domains-v1.**

## Verdict — DO NOT PROMOTE (Claude, 2026-10-28)
76.6% on domains-v1 is not a win over run 4's 76.6% on domains-v1.1 — different suites; methodology decides it without the checkpoint. Replace-only-if-better is not met. Run 4 remains incumbent. General 67.9% is the best general score recorded and is noted for the run-9 design.

## Interruption history (disclosed)
Training was killed three times and resumed from checkpoints: (1) first process killed mid-train, resumed from checkpoint 2999/3000; (2) resume-2 killed by a runtime restart at step 4550 (checkpoint held step 4500); (3) resume-3 completed the full 5,000 steps and the pipeline's predict + loop + gate stages ran automatically.

## Artifacts
- data.jsonl SHA-256: `0530dabb63003a4ee91e59134086f5bc39c6ee0b7bdf013b24b586de681813cd`
- model.pt SHA-256: `eb652a975b9916384116373b7e3790cdca2589309ec94144b49c763ae6fc822b` — **not pushed** (checkpoint residency policy); trained checkpoint lives at `~/workspace/run8/ckpt/model.pt` on the Muse VM.
- This directory: gate.txt, loop.txt, loop.jsonl, dispatch.jsonl, eval/v1.jsonl, eval/domains-v1.jsonl, train.log, resume-3.log.

## Code state
The run-8 technique lived only as uncommitted working-tree changes in the audit clone until this close-out commit (train/tokenizer files). Committed by Muse for preservation and reproducibility, so Claude's proposed combination experiment (run-8 technique × run-7 induction bias, targeting the rare-entity copy failure) can run from the branch. One exception: `nexus-llm/tokenizer/nexus.model` is a binary SentencePiece model and the connector snapshot is UTF-8-only, so it is NOT carried in this commit; its bytes remain in the audit clone's working tree and it is regenerable via the tokenizer training path in this tree. `nexus.vocab` (text) is committed.

## First reads — PENDING
Unrestriction benchmark, capbench v1, and AFFECT v1 on this checkpoint have NOT been run yet. Owed; Claude went dark again (usage limits) on 2026-10-28 shortly after delivering the verdict.
