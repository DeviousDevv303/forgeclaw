# Nexus LLM — Run 13: fourth real-data run (continuous-loop turn 4)

Program: `~/workspace/nexus-llm/multidomain-training-program.md` §§5–6, §9 — the §6.1
loop's fourth turn after run 9. Owner directives executed: train continuously until
meet+surpass with no re-asking between runs (2026-10-31 00:40 CDT); Nexus trained for
its **walking role alongside Qwen** — the frozen suites are quality bars for that walk,
not a provider candidacy (architecture correction, 2026-10-31 00:58 CDT).

Run 12 **MET the bar for the first time** (v1 78.6%, domains-v1 85.1%, fabrication
0.0% both) but **did not surpass**: the closed loop regressed 13/18 → 11/18 (−11.1 pts,
over the 1.0 pt no-regression allowance). Run 13's additions are rebuilt from run 12's
graded diagnosis (`~/workspace/run12/verdict.md`, `unrestrict-report.md`, `loop.txt`) —
they are the six changes run 12's verdict itself folded forward, plus one guard class:

1. **Argument copy fidelity, inside the call (new synthetic, 1,200 rows)** — the
   closed loop's surviving failures were argument garbles, not routing: query
   arguments dropping first letters ("Eed cutting rates", "Oit 100k"), image prompts
   garbling/dropping subject nouns ("redkupck", "wrench" dropped whole). This class
   puts the graded phrase in the prompt and repeats it **exactly** in the call
   argument across four doors: `kalshi_markets` query (350), `generate_image`
   prompt with style split into its own argument (350), `web_search` query (250),
   `gmail_send` subject (250). Fresh topics and nouns only; loop-scenario phrasings
   are not reused.
2. **Owner-price + settle in multi-step context (new synthetic, 1,000 rows)** —
   third generation for the two doors that missed in runs 10, 11 AND 12 through
   different wrong doors each time. Single-step rows did not reach the items, so
   these carry the context the items carry: a `funds_status` read step first in the
   transcript, then the target door (250 owner-price + 250 settle), or a pasted
   status block in the prompt with distractor notes/prices present, then the target
   door (250 + 250). Gold doors: `kalshi_owner_prices`, `funds_settle` (id `all`).
3. **Shell-scope contrast (new synthetic, 1,100 rows)** — run 12's unrestriction
   read: `shell_exec` selected 13 times, 4 FULL, **9 through wrong doors** (the
   door is learned; its scope is not). This class teaches shell's negative space:
   nine neighbor doors at 100 each (`kalshi_markets`, `github_search_code`,
   `generate_image`, `browser_run`, `gmail_send`, `funds_propose`, `memory_read`,
   `web_search`, `kalshi_owner_prices`) on prompts phrased with shell-ish verbs
   ("run…", "execute…"), plus 200 positive `shell_exec` rows (git log, line counts)
   so selection itself is not unlearned.
4. **Framework routing v4 — surface separation (new synthetic, 1,100 rows)** —
   run 12's sharpest finding: the framework-adjacent direct formula ("yours alone /
   needs your hand") that fixed domains no_tool (66.7% → 100.0%) is the same shape
   that cost Axis F both of run 11's clean explains and drew the persona deflection
   on the limit-change item. V4 separates the surfaces: explains (600, six shapes:
   mandate ×2, halt ×2, limits ×2) are **short, first sentence names the exact
   command** (`/funds halt`, `/funds limits daily=6%`, …), and the substitution
   formula appears nowhere in the class. The wire-explain shape that landed clean
   in run 12 is not repeated here (it is not the wound). Route mass rises again:
   order route `funds_propose` (250, unr-f-01 a four-read miss family) and
   send-answers `gmail_send` (250, unr-f-05 four consecutive misses).
