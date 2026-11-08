# Nexus LLM — Run 10: first real-data run (continuous-loop turn 1)

Program: `~/workspace/nexus-llm/multidomain-training-program.md` §§5–6, §9 — the §6.1
loop's first turn after run 9. Owner directives executed: train continuously until
meet+surpass with no re-asking between runs (2026-10-31 00:40 CDT); Nexus trained for
its **walking role alongside Qwen** — the frozen suites are quality bars for that walk,
not a provider candidacy (architecture correction, 2026-10-31 00:58 CDT).

## What is new in run 10 (the variables under test)

1. **Real traces enter training for the first time.** traces-v1 (46 rows / 42 unique
   episodes, 100% real: fallacy-audit verdicts, Watcher grading + stale-state episodes,
   the PR #337 context-bleed pair, tonight's live-search routing episode) folded in at
   ×39 repetition. Runs 4–9 trained synthetic-only; run 9's admitted-data verdict was
   "conversational gold traces in Nexus grammar: 0" — traces-v1 is the first shaped
   supply, and this run tests whether it moves behavior at ~6% share.
2. **Anti-decline execution class (new synthetic, 1,900 rows)** aimed at run 9's
   unrestriction wound: a trained stop/ask shape that surfaced as a spoken decline
   template ("I cannot run that for you. If you.") on 13 of 30 Axis U items, content-blind
   (restriction events 20/36 primary reading; Axis U FULL 1/30). These traces answer
   owner-authorized requests with **execution** — the call carried out, the result
   reported — across the U-axis shape families: messaging (send_whatsapp, gmail_send),
   memory writes, shell commands, funds-state reads, web fetch/search, calendar, image.
3. **Framework-routing class (new synthetic, 1,300 rows)** aimed at Axis F's 0/6 in all
   three graded runs. Gold routes framework-owned requests *through* the framework:
   tool-shaped where a surface exists (market read → funds_propose; gmail_send;
   funds_settle) and explain-shaped where the surface is owner-operated — the answer
   walks Assumptions → Heuristics → First Principles → Extension → Convergence
   (Truth > Function > Clarity > Efficiency) and converges on the owning surface
   (mandate issuance, /funds halt, /funds limits <key>=<value>, /funds add) — the
   DIRECT-EXPLAIN shape the unrestriction report itself noted as the routed alternate
   for unr-f-06 — never the decline template, never a bare owner-substitution deflection.
4. **Fresh base seed (26)** from the run-9 generator, so run 10 is not a re-read of
   run 9's exact rows; and the traces-v1 leakage checks run over the **full** assembled
   dataset, not just the real traces (results below).

Architecture, preset, and recipe are unchanged from run 9 (see table). Nothing here
trades away run 9's v1 70.2% general score by design: the two new classes together are
10.8% of the mix, the real block 6.0%, and 83.2% is the same generator distribution
that produced 70.2% / 74.5%.

## Configuration (run 9's recipe, replicated)

| Item | Value |
|---|---|
| Preset | `small-copy-ind` — 4 layers, d_model 256, ctx 640, copy head + induction |
| Parameters | 4,479,234 |
| Rows | 29,726 in `data.jsonl`; 29,648 reach training after the trainer's standing ctx-640 filter (78 real copies over length — §Deviations) |
| Data seed | 26 (generation: base + additions + shuffle; trainer RNG is the harness default, exactly as run 9 — pipeline.sh never forwarded the run seed to train.py) |
| Steps | 5,000 |
| LR | 6e-4 |
| Batch | 32 |
| Init | from scratch (no init checkpoint) |
| Copy-loss weight | 2.0 (`COPY_LOSS_WEIGHT` in `train/common.py`) |
| Tokenizer | run 8's training bytes — SHA-256 `323458df24247b695690f7fc25fa78fdbfd65ace44c8867fbf973d5fb8eb935a` (unchanged) |
| Incumbent for the gate | run 8's predictions (`~/workspace/run8/eval`), as run 9; meet/surpass frontiers per program §6.2 (below) |

## Dataset composition (counted by `build_dataset.py`; `build-report.json` is the record)

| Class | Rows in | Kept in data.jsonl | Share of final | Label |
|---|---:|---:|---:|---|
| Base — run-9 generator re-run, seed 26, N=25,000 (30 kinds, uniform caps; generator's own frozen-prompt filter dropped 418 candidates during generation) | 25,000 | 24,732 | 83.2% | synthetic: true |
| Real — traces-v1 (tool-use 40 + context 6 = 46 rows, 42 unique episodes) × 39 repetitions | 1,794 | 1,794 | 6.0% | **synthetic: false** (provenance sidecars intact; copies carry `repeat_of`) |
| Anti-decline execution (new) | 1,900 | 1,900 | 6.4% | synthetic: true, guardian_eligible: false |
| Framework routing (new) | 1,300 | 1,300 | 4.4% | synthetic: true, guardian_eligible: false |
| **Total** | **29,994** | **29,726** | 100% | real 6.0% / synthetic 94.0% |

New-class detail — anti-decline: exec_whatsapp 300, exec_shell 380, exec_email 280,
exec_memory 280, exec_fetch 240, exec_funds_read 220, exec_calendar 120, exec_image 80.
Framework: framework_place_order 300, framework_send_answers 200, framework_limit_change
180, framework_issue_mandate 170, framework_settle 150, framework_halt 150,
framework_move_money 150.

**Repetition reasoning (×39):** the program guide band for real share is ~5–10%. ×39
lands at 6.0%, the band's low end, deliberately: run 9's wounds are disposition shapes
addressed by the targeted synthetic classes, while the real block's job is grounding
tool-use/context behavior with weight, not dominating the mix; the trace-shaper's R4
warning (repetition strong enough to matter is strong enough to memorize) caps the
upside. Four Watcher episodes are shaped in both traces-v1 files and so carry double
weight by construction (disclosed in the traces-v1 manifest).

**New-class sizing reasoning:** together 3,200 rows (10.8%) — a visible minority.
Run 9's decline template was trained by a 2/30-kind minority (ask_file + ask_trade
≈ 6.7% + one owner_only answer variant); a counter-class needs comparable mass to
compete in the same gradient, but a flood would distort the base distribution that
carries the capability suites. ~11% split 6.4/4.4 across the two wounds is the
judgment; the gate, not the ratio, decides whether it worked (trace-shaper §5.2).

**Validation:** all 3,200 addition rows pass the repo's own `validateTranscript`,
their evidence tokens equal `canonicalEvidence(steps)`, and `encodeTranscript`
reproduces each row's text byte-for-byte (`validate-additions.ts`: 3,200 validated,
0 failures). All addition surface content is invented in `build_dataset.py` — no
unrestriction (or any suite) item text is copied or paraphrased; the leakage pass
below is the mechanical check, and it dropped **0** addition rows and **0** real rows.

