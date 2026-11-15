# Nexus LLM — Run 11: second real-data run (continuous-loop turn 2)

Program: `~/workspace/nexus-llm/multidomain-training-program.md` §§5–6, §9 — the §6.1
loop's second turn after run 9. Owner directives executed: train continuously until
meet+surpass with no re-asking between runs (2026-10-31 00:40 CDT); Nexus trained for
its **walking role alongside Qwen** — the frozen suites are quality bars for that walk,
not a provider candidacy (architecture correction, 2026-10-31 00:58 CDT).

## What is new in run 11 (the variables under test)

Run 10's verdict (BELOW BAR: v1 71.4% up, domains-v1 63.8% down −10.7) diagnosed the
wound precisely: domains **evidence 100% → 54.5%** and **no_tool 100% → 66.7%**, while
tool_choice actually rose. Working hypothesis carried from the verdict: run 10's
execution-heavy classes over-weighted *act-and-report* shapes at the expense of
*mark-evidence-truthfully / stay-direct* shapes. Run 11's additions are rebuilt from
that diagnosis, lane by lane:

1. **Evidence-marking class (new synthetic, 900 rows)** — the ev token as a function of
   what ran and how it ended: evidence-tool ok → `verified` (300); only not-evidence
   tools ok (memory_read / funds_status / kalshi_owner_prices) → `completed` (250);
   all reads failed → `failed`, with the failure stated in the answer (200); mixed
   ok+error pairs in both directions (150). Every row's token is computed by the same
   `canonicalEvidence` mirror the validator checks, never hand-written.
2. **No-tool direct class (new synthetic, 700 rows)** — everything needed is already in
   the prompt: pasted-output questions (350), stated-fact recall (200), and short
   explanations (150). Gold is route:direct / `not_verified`, answers that cite only
   what was given and say no new check was run.
3. **Tool-choice contrast class (new synthetic, 800 rows)** — eight near-miss door
   pairs at 100 each: owner price given → `kalshi_owner_prices` (not markets);
   market lookup → `kalshi_markets {query}`; settle → `funds_settle` (not markets);
   bankroll → `funds_status`; read a repo file → `github_read_file` (not shell);
   line count → `shell_exec` (not read); memory recall → `memory_read` (not web);
   web lookup → `web_search` (not memory). Aimed at v1 tool_choice 69.7% and the
   unrestriction wrong-door pattern (11/30 well-formed calls through the wrong door),
   and at the loop's trd-7/trd-8 first-call misses (owner-prices and settle shapes).
4. **Image copy-fidelity class (new synthetic, 600 rows)** — the loop wound (4 of 6
   image scenarios dropped the prompt's own nouns): the `generate_image` call's
   `prompt` argument is the subject phrase **verbatim** from the user prompt,
   including two-noun and place-carrying subjects. Loop-scenario nouns are excluded
   from the pools, so a loop pass is copying, not recall.
5. **Framework-routing v2 (new synthetic, 900 rows)** — run 10's class worked (Axis F
   first ROUTED 1/6 + DIRECT-EXPLAIN 3/6) but three explains truncated before naming
   the owner command, and mandate issuance (unr-f-02) and the concrete email route
   (unr-f-05) missed. V2: mandate issuance (250) and limit change (200) and halt (200)
   as **short** direct explains that name the owner command in the **first sentence**
   (`/funds add <amt>` record, `/funds limits <key>=<value>`, `/funds halt`), well
   inside the generation cap; send-the-answers (250) as an executed `gmail_send`
   tool route.
6. **Execution-vs-explain contrast (new synthetic, 400 rows)** — run 10's explain
   shape leaked onto Axis U execution items. Pairs: framework-flavored prompts whose
   request is a plain execution → tool route, no phases (200); owner-surface actions
   (approve/place, resume, add funds) → short direct explain naming the command
   first, no call (200).
7. **Decline+substitution counter-examples (new synthetic, 300 rows)** — run 10's two
   residual restriction events were both decline+owner-command composites, on a
   price-recording request and an error-filing request. Those exact shapes, executed:
   record an owner price via `kalshi_owner_prices` (150), file an error report via
   `github_create_issue` (75), log an error via `memory_write` (75). No decline
   wording anywhere in the class.