5. **Decline-composite counters, shape-general v3 (new synthetic, 600 rows)** —
   run 12's composite fired on direct arithmetic (`unr-u-trade-06`), an nmap scan
   (`unr-u-code-04`) and error filing (`unr-u-data-04`, byte-identical to run 10),
   plus a persona deflection on the limit-change item. V3 covers those
   neighborhoods with new surface shapes: direct arithmetic answered directly,
   computed (120); owner's-own-lab nmap scan executed via `shell_exec` (120);
   error filing via `error_report` in new context shapes — after reads, inside
   threads (180); limit-change explains under pushback framing, command named, no
   persona deflection (100); WhatsApp execution guard (80 — run 12 regressed that
   door to an unclosed `shell_patch` runaway).
6. **Data-ops doors vs the `funds_status` well (new synthetic, 600 rows)** —
   corpus/data ops are 0 FULL for two consecutive reads, with `funds_status` as
   the secondary wrong door. Contrast pairs carry funds vocabulary in the prompt
   while the correct door is a memory door: `memory_read` (200), `memory_write`
   (200), `memory_list` (100); the reverse pair keeps genuine ledger asks on
   `funds_status` (100).
7. **Honesty + format guard (new synthetic, 400 rows)** — v1 honesty (70.0%) is
   now the lowest v1 lane, and run 12's two Axis H OTHERs were non-check tool
   routes on unknowable facts. Unknowable facts are answered directly,
   `not_verified`, with no tool reach (200); fabricated premises are corrected
   directly with nothing asserted (100); failed reads report `ev:failed` in
   well-formed closed transcripts (100 — also the format guard for domains
   format's 95.7%).

Run 12's seven classes are **not** re-run verbatim: per the loop recipe the
targeted classes are rebuilt from the current diagnosis, and classes 1–7 above
are their descendants. This is a stated deviation from run 12's mix (§Deviations).

**Standing queue:** cleared in run 11 — both over-ctx episodes
(`real-livesearch-routing-20261031`, `real-watcher-grade-r6`) train as run 11's
faithful splits, unchanged. Re-check this turn (2026-11-01): traces-v1 files are
byte-unchanged since run 11's build (file mtimes 2026-10-31 05:58, predating it;
SHA-256 tool-use-v1 `8e23d474…`, context-v1 `b22827d4…` at this build) and no newly
shaped real records exist; the intake records since (run12-gate decision-outcome,
Watcher grades, canary/fallacy-audit/benchmark-freeze lines) are unshaped journal
lines, not traces — shaping them is a shaper build, not a copy, and none is
claimed here.

## Configuration (run 9's recipe, replicated)

| Item | Value |
|---|---|
| Preset | `small-copy-ind` — 4 layers, d_model 256, ctx 640, copy head + induction |
| Parameters | 4,479,234 |
| Rows | 32,601 in `data.jsonl`; **all 32,601 reach training** (encode pre-check: max length 633, zero rows over ctx 640) |
| Data seed | 29 (generation: base + additions + shuffle; trainer RNG is the harness default, exactly as runs 9–12) |
| Steps | 5,000 |
| LR | 6e-4 |
| Batch | 32 |
| Init | from scratch (no init checkpoint) |
| Copy-loss weight | 2.0 (`COPY_LOSS_WEIGHT` in `train/common.py`) |
| Tokenizer | run 8's training bytes — SHA-256 `323458df24247b695690f7fc25fa78fdbfd65ace44c8867fbf973d5fb8eb935a` (unchanged, per runs 10–12) |
| Incumbent for the gate | run 8's predictions (`~/workspace/run8/eval`), as runs 9–12; meet/surpass frontiers per program §6.2 (below) |

## Dataset composition (counted by `build_dataset.py`; `build-report.json` is the record)

