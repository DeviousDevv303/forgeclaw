# Nexus LLM — Run 14: fifth real-data run (continuous-loop turn 5)

Program: `~/workspace/nexus-llm/multidomain-training-program.md` §§5–6, §9 — the §6.1
loop's fifth turn after run 9. Owner directives executed: train continuously until
meet+surpass with no re-asking between runs (2026-10-31 00:40 CDT); Nexus trained for
its **walking role alongside Qwen** — the frozen suites are quality bars for that walk,
not a provider candidacy (architecture correction, 2026-10-31 00:58 CDT).

Run 13 was **BELOW BAR** (v1 73.8%, domains-v1 70.2% vs the 76.6% incumbent bar,
fabrication 0.0% both) — run 12's first-ever MEET was not repeated, and shell evidence
fell below prior on **both** lanes at once (domains tool_choice 73.1% → 53.8%;
unrestriction `shell_exec` 13 selections / 4 FULL → 1 / 1). Run 14's additions are
rebuilt from run 13's graded diagnosis (`~/workspace/run13/verdict.md`,
`unrestrict-report.md`, `loop.txt`) — they are the six changes run 13's verdict itself
folded forward:

1. **Well-agnostic mixed-door routing (new synthetic, 1,200 rows)** — run 13
   diagnosis 3: the gravity well *rotates* (shell in run 12, gmail in run 13, gmail
   before that); per-well contrast classes drain the named well and the unresolved
   routing mass lands on the next high-frequency door. This class names no well:
   six doors at 200 each (`shell_exec`, `gmail_send`, `funds_status`,
   `generate_image`, `kalshi_markets`, `web_search`), every prompt drawn from a
   shared verb pool (run / check / pull / handle / get / do), so the verb never
   resolves the door — only the task's **object** does.
2. **Shell re-balance — selection AND scope (new synthetic, 900 rows)** — run 13
   diagnosis 2: run 13's scope contrast (200 positive : 900 contrast) overshot and
   shell selection collapsed 13 → 1. The ratio is **inverted**: 600 positive
   `shell_exec` rows at shell's true coding/sysadmin doors (kill, chmod, nmap,
   git status/log, grep, tail, ls, sha256sum — eight forms) against 300 scope rows
   spread over six neighbour doors at 50 each.
3. **Owner-price + settle as BARE first calls (new synthetic, 1,000 rows)** —
   fourth generation, **mechanism changed, not mass** (see the diagnosis below):
   owner-price bare (350, `kalshi_owner_prices` as first and only call), note-object
   contrast (150, the same record/note/log verbs on a note object → `memory_write`),
   settle bare (350, `funds_settle` id `all` as first and only call), status-object
   contrast (150, settle-adjacent words in a status *question* → `funds_status`).
4. **Copy fidelity v4 — the two surviving garble mechanics (new synthetic, 1,000
   rows)** — narrowed exactly as run 13's verdict folded forward: (a) first-letter
   substitution at the **start** of a query argument — both loop failures garble the
   query's first letter and both queries begin with a capitalised proper noun, so
   500 rows train query arguments beginning with a capitalised topic across ~20
   initials, copied character-for-character (250 `kalshi_markets` + 250
   `web_search`); (b) subject-noun drop in image prompts — run 13's failures kept
   the style/head words and lost the noun at the **end** of a long phrase, so 500
   rows carry the full long phrase in the `generate_image` prompt argument with the
   subject noun in final position. The loop scenarios' own words are never used
   (the generator's standing exclusion: those nouns/topics are absent from all
   training pools, so a loop pass is copying unseen words, not recall).
5. **Framework routing v5 — full explain set re-seated (new synthetic, 1,100
   rows)** — run 13 diagnosis 4: explains are per-shape perishable. V4 rebuilt
   halt + limits and both landed; the wire explain, deliberately excluded as "not
   the wound," decayed to the persona deflection. V5 re-seats the **whole set** in
   v4's separated form (short, first sentence names the exact command, the
   substitution formula nowhere): mandate ×2, halt ×2, limits ×2, wire ×2 shapes,
   600 rows — plus route mass kept for order (`funds_propose`, 250) and
   send-answers (`gmail_send`, 250), in route form, not explain form.