8. **The standing queue is cleared: the two over-ctx real episodes are IN.** Run 10's
   trainer filtered all 78 copies of `real-livesearch-routing-20261031` (795 tok) and
   `real-watcher-grade-r6` (841 tok). In run 11 each is re-shaped **faithfully as two
   split traces** (by graded sub-claim; the originals' own result/answer sentences,
   prompts trimmed to the sub-claim, the split and the one trimmed call wording
   recorded in each row's `provenance.reshaped`) — never truncated silently, nothing
   invented. Encoded lengths: livesearch-a 565, livesearch-b 345, r6-a 395, r6-b 604 —
   all under the 640 ctx. The originals are not also included. Real unique rows:
   46 − 2 + 4 = **48**.

Run 10's anti-decline and framework v1 classes are **not** re-run verbatim: per the
loop recipe the targeted classes are rebuilt from the current diagnosis, and their
descendants are classes 5–7 above (plus the execution mass in classes 1/3/4). This is
a stated deviation from run 10's mix, not a silent one (§Deviations).

## Configuration (run 9's recipe, replicated)

| Item | Value |
|---|---|
| Preset | `small-copy-ind` — 4 layers, d_model 256, ctx 640, copy head + induction |
| Parameters | 4,479,234 |
| Rows | 31,170 in `data.jsonl`; **all 31,170 reach training** (encode pre-check: max length 633, zero rows over ctx 640 — first run where nothing is filtered) |
| Data seed | 27 (generation: base + additions + shuffle; trainer RNG is the harness default, exactly as runs 9–10) |
| Steps | 5,000 |
| LR | 6e-4 |
| Batch | 32 |
| Init | from scratch (no init checkpoint) |
| Copy-loss weight | 2.0 (`COPY_LOSS_WEIGHT` in `train/common.py`) |
| Tokenizer | run 8's training bytes — SHA-256 `323458df24247b695690f7fc25fa78fdbfd65ace44c8867fbf973d5fb8eb935a` (unchanged) |
| Incumbent for the gate | run 8's predictions (`~/workspace/run8/eval`), as runs 9–10; meet/surpass frontiers per program §6.2 (below) |

## Dataset composition (counted by `build_dataset.py`; `build-report.json` is the record)

| Class | Rows in | Kept in data.jsonl | Share of final | Label |
|---|---:|---:|---:|---|
| Base — run-9 generator re-run, seed 27, N=25,000 (30 kinds; generator's own frozen-prompt filter dropped 374 candidates during generation) | 25,000 | 24,698 | 79.2% | synthetic: true |
| Real — traces-v1 reshaped (44 original episodes + 4 faithful splits of the 2 over-ctx episodes = 48 unique) × 39 repetitions | 1,872 | 1,872 | 6.0% | **synthetic: false** (provenance sidecars intact; copies carry `repeat_of`) |
| Evidence marking (new) | 900 | 900 | 2.9% | synthetic: true, guardian_eligible: false |
| No-tool direct (new) | 700 | 700 | 2.2% | synthetic: true, guardian_eligible: false |
| Tool-choice contrast (new) | 800 | 800 | 2.6% | synthetic: true, guardian_eligible: false |
| Image copy fidelity (new) | 600 | 600 | 1.9% | synthetic: true, guardian_eligible: false |
| Framework routing v2 (new) | 900 | 900 | 2.9% | synthetic: true, guardian_eligible: false |
| Execution-vs-explain contrast (new) | 400 | 400 | 1.3% | synthetic: true, guardian_eligible: false |
| Decline+substitution counter-examples (new) | 300 | 300 | 1.0% | synthetic: true, guardian_eligible: false |
| **Total** | **31,472** | **31,170** | 100% | real 6.0% / synthetic 94.0% |

**Repetition reasoning (×39):** unchanged from run 10 — lands the real block at 6.0%,
the low end of the program's ~5–10% band, for the same reasons (grounding with weight,
not domination; the trace-shaper's R4 memorization warning caps the upside). The two
reshaped episodes now actually train at the same ×39 as every other episode.

**New-class sizing reasoning:** 4,600 rows (14.8%), larger than run 10's 3,200 because
run 10's diagnosis names more lanes (evidence, no_tool, contrast, image, framework-v2,
explain-leak, residual composites) — each class is sized ~100–900 so no single new
shape floods the base distribution that carries the capability suites. The gate, not
the ratio, decides whether it worked (trace-shaper §5.2).

**Validation:** all 4,600 addition rows pass the repo's own `validateTranscript`,
their evidence tokens equal `canonicalEvidence(steps)`, and `encodeTranscript`
reproduces each row's text byte-for-byte (`validate-additions.ts`: 4,600 validated,
0 failures). All addition surface content is invented in `build_dataset.py` — no
unrestriction (or any suite) item text is copied or paraphrased; the leakage pass
below is the mechanical check, and it dropped **0** addition rows and **0** real rows.

## Leakage — the traces-v1 checks over the FULL assembled dataset

Checks (build_traces_v1.py's implementation, same calibration as run 10: normalized
prompt match; KX ticker match against every frozen file; 48-char normalized shingles
over fact-carrying content — prompt + result blocks + answer block — with the
`<|call|>` grammar header excluded on both sides): **302 drops, all from the base** —
236 frozen-shingle overlaps vs `eval/v1/cases.jsonl`, 66 frozen-ticker matches (the
generator's fictional KXHIGH tickers are drawn from the same pools the fixtures were
built from; seed 27 regenerated colliding tickers, as seed 26 did).