## Leakage — the traces-v1 checks over the FULL assembled dataset

Checks (build_traces_v1.py's implementation, same calibration: normalized prompt
match; KX ticker match against every frozen file; 48-char normalized shingles over
fact-carrying content — prompt + result blocks + answer block — with the `<|call|>`
grammar header excluded on both sides, since the ban protects exam content, not the
shared format): **268 drops, all from the base** — 202 frozen-shingle overlaps vs
`eval/v1/cases.jsonl`, 66 frozen-ticker matches (the generator's fictional KXHIGH
tickers are drawn from the same pools the v1/domains fixtures were built from, so
seed 26 regenerated tickers that appear in frozen items — a genuine catch: run 9's
generator-side filter only checked prompt text, never tickers or content shingles).

Calibration, so the number is not misread: the identical checks over run 9's shipped
`data.jsonl` drop 342 of 30,000 (1.14%); run 10's base rate is 268 of 25,000 (1.07%) —
the same order. Run 10 is not held to a harsher standard than the incumbent recipe;
the check simply runs where it never ran before.

**Frozen-hash verification (after the build): all 9 recorded hashes match the program
spec §3 inventory exactly** — v1 `079df97b…`, domains-v1 `da429fa8…`, CAPBENCH
`ca1bbc75…`, CAPBENCH heldout `b77f2307…`, UNRESTRICTION `92ade216…`, UNRESTRICTION
heldout `92cb0be0…`, trading frozen-set v1 `fb7bd205…`, Watcher-Q `293db891…`,
Curator `26e8d918…`. No suite item is in any training row, and the suites are
byte-identical to their freeze records.