6. **Honesty guard v2 — reach vs no-reach discrimination (new synthetic, 800
   rows)** — run 13 diagnosis 5: run 13's no-reach guard generalised past its
   intent (the unknown category fell to 1/4 PASS; on the one unknown item with a
   real check the model reached for `web_search` instead of the named check). V2
   pairs both directions in one class so the *discrimination* is trained, not the
   reaching: unknowable facts answered directly, `not_verified`, no reach (400);
   facts with a named check in the grammar reached through exactly that check —
   balance via `funds_status` (200), market settlement state via `kalshi_markets`
   (200).

**Owner-price + settle diagnosis (from the items' actual context structure, as
run 13's verdict required before writing rows):** generations 1–3 trained these
doors *with scaffolding* — generation 3 (run 13) put a `funds_status` step first
in the transcript, or a pasted status block in the prompt. The graded loop items
carry **neither**: they are bare imperatives expecting the target door as the
**first** call. Run 13's loop record shows the scaffolding firing as trained:
`trd-8` opened with `funds_status` (the trained first step) where `funds_settle`
was expected first, and `trd-7` went to `memory_write` — "record" had been trained
on note-shaped and status-framed contexts, never on a bare ticker+price object.
Class 3 therefore removes the scaffolding entirely: the prompt is the bare
imperative alone, the target door is the first and only call, and contrast rows
put the *same verbs* on the other object so the object — ticker+price vs note
text, settle-command vs status-question — is the only signal. That is why this
generation differs; more rows of the scaffolded shape are explicitly not the plan.

Run 13's seven classes are **not** re-run verbatim: per the loop recipe the
targeted classes are rebuilt from the current diagnosis, and classes 1–6 above
are their descendants. This is a stated deviation from run 13's mix (§Deviations).

**Standing queue:** cleared in run 11 — both over-ctx episodes
(`real-livesearch-routing-20261031`, `real-watcher-grade-r6`) train as run 11's
faithful splits, unchanged. Re-check this turn (2026-11-01): traces-v1 files are
byte-unchanged since run 11's build (SHA-256 tool-use-v1 `8e23d474…`, context-v1
`b22827d4…`, file mtimes 2026-10-31 05:58, predating it) and no newly shaped real
records exist; the intake records since (run13-gate decision-outcome, Watcher
grades, canary/fallacy-audit lines) are unshaped journal lines, not traces —
shaping them is a shaper build, not a copy, and none is claimed here.

## Configuration (run 9's recipe, replicated)

| Item | Value |
|---|---|
| Preset | `small-copy-ind` — 4 layers, d_model 256, ctx 640, copy head + induction |
| Parameters | 4,479,234 |
| Rows | 32,580 in `data.jsonl`; **all 32,580 reach training** (encode pre-check: max length 638, zero rows over ctx 640) |
| Data seed | 30 (generation: base + additions + shuffle; trainer RNG is the harness default, exactly as runs 9–13) |
| Steps | 5,000 |
| LR | 6e-4 |
| Batch | 32 |
| Init | from scratch (no init checkpoint) |
| Copy-loss weight | 2.0 (`COPY_LOSS_WEIGHT` in `train/common.py`) |
| Tokenizer | run 8's training bytes — SHA-256 `323458df24247b695690f7fc25fa78fdbfd65ace44c8867fbf973d5fb8eb935a` (unchanged, per runs 10–13; re-verified this build) |
| Incumbent for the gate | run 8's predictions (`~/workspace/run8/eval`), as runs 9–13; meet/surpass frontiers per program §6.2 (below) |

## Dataset composition (counted by `build_dataset.py`; `build-report.json` is the record)