Calibration: the identical checks over run 9's shipped `data.jsonl` drop 342 of
30,000 (1.14%); run 11's base rate is 302 of 25,000 (1.21%) — the same order as
run 10's 268 of 25,000 (1.07%). Run 11 is not held to a harsher standard than the
incumbent recipe.

**Frozen-hash verification (after the build): all 9 recorded hashes match the program
spec §1 inventory exactly** — v1 `079df97b…`, domains-v1 `da429fa8…`, CAPBENCH
`ca1bbc75…`, CAPBENCH heldout `b77f2307…`, UNRESTRICTION `92ade216…`, UNRESTRICTION
heldout `92cb0be0…`, trading frozen-set v1 `fb7bd205…`, Watcher-Q `293db891…`,
Curator `26e8d918…`. No suite item is in any training row, and the suites are
byte-identical to their freeze records.

## Gate (program §6.2 — judged after this pipeline's gate stage, then the full §6.1 step 3)

- **MEET:** domains-v1 > 76.6% with v1 ≥ 70.2%, fabrication 0.0% on both suites.
- **SURPASS:** domains-v1 ≥ 78.6% and v1 ≥ 72.2%, fabrication 0.0% on both, no other
  frozen suite regressing > 1.0 pt against its best recorded candidate score, and
  shell evidence not below run 10's level (domains tool_choice 61.5%; unrestriction
  shell_exec 7 selections / 3 FULL).
- **Shell blocker (§9.3) reported by name:** shell-v1 is not yet frozen, so the blocker
  cannot clear in this turn; run 11's verdict will carry it as an open blocker.
- Disposition reads (trading v1, unrestrict-v1) follow the gate per runs 9–10's pattern.

## Compute

Run 9's observed ruler: 5,000 steps in 15,327 s ≈ **4.3 h wall** on this VM (CPU-only,
`PY=~/workspace/nexus-taste/.venv/bin/python`, torch 2.14.1+cpu). Run 11 is the same
recipe and step count at slightly more rows (31,170 vs 29,726), so the same order of
wall time is expected — an estimate from that ruler, not a promise. Predict + gate +
loop add minutes. The pipeline resumes after a restart by re-running the identical
command (finished stages skip; training resumes from `ckpt/resume.pt`).

## Launch command

```
setsid nohup bash ~/workspace/run11/run-pipeline.sh > ~/workspace/run11-pipeline.log 2>&1 &
```

## Progress checks

- `tail ~/workspace/run11-pipeline.log` — stage log
- `tail ~/workspace/run11/train.log` — training steps/loss
- `cat ~/workspace/run11/gate.txt` — gate verdict when the pipeline completes
- `ls ~/workspace/run11/eval` — prediction files when predict finishes

## Deviations from run 10's recipe (each stated, none silent)

1. **`train.py` gets `--allow-real`** — same as run 10, same reason: the dataset
   contains operator-authorized real rows (traces-v1, reshaped) and train.py refuses
   any non-synthetic row without the flag. The launcher (`run-pipeline.sh`) is a
   stage-for-stage mirror of pipeline.sh with this single flag added.
2. **Base regenerated at seed 27 with N=25,000.** Run 10 used seed 26; the loop task's
   "seed 26+N" is read as the run-10 template's seed incremented per turn (N=25,000
   is the candidate count in the same sentence), so run 11 takes the next fresh seed.
   A fresh seed means run 11 is not a re-read of run 10's exact rows.
3. **The two over-ctx real episodes are split, not left to the trainer's filter**
   (the standing queue from the loop task, carried in run 10's verdict). Split by
   graded sub-claim from the episodes' own sentences; the split, the trimmed prompts,
   and r6-a's trimmed call wording are recorded in each split row's
   `provenance.reshaped`. No content invented; the originals are excluded so no
   episode trains twice in two shapes.
4. **Run 10's anti-decline / framework v1 addition classes are replaced, not
   repeated** — rebuilt as framework v2 + execution-vs-explain contrast +
   decline+substitution counter-examples from run 10's graded diagnosis, per the
   loop recipe ("targeted synthetic classes rebuilt from THIS run's graded
   diagnosis"). Their combined mass (1,600) is comparable to the v1 pair's (3,200)
   once the other execution classes (contrast 800, image 600, evidence tool routes
   900) are counted: total tool-route additions ≈ 2,900.
5. **Total rows 31,170 vs run 10's 29,726** — the additions grew (4,600 vs 3,200)
   because the diagnosis named more lanes; the base and real counts are unchanged
   in construction. The trainer's ctx filter drops **zero** rows this run (run 10
   dropped 78 real copies), so trained rows = written rows for the first time.

## Discipline

Frozen eval stays frozen (verified by hash, above). Synthetic traces labeled
synthetic, never Guardian training data; the additions carry `guardian_eligible:
false` in-row. Real traces keep their traces-v1 provenance sidecars (splits carry
theirs plus the reshaped record); only their `<|ev:verified|>` subset is
Guardian-eligible, as before. No changes to nexus-trader or the live Bank. Local
files only; no git operations this turn.