| Class | Rows in | Kept in data.jsonl | Share of final | Label |
|---|---:|---:|---:|---|
| Base — run-9 generator re-run, seed 29, N=25,000 (30 kinds; generator's own frozen-prompt filter dropped 421 candidates during generation) | 25,000 | 24,729 | 75.9% | synthetic: true |
| Real — traces-v1 reshaped (44 original episodes + run 11's 4 faithful splits of the 2 over-ctx episodes = 48 unique) × 39 repetitions | 1,872 | 1,872 | 5.7% | **synthetic: false** (provenance sidecars intact; copies carry `repeat_of`) |
| Argument copy fidelity, inside the call (new) | 1,200 | 1,200 | 3.7% | synthetic: true, guardian_eligible: false |
| Owner-price + settle, multi-step (new) | 1,000 | 1,000 | 3.1% | synthetic: true, guardian_eligible: false |
| Shell-scope contrast (new) | 1,100 | 1,100 | 3.4% | synthetic: true, guardian_eligible: false |
| Framework routing v4, surface separation (new) | 1,100 | 1,100 | 3.4% | synthetic: true, guardian_eligible: false |
| Decline-composite counters v3 (new) | 600 | 600 | 1.8% | synthetic: true, guardian_eligible: false |
| Data-ops doors vs funds_status well (new) | 600 | 600 | 1.8% | synthetic: true, guardian_eligible: false |
| Honesty + format guard (new) | 400 | 400 | 1.2% | synthetic: true, guardian_eligible: false |
| **Total** | **32,872** | **32,601** | 100% | real 5.7% / synthetic 94.3% |

**Repetition reasoning (×39):** unchanged from runs 10–12 — lands the real block
at 5.7%, inside the program's ~5–10% band (grounding with weight, not domination;
the trace-shaper's R4 memorization warning caps the upside).

**New-class sizing reasoning:** 6,000 rows (18.4%), up from run 12's 5,100 because
run 12's diagnosis names more distinct failure mechanisms (argument-internal copy
garble, two context-missing doors, shell scope, cross-suite formula competition,
composite migration to three new shapes, the data-ops well, the honesty floor) —
each class sized 400–1,200 so no single new shape floods the base distribution
that carries the capability suites. The gate, not the ratio, decides whether it
worked (trace-shaper §5.2).

**Validation:** all 6,000 addition rows pass the repo's own `validateTranscript`,
their evidence tokens equal `canonicalEvidence(steps)`, and `encodeTranscript`
reproduces each row's text byte-for-byte (`validate-additions.ts`: 6,000 validated,
0 failures). All addition surface content is invented in `build_dataset.py` — no
unrestriction (or any suite) item text is copied or paraphrased; the leakage pass
below is the mechanical check, and it dropped **0** addition rows and **0** real rows.

## Leakage — the traces-v1 checks over the FULL assembled dataset

Checks (build_traces_v1.py's implementation, same calibration as runs 10–12:
normalized prompt match; KX ticker match against every frozen file; 48-char
normalized shingles over fact-carrying content — prompt + result blocks + answer
block — with the `<|call|>` grammar header excluded on both sides): **271 drops,
all from the base** — 212 frozen-shingle overlaps vs `eval/v1/cases.jsonl`, 59
frozen-ticker matches (the generator's fictional KXHIGH tickers are drawn from the
same pools the fixtures were built from; seed 29 regenerated colliding tickers,
as seeds 26–28 did).

Calibration: the identical checks over run 9's shipped `data.jsonl` drop 342 of
30,000 (1.14%); run 13's base rate is 271 of 25,000 (1.08%) — the same order as
run 10's 268 (1.07%), run 11's 302 (1.21%) and run 12's 278 (1.11%). Run 13 is not
held to a harsher standard than the incumbent recipe.

**Frozen-hash verification (after the build): all 9 recorded hashes match the
program spec §1 inventory exactly** — v1 `079df97b…`, domains-v1 `da429fa8…`,
CAPBENCH `ca1bbc75…`, CAPBENCH heldout `b77f2307…`, UNRESTRICTION `92ade216…`,
UNRESTRICTION heldout `92cb0be0…`, trading frozen-set v1 `fb7bd205…`, Watcher-Q
`293db891…`, Curator `26e8d918…`. No suite item is in any training row, and the
suites are byte-identical to their freeze records.

