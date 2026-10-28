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

### Run 7: `small-copy-ind` (induction bias in the copy head) + case-diverse prompts, 30k rows, 5000 steps, from scratch
Per component vs incumbent run 4: domains v1.1 **74.5%** (run 4 76.6%; the BEST copy-head run, no_tool 100%, evidence 100%); v1 **63.1%**
(run 4 60.7%, above it); image calls carrying the requested words **2/5** (lighthouse, refinery; run 4 0/5, run 5 3/5); Kalshi query
fidelity **0/2**; loop 3/18 (noisy). Gate vs run 4: **REJECTED** (domains 2.1 pts below run 4). Run 4 stays incumbent.
Sharp diagnosis (confirms Kimi's prediction): the induction bias fixed STRUCTURE — capitalization and sentence shape now copy
("Generate an image of a red ... truck in the snow", "Render a cinematic wallpaper of a refinery at night") — but **rare/multi-piece
entity tokens still mangle**: pickup->"pic", wrench->"wren", beaver dropped, Fed->"Eed", bitcoin->"tidecoin". The copy head copies the
clean pieces and loses alignment on a word that splits into several BPE pieces. That is a tokenization/capacity limit, not a routing one.

**Plateau, stated plainly.** Four model iterations (runs 4-7) on the 4M CPU model have converged: routing ~75% on domains, copying
partial (2-3/5), rare-entity copy broken. None beats run 4 on the gate. The remaining levers are both operator-gated and not more CPU
runs: (a) capacity - `nexus-30m` needs a GPU; (b) admitted real data instead of synthetic templates; (c) a tokenization change so entity
words are single pieces (a tokenizer v2 = new ids = every checkpoint retrained). I am not launching run 8 on CPU; it would not move these.

### Run 6: run 5 warm-started

### Run 6: run 5 warm-started (`--init`), 30,000 fresh SYNTHETIC rows (seed 17), 6,000 steps, lr 4e-4, 53 min (resumed once after a restart)
Per component vs run 4 / run 5: image calls carrying the requested words **1/5** (0/5 / 3/5: a regression); domains v1.1 **68.1%** (76.6 / 68.1);
Kalshi query fidelity **0/2** (still garbled: "ro above itcoin above 1000k"); v1 **66.7%** (60.7 / 64.3: best so far); loop **4/18** (6 / 7;
n=18 is noisy). Gate vs run 4: **REJECTED**. Diagnosis: training loss ~1e-4, i.e. the templates are memorized; more steps on the same
distribution degrade copying (outputs degenerate into repetition, "refin at night at night"). Run 4 stays the incumbent. Next lever is
capacity and data diversity (nexus-30m on a GPU; admitted data), not more synthetic steps on 4M parameters.

### Run 5: `small-copy` (pointer-generator copy head, 4.48M params), same 20,000 rows, steps and lr as run 4, 50 min
Constrained: v1 **64.3%** (run 4: 60.7%; no_tool 40 → 80%), domains v1.1 **68.1%** (run 4: 76.6%: a regression, tool choice 65.4 → 53.8%).
Gate with `--incumbent` run 4: **REJECTED** (domains below the incumbent). Run 4 stays the incumbent.
Closed loop: **7/18** (run 4: 6/18). Copying works for the first time: **3/5 image prompts carry the requested words the model never saw
in training** (e.g. "Create a watercolor picture of a lighthouse at dawn" -> `"make a watercolor picture of a lighthouse at dawn"`, style
watercolor); copies are still noisy ("a beaver a damver a dam", "wrenchn") and the Kalshi queries are garbled ("Sed cutting", "C 100k").
That faithful call was dispatched UNEDITED to the repository's own `generate-image.yml` (invocation `nexus-run5-loop-img3`): workflow run
[40601203465](https://github.com/DeviousDevv303/forgeclaw/actions/runs/40601203465) **succeeded** (10 min, sd15, 512x512) and published
`generated-images/nexus-run5-loop-img3.png` (branch `generated-images` @ `2c4b697`): a watercolor lighthouse at dawn. That is the first image
rendered from a call NEXUS itself produced, end to end: user prompt -> model -> constrained call -> the app's own image workflow. Scope, stated:
1 of 5 image scenarios was faithful enough to send, and the model that produced it is gate-REJECTED as a runtime replacement.

### Run 4: `small`, 20,000 SYNTHETIC rows (router-labelled families, high-entropy arguments, seed 13), 5,000 steps, 47 min
Constrained: v1 **60.7%** (run 2: 48.8%), domains v1.1 **76.6%** (66.0%); format/schema 100%, overclaim 0%, fabrication 0%. Tool choice v1
24.2 → 57.6%; owner-only commands 0 → 66.7%; **regression: v1 no_tool 60 → 40%**. Gate with `--incumbent` run 2: ELIGIBLE.
Closed loop (18 scenarios, argument fidelity): **6/18** (run 2: 3/18 under the same scorer). Copying still fails: 0/5 image prompts and
0/2 Kalshi queries carried the requested (unseen) words. That is the blocking capability; no real image dispatch was made.
Run 3 (16k low-entropy rows) was stopped at step 1,000, superseded.

### Run 1 (historical, tokenizer v0)
- `smoke` model, 400 steps, 3,000 synthetic rows, 46 s: loss 8.31 → 0.99. Frozen-eval pass **22.6%** (format 65.5%, tool_choice 3.0%, evidence 43.8%, honesty 33.3%, overclaim 36.2%, fabrication 0%).
  The trivial "never call a tool, always not_verified" policy scores 21.4%, so this model does **not** meaningfully beat the baseline: under the step-6 rule it would be rejected. That is the expected, honest result of a 46-second smoke run.
- `nexus-30m`: 27,530,240 parameters; about 0.5 s per step at batch 8 × ~100 tokens, i.e. roughly **1,500 tokens/s** on 4 cores. At 20 tokens/parameter (0.55B tokens) that is on the order of **100 CPU-hours**: training needs a GPU, off-device, as the directive says.

## What this does NOT show
- Anything about real behaviour: the synthetic traces share task families with the eval cases (different phrasings, filtered so no prompt is identical), so even a good score measures routing/format generalization, not independent capability. **ELIGIBLE on these numbers is not a reason to ship**: the model has seen no admitted data, and the gate's naive baselines are a floor, not a bar.
- That trading behaviour is safe in use: the domain suite checks answers (no placement claims, no unread prices), not live tool use. Trading stays PROPOSE-ONLY in this model's scope.
- That from-scratch beats a fine-tune. The required comparator (LoRA/QLoRA of a small open base, scored on the same frozen eval) is **not built**; its licence must be read before use.
- Constrained decoding exists only as the Python reference decoder (`constrain.py`); whether llama.cpp/Ollama/WebLLM grammar modes can express the same constraint is still unverified.
