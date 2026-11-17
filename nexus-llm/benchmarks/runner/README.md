# SPEC-gates runner

Implements the harness in `../SPEC.md` (Nexus Coding + Swarm Benchmark Pack):
gates **C1 CODING-SHELL**, **C2 CODING-PATCH**, **C3 SWARM** over the frozen
eval files. Built by Muse on the Item 1 takeover (owner ruling, 2026-11-17)
after the assigned lane stalled twice without a branch or checkpoint.

## Run it

```bash
# 1. Prove the scorer before trusting any grade (no model involved):
~/workspace/nexus-taste/.venv/bin/python run_gates.py fixture

# 2. Grade a checkpoint end to end:
~/workspace/nexus-taste/.venv/bin/python run_gates.py all \
  --ckpt ~/workspace/run25/ckpt/model.pt \
  --subject "Run 25 (seated checkpoint c41852fb)" \
  --out-dir ~/workspace/run25/spec-gates
```

`generate` and `score` also run separately; `score` needs only a preds file.

## Design decisions (each traceable to the SPEC)

- **Unconstrained greedy decoding.** The gates grade the model's own
  formations; `predict.py --constrained` manufactures well-formedness and
  would void the measurement. Full turn captured (stop at `<|end|>` only) —
  a swarm formation is several calls in one turn.
- **Mode presentation follows the run mixes**: `create` for shell/patch rows,
  `copy` for swarm rows (briefs carry prompt material verbatim).
- **C1 two-turn feedback** uses the row's recorded result — the frozen KEY
  command run in the pinned checkout — never the model's own command. The
  grounded-answer rate is computed only over command-correct rows and is
  reported, not gated (SPEC, Gate C1 format paragraph).
- **C2 instruments are the repository's own**: `checkUnifiedDiff` from the
  pinned checkout via `check_diff.ts` (vite-node), `git apply --check` in a
  pristine worktree of the pin, and byte-equality of the applied result
  against the key patch applied in a twin worktree.
- **The pinned checkout is never modified**: twin worktrees are removed
  after grading; verify with `git -C <pin> status` and `worktree list`.
- Failure classes are counted from the emitted text, never inferred
  (SPEC reporting rule). One SPEC discrepancy is reported as found: the C3
  sequencing bar says "≥ 4 of the 5 sequenced items" but lists six ids
  (sw-009…sw-013, sw-022); the runner scores all rows carrying `sequence`
  and requires ≥ 4 expressed.
