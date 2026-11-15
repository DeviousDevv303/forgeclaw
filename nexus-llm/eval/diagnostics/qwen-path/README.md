# Qwen path check (2026-11-03; diagnostic, grades nothing)

Two real pieces joined at the mirror files:
1. `run_embedded.py` runs the real embedded script of `.github/workflows/qwen3-8b.yml` on the real Qwen3-8B Q4_K_M GGUF (llama.cpp, CPU). Only torch/transformers/huggingface_hub are stubbed. Result: `result.txt` ("17 times 23 is 391."), `result_meta.txt` (model `Qwen/Qwen3-8B`, 13 tokens, not budget-stopped).
2. `ui_e2e.cjs` drives the production build in Chromium (`vite preview`), types the question into the chat, and answers `api.github.com` / `raw.githubusercontent.com` from a stand-in that serves those two files. `ui_log.json` is the network record; `chat-ui.png` the screen.

Not covered: GitHub itself. `workflow_dispatch` on `qwen3-8b.yml` needs the file on `main`, so a real dispatch is only possible after the merge. Also `budget-1500` lives in `../swarm-time-budget/`.

## UI latency (added 2026-11-03)
`ui_latency.cjs` measures how long after the workflow publishes its result the chat shows the answer (GitHub stand-in; the model and runner are not involved). Before (30/45/60 s polling): answer shown **10.2 s, 25.5 s, 35.3 s** after publish for runs finishing at 20 s, 50 s, 100 s (`ui_latency_before.json`). After (5/5/8/10/15 s): **8.6 s, 9.1 s, 3.4 s** (`ui_latency_after.json`); the worst wait is now bounded by the 15 s cap instead of 60 s. `first_real_run_meta.txt` is the meta of the first real run of qwen3-8b.yml on main (run 41716503183).

## Full-stack check after the workflow rename (2026-11-04)
Pre-merge, on the real runner, from the branch ref (a workflow can be dispatched from a branch once its file exists on `main`): chat (`qwen-…-prea02`), exam-mode dry run (`swarm-dryrun-qwen-pre02`: `swarm_dispatch_clean.py` reports **clean**, scaffold hashes equal the anchors), and the forced slow-fallback engine (`qwen-…-prefb2`: the on-demand torch install works; the answer is labelled DEGRADED). Their result and meta files are on `qwen-results`; `ui_full.cjs` renders them in the production build (`ui_full_results.json`, screenshots `ui-S*.png`). **A first run found a real bug:** a sparse checkout made the mirror publish fail silently (the step is `continue-on-error`); fixed, and a publish failure now raises a `::warning::`.
