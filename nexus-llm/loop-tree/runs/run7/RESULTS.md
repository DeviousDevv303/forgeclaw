# Run 7 (Muse replicate) — results and gate grade

**What this is.** An independent replicate of run 7, launched by Muse on 2026-10-27
after Claude hit his weekly usage limit (returns Fri Oct 31 ~13:00 CDT) and Cristian
directed the takeover. It is **not** Claude's original run 7: that run's checkpoints
were `*.pt` files inside Claude's container only, and their state is unknowable from
outside it. If the original surfaces, both get gated and the pair is reported as a
variance estimate. This replicate is a fresh deterministic run of the same recipe,
executed end-to-end by `nexus-llm/train/pipeline.sh` from the audit branch
(`claude/forgeclaw-refactor-audit-b5ydc0` @ `3842402`).

## Configuration (exact invocation)

```
PY=<venv>/python bash nexus-llm/train/pipeline.sh <workdir> small-copy-ind 30000 23 5000 6e-4
```

- Preset `small-copy-ind`, 30,000 synthetic rows, seed 23, 5,000 steps, LR 6e-4, batch 32.
- Model: 4,479,234 params. Trained from scratch (no init checkpoint), CPU, this workspace VM.
- Data file SHA-256: `89b4cf9db4151dbe1a8e13b4d6a01fee5017ae8c7bd13cebc69ad9186530b9cf`
  (regenerable: `gen-synthetic-traces.ts --n 30000 --seed 23`).
- Final checkpoint `model.pt` SHA-256: `fdb30d53ef9919e9cded7fa687aa8c3a3063ee25779f5731bf1e84db12206c5b`
  (17,932,720 bytes; not pushed — binary residency policy is an open group decision;
  the checkpoint remains in Muse's workspace, hash recorded here so any lane can
  verify a copy against this record).

## Restart history (disclosed in full)

1. Launched 2026-10-27 22:34 CDT. Runtime restart killed it at step 1850
   (loss 0.0067). Relaunched; resumed from the step-1500 checkpoint
   (steps 1500–1850 re-run by design; the resume path had been verified
   bit-identical in run-3 work).
2. Training **completed** 2026-10-28 01:47 CDT (final step 4999, loss 0.0021,
   `model.pt` saved). A second runtime restart killed the process during the
   predict stage. Relaunched with the identical command; the pipeline's
   stage-skip semantics resumed at predict (model and data present). All
   stages then completed, exit 0.

## Scores (constrained decoding, frozen suites)

| axis | run 7 replicate | run 4 (incumbent, recorded) |
|---|---|---|
| general (v1) | **65.5%** | 60.7% |
| domains (domains-v1) | **72.3%** | 76.6% |
| format / schema | 100% / 100% | 100% / 100% |
| overclaim / fabrication | 0.0% / 0.0% | 0.0% / 0.0% |
| closed loop | 6/18 | 6/18 |

Per-category (v1): tool_choice 66.7%, no_tool 60.0%, evidence 62.5%, honesty 66.7%.
Per-category (domains-v1): tool_choice 57.7%, no_tool 100%, evidence 100%, honesty 71.4%.

**Copying subscores (descriptive only — n=5 is binomial noise and gates nothing,
per the standing statistical-poverty doctrine):** images 3/5 (img-3/4/5 exact;
img-1 "red pic truck" — dropped letters from "pickup"; img-2 "damver" garbled),
Kalshi 0/2 (trd-1 "Eed cutting rates", trd-2 "Ocoin above 100k" — first-token
corruption). Failure shape is consistent: near-miss copies with dropped initial
characters. This is the writer-side datum run 8's agreed design targets
(nonce augmentation, COPY/CREATE mode tokens, copy-token loss weighting).

## Gate

`gate-cli` was run **without `--incumbent`** — run 4's predictions live in
Claude's container and are not readable from here; that limitation is disclosed,
not worked around. Against the baseline the gate could check:

```
pass   domains-v1: model 72.3% vs alwaysDirectNotVerified 12.8%
pass   v1: model 65.5% vs alwaysDirectNotVerified 21.4%
ELIGIBLE for the operator's decision (nothing ships automatically).
```

## Replace-only-if-better grade vs the incumbent

- General: 65.5% vs 60.7% — **better** (+4.8). Best general score of any run so far.
- Domains: 72.3% vs 76.6% — **worse** (−4.3) against run 4's recorded figure.
  Caveat, stated plainly: run 4's domains figure was reported against
  "domains v1.1"; if that suite differs from this `domains-v1`, the −4.3 is
  cross-version. Under replace-only-if-better, promotion requires *proof* of
  better; an unprovable comparison fails the same way a proven regression does.
  (Against runs 5/6, both 68.1% on this suite family, 72.3% is the strongest
  domains score since run 4.)

**Verdict: run 4 remains the incumbent. The run 7 replicate is not promoted.**
Same shape as run 5's rejection (general up, domains down) — the rule that
rejected run 5 is the rule applied here. Whether run 8 proceeds, and with what
changes, is a group decision, not a solo one.

## Files in this directory

`gate.txt`, `loop.txt`, `loop.jsonl`, `dispatch.jsonl` (image calls recorded,
never sent), `train.log`, `train-log.json`, `eval/v1.jsonl`,
`eval/domains-v1.jsonl` — every number above is reproducible from these plus
the pipeline at the audit commit named above.

— Muse, ForgeClaw Coding Specialist, 2026-10-28
