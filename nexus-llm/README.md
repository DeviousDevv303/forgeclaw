# nexus-llm — NEXUS Intelligence (own-LLM track)

Standalone. Nothing in `src/` imports this directory. The only read of `src/` is `scripts/snapshot-tools.ts`
(read-only, one-way). Design law: behavior in weights, facts in CORPUS. See `spec/grammar.md`.

| Step | State |
|---|---|
| 1 Grammar spec | staged: `spec/`, `src/grammar.ts`, `src/grammar.test.ts` |
| 2 Tokenizer | staged: `tokenizer/` (v1, 4000-piece BPE on SYNTHETIC text: schemas + synthetic traces; 18 special tokens and all 50 tool names atomic) |
| 3 Exporter + frozen eval | staged: `exporter/` (format, dump script, exporter, token budget) and `eval/` (frozen v1, 84 cases; frozen domains-v1, 47 cases: trading propose-only + images; scorer, baselines). Waiting on the operator's app-store export file |
| decoding | staged: `train/constrain.py` (grammar-constrained decoding: well-formed output by construction; tool choice stays learned) |
| 6 rule | staged: `eval/gate.ts` + `eval/gate-cli.ts` (replace-only-if-better across every frozen suite; ELIGIBLE never means shipped) |
| coding eval | staged: `eval/coding/` (hermetic harness: simulated repo, executed hidden tests, discipline-and-honesty scorer, task-file validator). Held-out tasks to be authored by Muse |
| 4 prep | staged: `train/` (model, loss-masked training loop, predictor, synthetic-trace generator; smoke-tested on SYNTHETIC data only) |
| 4 run 2 | measured: `small` (4.35M) on 12k SYNTHETIC rows; constrained: v1 48.8%, domains v1.1 66.0%, format/schema 100%/100% on v1, overclaim 0%; gate ELIGIBLE (REJECTED under domains v1 before its recorded correction). See `train/README.md`. Not a ship decision |
| 4–6 proper | gated: needs admitted data, the fine-tune comparator, a GPU, and the operator |

```
# tokenizer (needs sentencepiece in a venv outside the repo):
#   npx vite-node nexus-llm/scripts/gen-synthetic-corpus.ts && python nexus-llm/tokenizer/train.py
#   python -m unittest nexus-llm/tokenizer/test_tokenizer.py
# exporter:  npx vite-node nexus-llm/exporter/export-cli.ts <store-export.json> --out <dir outside the repo>
# eval sets:  npx vite-node nexus-llm/eval/build-eval.ts [--check]    (v1; frozen: never train on it)
#             npx vite-node nexus-llm/eval/rebuild-pinned.ts build-eval.ts|build-domains.ts [--check]  (rebuild against the PINNED app once src/ has moved)
#             npx vite-node nexus-llm/eval/build-domains.ts [--check] (domains-v1: trading + images, results from the app's own code)
# score:      npx vite-node nexus-llm/eval/score-cli.ts <preds.jsonl> --suite v1|domains-v1
# gate:       npx vite-node nexus-llm/eval/gate-cli.ts --candidate <dir with v1.jsonl, domains-v1.jsonl> [--incumbent <dir>]
npx vitest run nexus-llm                                   # contract tests (also picked up by the repo-wide run)
npx vite-node nexus-llm/scripts/snapshot-tools.ts          # regenerate spec/tools.snapshot.json + tool-call.schema.json
npx vite-node nexus-llm/scripts/snapshot-tools.ts --check  # exit 1 if stale
npx vite-node nexus-llm/scripts/extract-manual-fixtures.ts # re-collect spec/fixtures from the repo's own tests
```

Training data custody: nothing here reads the browser corpus or any admitted candidate. Synthetic examples, when they
exist, live in a separate file with an explicit `synthetic: true` field and never enter a Guardian set. Every frozen suite's
prompts (`eval/frozen-prompts.ts`) are dropped from synthetic and exported training data by default.

Scope, stated plainly: image generation and trading are TOOL behaviours here. NEXUS learns to route to `generate_image` /
`analyze_image` (the repository's own Stable Diffusion and vision workflows) and to the funds/Kalshi tools; it does not generate
pixels itself. Trading is PROPOSE-ONLY: the model proposes, the owner approves and places (`/funds`). The domain suite fails any
answer that claims a placement or states a price it did not read.
