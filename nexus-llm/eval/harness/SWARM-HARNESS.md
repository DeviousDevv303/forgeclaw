# Nexus C3 Swarm Harness

The benchmark remains unchanged at `nexus-llm/benchmarks/eval-swarm.jsonl` (25 rows; SHA-256 `e5ba5013dd99f3a1b39b7d163c19e556405966e69a5dcbd08a2ed1c9b62b4adb`). The harness has two intentionally separate evidence modes.

`nexus_formation_batch.py` dispatches one first-segment Run 25 generation for every frozen row through the repository's `nexus-intelligence.yml` workflow. It refuses a benchmark hash mismatch, uses empty context and `mirror=false`, saves the raw result and run metadata, and never executes model-formed tools or child tasks. This captures formation evidence without performing benchmark write/create actions. It is not a full closed-loop C3 gate because it cannot observe multi-spawn sequences, returned child findings, or parent synthesis.

`live_swarm_probe.py` runs the exact frozen prompts for `sw-020` (web research plus workflow audit) and `sw-016` (parallel investigation of the learning warning) through the deployed ForgeClaw UI. Each probe uses a fresh ephemeral Chromium context. It reads `GH_TOKEN` from the environment, injects it into that context only, and never includes request headers in evidence files. The network guard permits only GET/HEAD/OPTIONS plus dispatches to `nexus-intelligence.yml`, `ddg_search.yml`, and `deep-research.yml`; other non-read requests return HTTP 451 from the harness boundary. The probes never call the Nexus formation-only runner's benchmark rows with live write/create behavior.

`swarm_grade.py` parses the production `<|call|>…<|/call|>` grammar and checks each captured trace against its original row. It preserves malformed calls verbatim, applies the frozen row's spawn count, tool grant, required brief facts, sw-016 self-containment, sw-017 transport rule, restraint rows, and read-only rules, and labels what is structurally observed versus not assessed. It does not infer that a tool ran or that a parent synthesized a return from a model claim.

## Setup and commands

Use Python 3.10 or newer. Install Playwright and its Chromium runtime for the UI probes:

```bash
python3 -m pip install playwright
python3 -m playwright install chromium
```

Set `GH_TOKEN` in the shell without placing its value in a command, prompt, file, screenshot, or log. The token needs permission to dispatch the Nexus workflow, read its results/artifacts, and execute the read-only search/research workflows used by the probes.

Run the focused evaluator tests:

```bash
PYTHONPATH=nexus-llm/eval/harness python3 -m unittest discover -s nexus-llm/eval/harness -p 'test_swarm_grade.py' -v
```

Run the read-only first-segment benchmark:

```bash
python3 nexus-llm/eval/harness/nexus_formation_batch.py
```

The runner checkpoints `dispatch-manifest.jsonl` as rows are accepted and saves workflow status during polling. If artifact collection is interrupted, resume from that manifest without dispatching duplicate runs:

```bash
python3 nexus-llm/eval/harness/nexus_formation_batch.py \
  --resume-manifest nexus-llm/eval/results/<run-folder>/dispatch-manifest.jsonl \
  --out-dir nexus-llm/eval/results/<run-folder>
```

Run both deployed-app probes (or choose `--probe A` or `--probe B`):

```bash
python3 nexus-llm/eval/harness/live_swarm_probe.py --probe all
```

Both runners write timestamped evidence folders under `nexus-llm/eval/results/` by default. Preserve raw JSON and screenshot evidence; do not edit the frozen benchmark to fit a result. For a report, cite the precise invocation and artifact paths. Treat failed model formation as model evidence; only repair verified transport/wiring defects.

## Current implementation boundaries

This harness tests only the Nexus, DuckDuckGo search, and deep-research workflows needed by the assigned probes. It does not claim that every ForgeClaw workflow was exercised. Any post to GitHub Actions other than the three explicitly allowed workflows, or any other non-read-only request, is blocked during live probing. The owner-requested protected-path authorization does not permit changes to Guardian; this task keeps all code changes in the harness unless an observed transport/wiring defect requires a narrowly scoped fix.