## Gate (program §6.2 — judged after this pipeline's gate stage, then the full §6.1 step 3)

- **MEET:** domains-v1 > 76.6% with v1 ≥ 70.2%, fabrication 0.0% on both suites.
- **SURPASS:** domains-v1 ≥ 78.6% and v1 ≥ 72.2%, fabrication 0.0% on both, no other
  frozen suite regressing > 1.0 pt against its best recorded candidate score.
- **Shell blocker (§9.3) reported by name:** shell-v1 is not yet frozen, so the blocker
  cannot clear in this turn; run 10's verdict will carry it as an open blocker, and
  exec_shell's 380 new traces are this turn's down payment on it.
- Disposition reads (trading v1, unrestrict-v1) follow the gate per run 9's pattern;
  a capability gain bought with a disposition regression does not promote (§5.2).

## Compute

Run 9's observed ruler: 5,000 steps in 15,327 s ≈ **4.3 h wall** on this VM (CPU-only,
`PY=~/workspace/nexus-taste/.venv/bin/python`, torch 2.14.1+cpu). Run 10 is the same
recipe and step count, so the same order of wall time is expected — an estimate from
that ruler, not a promise. Predict + gate + loop add minutes. The pipeline resumes
after a restart by re-running the identical command (finished stages skip; training
resumes from `ckpt/resume.pt`).

## Launch command

```
setsid nohup bash ~/workspace/run10/run-pipeline.sh > ~/workspace/run10-pipeline.log 2>&1 &
```

## Progress checks

- `tail ~/workspace/run10-pipeline.log` — stage log
- `tail ~/workspace/run10/train.log` — training steps/loss
- `cat ~/workspace/run10/gate.txt` — gate verdict when the pipeline completes
- `ls ~/workspace/run10/eval` — prediction files when predict finishes

## Deviations from run 9's recipe (each stated, none silent)

1. **`train.py` gets `--allow-real`.** Run 10's dataset contains operator-authorized
   real rows; train.py refuses any dataset not marked synthetic-only without the flag
   ("real rows must come from the exporter and are operator data" — traces-v1 is that
   exporter output, and the owner's continuous-loop directive is the authorization).
   pipeline.sh has no hook for extra train args, so the launcher (`run-pipeline.sh`)
   is a stage-for-stage mirror of pipeline.sh with this single flag added; every other
   stage's command is identical to run 9's. Without the flag the run cannot start at all.
2. **Base regenerated at seed 26 with N=25,000** instead of reusing run 9's
   `data.jsonl` (the task's preferred path: the generator exists, so it was re-run),
   reduced from 30,000 so the real block and the two new classes fit the ~30k scale.
3. **Two real episodes exceed the model ctx (640) and the trainer will filter them:**
   `real-livesearch-routing-20261031` (795 tokens) and `real-watcher-grade-r6`
   (841 tokens) — 78 of 1,794 real copies; trained real rows are therefore 1,716
   (44 of 46 episodes). They are left in `data.jsonl` untruncated (truncating a gold
   transcript would teach malformed transcripts) and dropped by the trainer's own
   standing length filter, exactly as one run-9 row was. Queued for a later loop turn:
   re-shape those two episodes under the ctx, or take the ctx question to the owner.
4. **The full-dataset leakage pass (§above) is new in run 10** — runs 7–9 enforced
   only the generator's prompt-match filter. It cost the base 268 rows (1.07%).

## Discipline

Frozen eval stays frozen (verified by hash, above). Synthetic traces labeled
synthetic, never Guardian training data; the additions carry `guardian_eligible:
false` in-row. Real traces keep their traces-v1 provenance sidecars; only their
`<|ev:verified|>` subset is Guardian-eligible, as before. No changes to nexus-trader
or the live Bank. Local files only; no git operations this turn.
