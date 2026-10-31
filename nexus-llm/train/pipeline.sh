#!/bin/bash
# One NEXUS training run end to end, reproducible from the repo by any lane (no container state needed):
#   synthetic data -> resumable training -> constrained predictions on every frozen suite -> gate -> closed loop.
#   nexus-llm/train/pipeline.sh <work-dir OUTSIDE the repo> <preset> <rows> <seed> <steps> <lr> [incumbent-preds-dir] [init-checkpoint]
# GEN_ARGS passes extra flags to the generator (e.g. GEN_ARGS='--nonce generated').
# Example (run 7): nexus-llm/train/pipeline.sh /tmp/run7 small-copy-ind 30000 23 5000 6e-4 /tmp/run4/eval
# Needs: node + npm deps (repo root), python3 with torch and sentencepiece (set PY=/path/to/venv/python), ~1 h on 4 CPU cores for small.
# Re-run the same command after a restart: training resumes from <work-dir>/ckpt/resume.pt and finished stages are skipped.
# Outputs: <work-dir>/eval/{v1,domains-v1}.jsonl, gate.txt, loop.jsonl, loop.txt, dispatch.jsonl (image calls recorded, never sent).
set -euo pipefail
W=${1:?work dir}; PRESET=${2:?preset}; ROWS=${3:?rows}; SEED=${4:?seed}; STEPS=${5:?steps}; LR=${6:?lr}; INCUMBENT=${7:-}; INIT=${8:-}
PY=${PY:-python3}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$W/eval"
case "$(cd "$W" && pwd)/" in "$ROOT"/*) echo "work dir must be outside the repo" >&2; exit 2 ;; esac
cd "$ROOT"
[ -f "$W/data.jsonl" ] || npx vite-node nexus-llm/train/gen-synthetic-traces.ts --out "$W/data.jsonl" --n "$ROWS" --seed "$SEED" ${GEN_ARGS:-}
cd nexus-llm/train
if [ ! -f "$W/ckpt/model.pt" ]; then
  EXTRA=(); [ -f "$W/ckpt/resume.pt" ] && EXTRA+=(--resume); [ -n "$INIT" ] && EXTRA+=(--init "$INIT")
  "$PY" train.py --data "$W/data.jsonl" --out "$W/ckpt" --preset "$PRESET" --steps "$STEPS" --batch 32 --lr "$LR" --save-every 500 "${EXTRA[@]}" | tee -a "$W/train.log"
fi
for s in v1 domains-v1; do [ -s "$W/eval/$s.jsonl" ] || "$PY" predict.py --ckpt "$W/ckpt/model.pt" --cases "../eval/$s/cases.jsonl" --out "$W/eval/$s.jsonl" --constrained; done
[ -s "$W/loop.jsonl" ] || "$PY" loop.py --ckpt "$W/ckpt/model.pt" --out "$W/loop.jsonl" --dispatch-log "$W/dispatch.jsonl"
cd "$ROOT"
{ for s in v1 domains-v1; do echo "== $s"; npx vite-node nexus-llm/eval/score-cli.ts "$W/eval/$s.jsonl" --suite "$s" | head -3; done
  echo "== gate"; npx vite-node nexus-llm/eval/gate-cli.ts --candidate "$W/eval" ${INCUMBENT:+--incumbent "$INCUMBENT"} || true; } | tee "$W/gate.txt"
npx vite-node nexus-llm/eval/loop/score-loop-cli.ts "$W/loop.jsonl" | tee "$W/loop.txt"
