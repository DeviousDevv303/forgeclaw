#!/bin/bash
# Nexus loop — solo wrapper (owner order 2026-11-08: either lane can continue without the other).
# A stage-for-stage mirror of the pipeline runs 9-25 executed (train/pipeline.sh + the
# run-25 pipeline), with the unrestriction predict folded in as a final stage.
# SINGLE DEVIATION from pipeline.sh, inherited from the run-25 pipeline: train.py is given
# --allow-real, because run datasets contain operator-authorized real rows (traces-v1,
# reshaped) and train.py refuses any non-synthetic row without the flag.
#
# Usage:
#   RUN=run25 MODE=grade bash nexus-llm/loop-tree/train/run-loop.sh
#   RUN=run26 MODE=train bash nexus-llm/loop-tree/train/run-loop.sh
# Env: PY (python with torch+sentencepiece; default python3), STEPS (default 5000).
set -euo pipefail
RUN=${RUN:?set RUN, e.g. RUN=run25}
MODE=${MODE:-grade}
STEPS=${STEPS:-5000}
PY=${PY:-python3}
TRAIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"          # .../nexus-llm/loop-tree/train
TREE="$(dirname "$TRAIN_DIR")"                                       # .../nexus-llm/loop-tree
REPO_ROOT="$(cd "$TREE/../.." && pwd)"                               # repo root (loop-tree is nexus-llm/loop-tree)
W="$REPO_ROOT/nexus-llm/runs/$RUN"
INCUMBENT="$REPO_ROOT/nexus-llm/runs/incumbent-run8-eval"
mkdir -p "$W/eval" "$W/ckpt"
cd "$TRAIN_DIR"
if [ "$MODE" = "train" ] && [ ! -f "$W/ckpt/model.pt" ]; then
  EXTRA=(); [ -f "$W/ckpt/resume.pt" ] && EXTRA+=(--resume)
  "$PY" train.py --data "$W/data.jsonl" --out "$W/ckpt" --preset small-copy-ind --steps "$STEPS" --batch 32 --lr 6e-4 --save-every 500 --allow-real "${EXTRA[@]}" | tee -a "$W/train.log"
fi
[ -f "$W/ckpt/model.pt" ] || { echo "no checkpoint at $W/ckpt/model.pt (MODE=$MODE)" >&2; exit 1; }
for s in v1 domains-v1; do [ -s "$W/eval/$s.jsonl" ] || "$PY" predict.py --ckpt "$W/ckpt/model.pt" --cases "../eval/$s/cases.jsonl" --out "$W/eval/$s.jsonl" --constrained; done
[ -s "$W/loop.jsonl" ] || "$PY" loop.py --ckpt "$W/ckpt/model.pt" --out "$W/loop.jsonl" --dispatch-log "$W/dispatch.jsonl"
[ -s "$W/unrestrict-predictions.jsonl" ] || "$PY" predict.py --ckpt "$W/ckpt/model.pt" --cases "../eval/unrestrict-v1.jsonl" --out "$W/unrestrict-predictions.jsonl" --constrained
cd "$REPO_ROOT"
{ for s in v1 domains-v1; do echo "== $s"; npx vite-node nexus-llm/loop-tree/eval/score-cli.ts "$W/eval/$s.jsonl" --suite "$s" | head -3; done
  echo "== gate"; npx vite-node nexus-llm/loop-tree/eval/gate-cli.ts --candidate "$W/eval" --incumbent "$INCUMBENT" || true; } | tee "$W/gate.txt"
npx vite-node nexus-llm/loop-tree/eval/loop/score-loop-cli.ts "$W/loop.jsonl" | tee "$W/loop.txt"
echo "DONE: $W (gate.txt, loop.txt, eval/, unrestrict-predictions.jsonl)"