| Class | Rows in | Kept in data.jsonl | Share of final | Label |
|---|---:|---:|---:|---|
| Base — run-9 generator re-run, seed 30, N=25,000 (30 kinds; generator's own frozen-prompt filter dropped 402 candidates during generation) | 25,000 | 24,708 | 75.8% | synthetic: true |
| Real — traces-v1 reshaped (44 original episodes + run 11's 4 faithful splits of the 2 over-ctx episodes = 48 unique) × 39 repetitions | 1,872 | 1,872 | 5.7% | **synthetic: false** (provenance sidecars intact; copies carry `repeat_of`) |
| Well-agnostic mixed-door routing (new) | 1,200 | 1,200 | 3.7% | synthetic: true, guardian_eligible: false |
| Shell re-balance, selection + scope (new) | 900 | 900 | 2.8% | synthetic: true, guardian_eligible: false |
| Owner-price + settle, bare first calls (new) | 1,000 | 1,000 | 3.1% | synthetic: true, guardian_eligible: false |
| Copy fidelity v4, two garble mechanics (new) | 1,000 | 1,000 | 3.1% | synthetic: true, guardian_eligible: false |
| Framework routing v5, full explain set (new) | 1,100 | 1,100 | 3.4% | synthetic: true, guardian_eligible: false |
| Honesty guard v2, reach discrimination (new) | 800 | 800 | 2.5% | synthetic: true, guardian_eligible: false |
| **Total** | **32,872** | **32,580** | 100% | real 5.7% / synthetic 94.3% |

**Repetition reasoning (×39):** unchanged from runs 10–13 — lands the real block
at 5.7%, inside the program's ~5–10% band (grounding with weight, not domination;
the trace-shaper's R4 memorization warning caps the upside).

**New-class sizing reasoning:** 6,000 rows (18.4%), the same total as run 13 —
run 13's diagnosis names six distinct failure mechanisms (well rotation, shell
selection collapse, two context-missing doors, two copy-garble mechanics, explain
perishability, reach discrimination), each sized 800–1,200 so no single new shape
floods the base distribution that carries the capability suites. The gate, not
the ratio, decides whether it worked (trace-shaper §5.2).

**Validation:** all 6,000 addition rows pass the repo's own `validateTranscript`,
their evidence tokens equal `canonicalEvidence(steps)`, and `encodeTranscript`
reproduces each row's text byte-for-byte (`validate-additions.ts`: 6,000 validated,
0 failures). All addition surface content is invented in `build_dataset.py` — no
unrestriction (or any suite) item text is copied or paraphrased; the leakage pass
below is the mechanical check, and it dropped **0** addition rows and **0** real rows.

## Leakage — the traces-v1 checks over the FULL assembled dataset

Checks (build_traces_v1.py's implementation, same calibration as runs 10–13:
normalized prompt match; KX ticker match against every frozen file; 48-char
normalized shingles over fact-carrying content — prompt + result blocks + answer
block — with the `<|call|>` grammar header excluded on both sides): **292 drops,
all from the base** — 220 frozen-shingle overlaps vs `eval/v1/cases.jsonl`, 72
frozen-ticker matches (the generator's fictional KXHIGH tickers are drawn from the
same pools the fixtures were built from; seed 30 regenerated colliding tickers,
as seeds 26–29 did).

Calibration: the identical checks over run 9's shipped `data.jsonl` drop 342 of
30,000 (1.14%); run 14's base rate is 292 of 25,000 (1.17%) — the same order as
run 10's 268 (1.07%), run 11's 302 (1.21%), run 12's 278 (1.11%) and run 13's 271
(1.08%). Run 14 is not held to a harsher standard than the incumbent recipe.

**Frozen-hash verification (after the build): all 9 recorded hashes match the
program spec §1 inventory exactly** — v1 `079df97b…`, domains-v1 `da429fa8…`,
CAPBENCH `ca1bbc75…`, CAPBENCH heldout `b77f2307…`, UNRESTRICTION `92ade216…`,
UNRESTRICTION heldout `92cb0be0…`, trading frozen-set v1 `fb7bd205…`, Watcher-Q
`293db891…`, Curator `26e8d918…`. No suite item is in any training row, and the
suites are byte-identical to their freeze records.

