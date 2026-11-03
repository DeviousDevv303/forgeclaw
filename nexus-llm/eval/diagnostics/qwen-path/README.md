# Qwen path check (2026-11-03; diagnostic, grades nothing)

Two real pieces joined at the mirror files:
1. `run_embedded.py` runs the real embedded script of `.github/workflows/qwen3-8b.yml` on the real Qwen3-8B Q4_K_M GGUF (llama.cpp, CPU). Only torch/transformers/huggingface_hub are stubbed. Result: `result.txt` ("17 times 23 is 391."), `result_meta.txt` (model `Qwen/Qwen3-8B`, 13 tokens, not budget-stopped).
2. `ui_e2e.cjs` drives the production build in Chromium (`vite preview`), types the question into the chat, and answers `api.github.com` / `raw.githubusercontent.com` from a stand-in that serves those two files. `ui_log.json` is the network record; `chat-ui.png` the screen.

Not covered: GitHub itself. `workflow_dispatch` on `qwen3-8b.yml` needs the file on `main`, so a real dispatch is only possible after the merge. Also `budget-1500` lives in `../swarm-time-budget/`.

## UI latency (added 2026-11-03)
`ui_latency.cjs` measures how long after the workflow publishes its result the chat shows the answer (GitHub stand-in; the model and runner are not involved). Before (30/45/60 s polling): answer shown **10.2 s, 25.5 s, 35.3 s** after publish for runs finishing at 20 s, 50 s, 100 s (`ui_latency_before.json`). After (5/5/8/10/15 s): **8.6 s, 9.1 s, 3.4 s** (`ui_latency_after.json`); the worst wait is now bounded by the 15 s cap instead of 60 s. `first_real_run_meta.txt` is the meta of the first real run of qwen3-8b.yml on main (run 41716503183).
