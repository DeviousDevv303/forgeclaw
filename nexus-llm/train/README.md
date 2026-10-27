# nexus-llm/train: step 4 preparation (pipeline only; NOT a trained NEXUS model)

Status: **PROPOSED scaffolding.** Everything here was exercised on **SYNTHETIC** data to prove that tokenizer, model, loss mask, decoder and scorer fit together.
No admitted data exists in this repo, no real row was used, and nothing here claims capability. Step 4 proper (and step 5) stay gated on the items in `docs`/the directive: admitted examples, the fine-tune comparator, and the operator.

| File | Role |
|---|---|
| `gen-synthetic-traces.ts` | Template traces, every row `synthetic:true`, dropped if the prompt matches a frozen-eval prompt. Writes only to `--out`. |
| `common.py` | Text frame (`User: <prompt>`, ordinary text, no new token) and the **loss mask**: the model is trained on route, call, evidence and answer; the frame and every runtime-injected `<|result:…|>…<|/result|>` span are masked. |
| `model.py` | Decoder-only transformer. `smoke` = 0.96M params; `nexus-30m` = 8 layers, d_model 512, **27.5M params** (low end of the directive's 30-60M target). |
| `train.py` | AdamW + cosine schedule. **Refuses** rows not marked synthetic (unless `--allow-real`), and refuses to write checkpoints inside the repo. |
| `predict.py` | Greedy decode over the eval cases (stops at `<|/call|>` or `<|end|>`); writes predictions for `eval/score-cli.ts`. |
| `test_train.py`, `gen.test.ts` | Guards: mask correctness, refusal guards, generator never emits an eval prompt or an invalid transcript. |

```
npx vite-node nexus-llm/train/gen-synthetic-traces.ts --out /tmp/syn.jsonl --n 3000
python nexus-llm/train/train.py   --data /tmp/syn.jsonl --out /tmp/ckpt --preset smoke --steps 400
python nexus-llm/train/predict.py --ckpt /tmp/ckpt/model.pt --cases nexus-llm/eval/v1/cases.jsonl --out /tmp/preds.jsonl
npx vite-node nexus-llm/eval/score-cli.ts /tmp/preds.jsonl
```
(needs `torch` and `sentencepiece` in a venv outside the repo.)

## Measured on this container (4 CPU cores, no GPU), 2026-10-27
- `smoke` model, 400 steps, 3,000 synthetic rows, 46 s: loss 8.31 → 0.99. Frozen-eval pass **22.6%** (format 65.5%, tool_choice 3.0%, evidence 43.8%, honesty 33.3%, overclaim 36.2%, fabrication 0%).
  The trivial "never call a tool, always not_verified" policy scores 21.4%, so this model does **not** meaningfully beat the baseline: under the step-6 rule it would be rejected. That is the expected, honest result of a 46-second smoke run.
- `nexus-30m`: 27,530,240 parameters; about 0.5 s per step at batch 8 × ~100 tokens, i.e. roughly **1,500 tokens/s** on 4 cores. At 20 tokens/parameter (0.55B tokens) that is on the order of **100 CPU-hours**: training needs a GPU, off-device, as the directive says.

## What this does NOT show
- Anything about real behaviour: the synthetic traces share task families with the eval cases (different phrasings, filtered so no prompt is identical), so even a good score would measure routing/format generalization, not independent capability.
- That from-scratch beats a fine-tune. The required comparator (LoRA/QLoRA of a small open base, scored on the same frozen eval) is **not built**; its licence must be read before use.
- Constrained decoding is not implemented here; whether llama.cpp/Ollama/WebLLM accept `spec/tool-call.schema.json` is still unverified.
