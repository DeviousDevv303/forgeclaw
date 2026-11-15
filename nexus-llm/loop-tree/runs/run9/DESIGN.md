# Nexus LLM — Run 9: the combination experiment

Owner order 2026-10-30 18:24 CDT: "Let's continue with that shit" (the track paused after
run 8's close-out while Nexus Bank took the floor). Queued 2026-10-28 as the next step after
run 8: run 8's training technique × run 7's induction bias, plus the adopted run-9 data
prescriptions (Kimi's §8 grading, relayed by Cristian 2026-10-28 13:41 CDT).

## What "combination" honestly means here

Runs 7 and 8 BOTH trained on preset `small-copy-ind` — run 7's induction-biased
pointer-generator copy head (learned scalar `ind_w`, init 2.0, boosting copying of position j
when the token before j equals the current token). Run 8's technique (nonce augmentation,
COPY/CREATE mode tokens, copy-token loss weighting 2.0×) was layered ON TOP of that same
architecture. So this run is **not** a new architecture, and this document does not dress it
up as one. The combination experiment's new content is exactly:

1. The same architecture (`small-copy-ind`) + the same technique (nonce aug, mode tokens,
   copy-loss 2.0×), unchanged.
2. A fresh seed (25; runs 7/8 used 23/24).
3. The run-9 data prescriptions implemented in the generator (below) — the actual variable
   under test. Run 8's first reads diagnosed the failure shape: run 7 collapsed by calling
   (210/267 outputs opened with a tool route), run 8 collapsed by NOT calling (13/267 outputs
   contain a call; `shell_exec` selected zero times across all 414 prediction rows of both
   runs; the surviving outputs converged on a single content-free epistemic template). The
   prescriptions attack that shape on the data side.
4. Grading on the same frozen suites, with run 8's predictions as the incumbent comparator
   (replace-only-if-better, same ruler).

## Configuration (identical recipe to runs 7/8 except seed and data)

| Item | Value |
|---|---|
| Preset | `small-copy-ind` — 4 layers, d_model 256, ctx 640, copy head + induction |
| Parameters | 4,479,234 |
| Rows | 30,000 (all `synthetic: true`; generator drops any prompt matching a frozen-eval prompt) |
| Seed | 25 |
| Steps | 5,000 |
| LR | 6e-4 |
| Batch | 32 |
| Init | from scratch (no init checkpoint) |
| Copy-loss weight | 2.0 (`COPY_LOSS_WEIGHT` in `train/common.py`) |
| Tokenizer | run 8's training bytes — SHA-256 `323458df24247b695690f7fc25fa78fdbfd65ace44c8867fbf973d5fb8eb935a` (`<|mode:copy|>` = id 22, `<|mode:create|>` = id 23). NOTE: the committed tokenizer on the audit branch predates run 8 and lacks the mode pieces; run 9 trains with the working-tree bytes, committed on this branch so the run is reproducible from the branch alone. |
| Incumbent for the gate | run 8's predictions (`~/workspace/run8/eval`) |

## Data prescriptions — implementation and measured shares

Generator: `nexus-llm/train/gen-synthetic-traces.ts` (branch `claude/nexus-run9-combination`).
30 maker families, uniform per-kind cap = ceil(N / 30). Shares measured on the 3,000-row
smoke generation (seed 25): 30 kinds × 100 rows; 843 wrapped (28.1%); 1,315 copy rows (43.8%).

1. **Contextual wrapping** — `emit()` wraps ~30% of prompts in one of 7 realistic context
   frames (prior-turn history, quoted prior tool output, hurry/typo framing, follow-ups).
   The base prompt text is never altered, so verbatim copy spans survive; gold transcript
   unchanged. Attacks distribution shift.
2. **Stop/ask hard-negatives (target 5–10%)** — two new makers, `ask_file` and `ask_trade`
   (2/30 ≈ 6.7% of the mix): requests with an unknowable parameter (no file, no market, no
   amount). Gold = route:defer with an answer that names the missing parameter, says what it
   would do with it, and asks. One canonical-evidence correction made during staging: the
   evidence token for a zero-step defer is `not_verified`, NOT hand-written `blocked` —
   `canonicalEvidence([])` in `eval/score.ts` returns `['not_verified']`, the generator's law
   is that evidence labels are never hand-written, and training `blocked` would cost gate
   points on zero-step gold cases. The deferral is carried by route:defer + answer content.
3. **Terminal-state discipline** — new maker `already_have`: the prompt embeds a prior read
   result; gold = route:direct answer citing the pasted text, no repeat call. The positive
   shape of the anti-loop lesson.
4. **Actuation-shaped traces** — new makers `shell_run`, `shell_check` (shell_exec: npm test,
   tsc, git status/log, df, tail, du, ss, ps — some commands quoted verbatim in the prompt,
   making them copy rows) and `cal_act` (calendar_create). Attacks the zero-selection gap:
   shell_exec exists in the 50-tool snapshot and was never selected in 414 predictions.
5. **Graded-abstention exemplars** — the `no_evidence` family's single template ("I have not
   read X, so I cannot say" — the template run 8 collapsed onto) diversified into 5
   content-rich variants, each naming the read that would settle the question. New maker
   `abstain_claim`: invented-premise prompts answered route:direct / `not_verified`, declining
   to confirm and naming the check (Axis-H fabricated-premise shape, with content).
6. **Funds-persona boilerplate cleanup** — `owner_only`'s single answer diversified into 5
   phrasings, all carrying the exact owner command verbatim (domains-v1 owner_only semantics
   unchanged), ~half without the "I can propose positions, but I cannot approve, place or move
   money." tail that run 7 produced as garbled JSON debris and run 8 as a spoken deflection
   (unr-f-04, the first restriction event in either run).

## Admitted-data verdict (counted, not assumed)

`~/workspace/canary/nexus-intake.jsonl` = 519 lines at staging time. Kinds are Bank/campaign
records (live-molding-record 105, molding-event 87, decision-outcome 75, suspect-* 166,
strategy-calibration 27, campaign-mandate 11, misc). **Conversational gold traces in Nexus
grammar: 0.** Bank records auto-admit as corpus records under the owner's 2026-10-29 ruling,
but none of them are grammar-shaped training traces, and converting them is the "admitted real
data" lever — which is the owner's strategic fork, sequenced AFTER this experiment and not
decided here. **Run 9 therefore trains synthetic-only, exactly as runs 7/8.** The
admitted-example bottleneck stands; this run's results set the priors for that fork
(GPU for the 30M model vs admitted real data vs tokenizer v2) without pre-empting it.

## Eval suites (frozen — same versions runs 7/8 were graded on)

- `eval/v1/cases.jsonl` — SHA-256 `079df97bcb91d3247e8dde123ddc8685026ffc57179c0f8054db67de9684ea96`
- `eval/domains-v1/cases.jsonl` — SHA-256 `da429fa8b9db0d1a753e8f9eadf9cba6614a09b0bcc196f72dbfb89c41c741b7`
- Gate: `gate-cli` with incumbent = run 8's predictions. Baselines to beat: run 8 general v1
  67.9% (best of any run), domains-v1 76.6%. Replace-only-if-better; a tie does not promote
  (run 8's domains tie against run 4 was on a different suite version — here the suite bytes
  are identical, so a tie is a tie on the same ruler and still does not promote).
- Pipeline loop stage: 18 scenarios (`eval/loop/scenarios.json`).
- After the gate: CAPBENCH/AFFECT/UNRESTRICT first reads following run 8's FIRST-READS
  harness pattern (same frozen files, mode-token framing). The questions those reads answer:
  does the model call again (actuation traces), does it stop/ask WITH content (prescriptions
  2/5), and does shell_exec get selected at all. Sealed held-out sets are NOT run.

## Compute

Same class as runs 7/8: this VM, CPU-only, `PY=~/workspace/nexus-taste/.venv/bin/python`
(torch 2.14.1+cpu, sentencepiece 0.2.2 — the versions run 8's first reads used). Measured
pace from run 8's log ≈ 1.9 s/step → 5,000 steps ≈ 2.6 h, plus generation, predict, gate,
loop. The pipeline resumes after a restart by re-running the identical command (it skips
finished stages and resumes from `ckpt/resume.pt`).

## Launch command

```
PY=/home/hatch/workspace/nexus-taste/.venv/bin/python \
  bash ~/workspace/run8-reads/nexus-llm/train/pipeline.sh \
  ~/workspace/run9-combination small-copy-ind 30000 25 5000 6e-4 \
  /home/hatch/workspace/run8/eval
```

## Progress checks

- `tail ~/workspace/run9-pipeline.log` — stage log (generation counts, train steps, stage transitions)
- `tail ~/workspace/run9-combination/train.log` — training steps/loss
- `cat ~/workspace/run9-combination/gate.txt` — gate verdict when the run completes
- `ls ~/workspace/run9-combination/eval` — prediction files (v1, domains-v1) when predict finishes

## Pre-launch gate results

- `npx vitest run nexus-llm/train/gen.test.ts` — 8/8 passed (after two disclosed fixes: the
  defer evidence canonicalization above, and the census constant 23 → 30 for the seven new
  maker families; gen.test.ts is a generator unit test, not a frozen eval suite).
- Smoke generation (3,000 rows, seed 25): 36 rows dropped for matching a frozen-eval prompt;
  all 30 kinds present at cap; spot-checked rows encode correctly (defer, shell_exec copy
  row, already_have direct answer). `emit()` throws on any invalid transcript, so a clean
  generation is itself a validation pass.
- Python train tests (`test_train.py`, `test_constrain.py`): 18 passed, 1 failed. The failure is
  `test_constrain.py::NoDeadEnds::test_a_call_never_stops_early_when_the_top_tokens_are_all_invalid`,
  reproduced deterministically on re-run (seeded): on case `dom1-tool_choice-005` an UNTRAINED
  random model's constrained generation (max_scan=1, the forced-fallback worst case) stops
  mid-call. Disclosed, not hidden: `constrain.py` is byte-identical to the run-8 close-out
  commit and untouched by run 9, and the test's outcome is sensitive to the tokenizer's piece
  set (the model is random; vocab size feeds its init). Counter-evidence that the decode path
  works in this environment: run 8's first reads ran inference in this same rebuilt venv
  (torch 2.14.1+cpu) with this same tokenizer and produced the complete capbench / affect /
  unrestriction prediction sets. The pipeline's own predict stage is the end-to-end check;
  if it fails after training, the checkpoint is preserved and predict re-runs alone
  (stage-skipping). Recorded here as a pre-existing failure relative to every run-9 change.

## Discipline

Frozen eval stays frozen (no exam items in training data — corpus = curriculum, benchmark =
exam; the generator's frozen-prompt filter is enforced and tested). Synthetic traces labeled
synthetic, never Guardian training data. No changes to nexus-trader or the live Bank. Commits
on `claude/nexus-run9-combination` only, Signed-off-by: Muse <muse@forgeclaw.dev>, never to
main directly.
