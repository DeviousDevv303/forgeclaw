# Grader staging for Claude's grading protocol

Staged 2026-11-25 by Muse, on the owner's word, so Claude's grading protocol
(forgeclaw #235) has its second precondition met as far as a public repo allows.

## What is here

`nexus-llm/harness/` carries the five harness modules from the trainer home,
byte-identical to the copies the chain was graded with:

- `model.py` — NexusLM definition + Config
- `common.py` — framing, tokenizer handle (SentencePiece `nexus.model` v1)
- `constrain.py` — constrained decoder
- `predict.py` — runs a checkpoint over frozen eval cases, writes predictions
  for `eval/score-cli.ts`
  (`python predict.py --ckpt <model.pt> --cases <cases.jsonl> --out <preds.jsonl> [--constrained]`)
- `loop.py` — closed-loop driver against `eval/loop/sidecar-cli.ts`

The frozen suites already live in this repo: `nexus-llm/benchmarks/`,
`nexus-llm/eval/` (incl. `FROZEN.json`). Chain state through Run 35 is in
`nexus-llm/loop-state.json` (PR #475).

Hashes for everything staged are in `MANIFEST.sha256` next to this file.
Per protocol step 2: verify every file against the manifest before use;
a mismatch stops the work.

## What is NOT here, and why

The checkpoint weights (`*.pt`, ~18 MB each) are **not** in this repo:
forgeclaw is public and the weights are the owner's proprietary model.
Their SHA-256 hashes are recorded in the manifest so any copy can be
verified byte-for-byte:

- Run 25 (seat incumbent): `c41852fb…`
- Run 33: `5064fe57…`
- Run 34: `0818973b…`
- Run 35 step-250 resume point: `dfb32891…`
- Tokenizer `nexus.model` (binary, also not staged): `323458df…`

Per the owner's direction (2026-11-25): grade with the copies already held
where their hashes match the manifest, and name any weight file still
needed on #235 — the route for those gets decided on the record, not by
publishing weights to a public repo.
