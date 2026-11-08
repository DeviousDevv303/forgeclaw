# Nexus LLM — run records

One directory per graded run of the Nexus training loop. Each holds the run's `DESIGN.md` (build brief + its bars), `verdict.md`, `unrestrict-report.md`, and — for run 25, the loop's final and best-domains run — the full record set including `ckpt/model.pt`, scores, gate and loop outputs, and its `build_dataset.py`.

- `incumbent-run8-eval/` — run 8's frozen-suite predictions; the gate baseline (`--incumbent`) for every run graded so far.
- The authoritative loop state (all verdicts, all incidents, completion flag) is `nexus-llm/loop-state.json`.
- How any lane runs any of this alone: `nexus-llm/SOLO-RUNBOOK.md`.