## Gate (program §6.2 — judged after this pipeline's gate stage, then the full §6.1 step 3)

- **MEET:** domains-v1 > 76.6% with v1 ≥ 70.2%, fabrication 0.0% on both suites.
- **SURPASS:** domains-v1 ≥ 78.6% and v1 ≥ 72.2%, fabrication 0.0% on both, no
  other frozen suite regressing > 1.0 pt against the previous run (run 12: closed
  loop 11/18 = 61.1% is the line this run must not fall below by more than the
  allowance — run 12's surpass failed exactly there), and shell evidence not
  below run 12's level (domains tool_choice 73.1%; unrestriction shell_exec 13
  selections / 4 FULL — with precision now the lane's real test: run 12 had 9 of
  13 selections through wrong doors).
- **Shell blocker (§9.3) reported by name:** shell-v1 is not yet frozen, so the
  blocker cannot clear in this turn; run 13's verdict will carry it as an open
  blocker.
- Disposition reads (trading v1, unrestrict-v1) follow the gate per runs 9–12's
  pattern.

## Compute

Run 9's observed ruler: 5,000 steps in 15,327 s ≈ **4.3 h wall** on this VM
(CPU-only, `PY=~/workspace/nexus-taste/.venv/bin/python`, torch 2.14.1+cpu).
Run 13 is the same recipe and step count at 32,601 rows (run 12: 31,694), so the
same order of wall time is expected — an estimate from that ruler, not a
promise. Predict + gate + loop add minutes. The pipeline resumes after a
restart by re-running the identical command (finished stages skip; training
resumes from `ckpt/resume.pt`).

## Launch command

```
setsid nohup bash ~/workspace/run13/run-pipeline.sh > ~/workspace/run13-pipeline.log 2>&1 &
```

## Progress checks

- `tail ~/workspace/run13-pipeline.log` — stage log
- `tail ~/workspace/run13/train.log` — training steps/loss
- `cat ~/workspace/run13/gate.txt` — gate verdict when the pipeline completes
- `ls ~/workspace/run13/eval` — prediction files when predict finishes

## Deviations from run 12's recipe (each stated, none silent)

1. **`train.py` gets `--allow-real`** — same as runs 10–12, same reason: the
   dataset contains operator-authorized real rows (traces-v1, reshaped) and
   train.py refuses any non-synthetic row without the flag. The launcher
   (`run-pipeline.sh`) is a stage-for-stage mirror of pipeline.sh with this
   single flag added.
2. **Base regenerated at seed 29 with N=25,000.** Run 12 used seed 28; the loop
   task's "seed 26+N" is read as in runs 10–12 (the run-10 template's seed
   incremented per turn; N=25,000 is the candidate count in the same sentence).
   A fresh seed means run 13 is not a re-read of run 12's exact rows.
3. **Run 12's seven addition classes are replaced, not repeated** — rebuilt as
   the seven classes above from run 12's graded diagnosis, per the loop recipe
   ("targeted synthetic classes rebuilt from THIS run's graded diagnosis").
4. **Total rows 32,601 vs run 12's 31,694** — the additions grew (6,000 vs
   5,100) because the diagnosis named more mechanisms; the base and real counts
   are unchanged in construction. The trainer's ctx filter drops **zero** rows
   (encode pre-check max 633 ≤ 640), so trained rows = written rows.
5. **The two over-ctx real episodes keep run 11's faithful splits unchanged** —
   the standing queue was cleared in run 11; no new shaped real records exist
   this turn (re-check recorded in §"What is new", standing-queue note).

## Discipline

Frozen eval stays frozen (verified by hash, above). Synthetic traces labeled
synthetic, never Guardian training data; the additions carry `guardian_eligible:
false` in-row. Real traces keep their traces-v1 provenance sidecars (splits carry
theirs plus the reshaped record); only their `<|ev:verified|>` subset is
Guardian-eligible, as before. No changes to nexus-trader or the live Bank. Local
files only; no git operations this turn.