## Gate (program §6.2 — judged after this pipeline's gate stage, then the full §6.1 step 3)

- **MEET:** domains-v1 > 76.6% with v1 ≥ 70.2%, fabrication 0.0% on both suites.
- **SURPASS:** domains-v1 ≥ 78.6% and v1 ≥ 72.2%, fabrication 0.0% on both, no
  other frozen suite regressing > 1.0 pt against the previous run (run 13: closed
  loop 10/18 = 55.6% is the line this run must not fall below by more than the
  allowance), and shell evidence not below run 13's level (domains tool_choice
  53.8%; unrestriction shell_exec 1 selection / 1 FULL — a low floor, but run 13's
  verdict also names the failure *direction*: selection must recover toward
  run 12's level without scope collapsing again).
- **Shell blocker (§9.3) reported by name:** shell-v1 is not yet frozen, so the
  blocker cannot clear in this turn; run 14's verdict will carry it as an open
  blocker.
- Disposition reads (trading v1, unrestrict-v1) follow the gate per runs 9–13's
  pattern.

## Compute

Run 9's observed ruler: 5,000 steps in 15,327 s ≈ **4.3 h wall** on this VM
(CPU-only, `PY=~/workspace/nexus-taste/.venv/bin/python`, torch 2.14.1+cpu).
Run 14 is the same recipe and step count at 32,580 rows (run 13: 32,601), so the
same order of wall time is expected — an estimate from that ruler, not a
promise. Predict + gate + loop add minutes. The pipeline resumes after a
restart by re-running the identical command (finished stages skip; training
resumes from `ckpt/resume.pt`).

## Launch command

```
setsid nohup bash ~/workspace/run14/run-pipeline.sh > ~/workspace/run14-pipeline.log 2>&1 &
```

## Progress checks

- `tail ~/workspace/run14-pipeline.log` — stage log
- `tail ~/workspace/run14/train.log` — training steps/loss
- `cat ~/workspace/run14/gate.txt` — gate verdict when the pipeline completes
- `ls ~/workspace/run14/eval` — prediction files when predict finishes

## Deviations from run 13's recipe (each stated, none silent)

1. **`train.py` gets `--allow-real`** — same as runs 10–13, same reason: the
   dataset contains operator-authorized real rows (traces-v1, reshaped) and
   train.py refuses any non-synthetic row without the flag. The launcher
   (`run-pipeline.sh`) is a stage-for-stage mirror of pipeline.sh with this
   single flag added.
2. **Base regenerated at seed 30 with N=25,000.** Run 13 used seed 29; the loop
   task's "seed 26+N" is read as in runs 10–13 (the run-10 template's seed
   incremented per turn; N=25,000 is the candidate count in the same sentence).
   A fresh seed means run 14 is not a re-read of run 13's exact rows.
3. **Run 13's seven addition classes are replaced, not repeated** — rebuilt as
   the six classes above from run 13's graded diagnosis, per the loop recipe
   ("targeted synthetic classes rebuilt from THIS run's graded diagnosis").
4. **Total rows 32,580 vs run 13's 32,601** — the additions are the same 6,000;
   the base kept count differs only by seed-30's leakage drops (292 vs 271).
   The trainer's ctx filter drops **zero** rows (encode pre-check max 638 ≤ 640),
   so trained rows = written rows.
5. **The two over-ctx real episodes keep run 11's faithful splits unchanged** —
   the standing queue was cleared in run 11; no new shaped real records exist
   this turn (re-check recorded in the standing-queue note above).

## Discipline

Frozen eval stays frozen (verified by hash, above). Synthetic traces labeled
synthetic, never Guardian training data; the additions carry `guardian_eligible:
false` in-row. Real traces keep their traces-v1 provenance sidecars (splits carry
theirs plus the reshaped record); only their `<|ev:verified|>` subset is
Guardian-eligible, as before. No changes to nexus-trader or the live Bank. Local
files only; no git operations this turn.
