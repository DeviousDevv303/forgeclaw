# nexus-llm/train: step 4 preparation (pipeline only; NOT a trained NEXUS model)

Status: **PROPOSED scaffolding.** Everything here was exercised on **SYNTHETIC** data to prove that tokenizer, model, loss mask, decoder and scorer fit together.
No admitted data exists in this repo, no real row was used, and nothing here claims capability. Step 4 proper (and step 5) stay gated on the items in `docs`/the directive: admitted examples, the fine-tune comparator, and the operator.

| File | Role |
|---|---|
| `gen-synthetic-traces.ts` | Template traces, every row `synthetic:true`, dropped if the prompt matches a frozen-eval prompt. Writes only to `--out`. |
| `common.py` | Text frame (`User: <prompt>`, ordinary text, no new token) and the **loss mask**: the model is trained on route, call, evidence and answer; the frame and every runtime-injected `<|result:…|>…<|/result|>` span are masked. |
| `model.py` | Decoder-only transformer. `smoke` = 0.96M params; `small` = 4 layers, d_model 256, ctx 640, 4.35M params; `nexus-30m` = 8 layers, d_model 512, ctx 640 (low end of the directive's 30-60M target). |
| `train.py` | AdamW + cosine schedule, length-bucketed batches (5.6x faster on CPU than padding random batches to their longest row). **Refuses** rows not marked synthetic (unless `--allow-real`), and refuses to write checkpoints inside the repo. |
| `predict.py` | Greedy decode over the eval cases (stops at `<|/call|>` or `<|end|>`); writes predictions for `eval/score-cli.ts`. `--constrained` decodes through `constrain.py`. |
| `constrain.py` | Grammar-constrained decoding: route token first, canonical schema-valid call JSON, evidence limited to what the grammar's rules allow, then answer/end. Guarantees well-formed output (tested on an untrained model); does not pick the tool. |
| `test_train.py`, `test_constrain.py`, `gen.test.ts` | Guards: mask correctness, refusal guards, constrained-decoding guarantees, generator never emits a frozen-eval prompt, an invalid transcript, a hand-written evidence label or a placement claim. |

```
npx vite-node nexus-llm/train/gen-synthetic-traces.ts --out /tmp/syn.jsonl --n 3000
python nexus-llm/train/train.py   --data /tmp/syn.jsonl --out /tmp/ckpt --preset smoke --steps 400
python nexus-llm/train/predict.py --ckpt /tmp/ckpt/model.pt --cases nexus-llm/eval/v1/cases.jsonl --out /tmp/preds.jsonl
npx vite-node nexus-llm/eval/score-cli.ts /tmp/preds.jsonl
```
(needs `torch` and `sentencepiece` in a venv outside the repo.)

## Measured on this container (4 CPU cores, no GPU), 2026-10-27

### Run 2: `small` (4.35M params), tokenizer v1, 12,000 SYNTHETIC rows (seed 7), 3,000 steps × batch 32, lr 6e-4, ~27 min
Loss 8.32 → ~0.01 (it fits templated synthetic data almost exactly; that is the point of the caveats below).

| Suite | Decoding | Pass | Format | Schema-valid calls | Overclaim | Fabrication | Best naive policy | Gate |
|---|---|---|---|---|---|---|---|---|
| v1 (84) | plain | 46.4% | 88.1% | 76.2% | 3.8% | 0% | 21.4% | pass |
| v1 (84) | constrained | 48.8% | **100%** | **100%** | **0%** | 0% | 21.4% | pass |
| domains v1.1 (47) | plain | 51.1% | 80.9% | 72.2% | 5.0% | 0% | 12.8% | pass |
| domains v1.1 (47) | constrained | **66.0%** | 95.7% | **100%** | **0%** | 0% | 12.8% | pass |

Gate verdict (constrained and plain): **ELIGIBLE for the operator's decision**. Under the domain suite as FIRST frozen (v1, before the
recorded v1.1 correction of case dom1-evidence-002) the same predictions are **REJECTED** (constrained 63.8%, "fabricates on 7.1%"):
the one flagged answer was the truthful "Recorded p2 as a paper trade, so no real money moves." Both verdicts are reported on purpose.

What constrained decoding bought, measured: format 88→100% (v1), schema-valid calls 72–76→100%, overclaim 3.8–5.0→0%; pass +2.4 (v1)
and +14.9 points (domains). What it did not buy: tool choice (v1 24.2%, domains 57.7%) and owner-only commands (domains no_tool 0%:
the model never answered "type /funds …"). The 2 remaining domain format failures are runaway free text inside an argument that
exhausts the 160-token budget, a model-quality failure, not a grammar gap. Getting here took three decoder fixes found by this run
(top-k dead-ends, an unfinishable \u escape in option strings, a key in a property-less object).

### Run 1 (historical, tokenizer v0)
- `smoke` model, 400 steps, 3,000 synthetic rows, 46 s: loss 8.31 → 0.99. Frozen-eval pass **22.6%** (format 65.5%, tool_choice 3.0%, evidence 43.8%, honesty 33.3%, overclaim 36.2%, fabrication 0%).
  The trivial "never call a tool, always not_verified" policy scores 21.4%, so this model does **not** meaningfully beat the baseline: under the step-6 rule it would be rejected. That is the expected, honest result of a 46-second smoke run.
- `nexus-30m`: 27,530,240 parameters; about 0.5 s per step at batch 8 × ~100 tokens, i.e. roughly **1,500 tokens/s** on 4 cores. At 20 tokens/parameter (0.55B tokens) that is on the order of **100 CPU-hours**: training needs a GPU, off-device, as the directive says.

## What this does NOT show
- Anything about real behaviour: the synthetic traces share task families with the eval cases (different phrasings, filtered so no prompt is identical), so even a good score measures routing/format generalization, not independent capability. **ELIGIBLE on these numbers is not a reason to ship**: the model has seen no admitted data, and the gate's naive baselines are a floor, not a bar.
- That trading behaviour is safe in use: the domain suite checks answers (no placement claims, no unread prices), not live tool use. Trading stays PROPOSE-ONLY in this model's scope.
- That from-scratch beats a fine-tune. The required comparator (LoRA/QLoRA of a small open base, scored on the same frozen eval) is **not built**; its licence must be read before use.
- Constrained decoding exists only as the Python reference decoder (`constrain.py`); whether llama.cpp/Ollama/WebLLM grammar modes can express the same constraint is still unverified.
