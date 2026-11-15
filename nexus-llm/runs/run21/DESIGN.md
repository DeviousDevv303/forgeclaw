# Nexus LLM — Run 21: twelfth real-data run (continuous-loop turn 12)

Program: `~/workspace/nexus-llm/multidomain-training-program.md` §§5–6, §9 — the §6.1
loop's twelfth turn after run 9. Owner directives executed: train continuously until
meet+surpass with no re-asking between runs (2026-10-31 00:40 CDT); Nexus trained for
its **walking role alongside Qwen** — the frozen suites are quality bars for that walk,
not a provider candidacy (architecture correction, 2026-10-31 00:58 CDT).

Run 20 was **BELOW BAR** (v1 **71.4%** — meet floor held by 1.2, surpass leg lost;
domains-v1 **72.3% counted 34/47**, failing the strict >76.6% meet leg by TWO items and
REJECTED outright by its gate; fabrication 0.0% both; closed loop 15/18; domains
evidence 90.9% best of loop; unrestriction Axis F total 4/6 best of loop, Axis U FULL
9/30, Axis H PASS 0/12 fourteenth straight, restriction events 2/36 primary / 0/36
alternate — both on owner doors). Run 21's additions are run 20's full 10,400 targeted
rows **held at full size** **plus 2,000 new rows in six classes (S1–S6) rebuilt from
run 20's graded diagnosis** (`~/workspace/run20/verdict.md` + `unrestrict-report.md` +
`gate.txt`), with the verdict's own counted diagnoses carried in:

**Diagnosis 1 — domains tool_choice, counted from run 20's verdict.**
Domains tool_choice fell 69.2% → **57.7% (15/26)** and the markets set went **zero of
four** (015/016/017/018 all direct, 017 carrying an owner-hands template variant) after
two consecutive re-seats — the verdict indicts the rows' *form*, not their count.
Class S1 (400) therefore re-seats markets in the **exact short natural firing shapes**
that fired in runs 17/19 and in the held dom/r classes (list / prices / likelihood /
check forms at `kalshi_markets`, fresh varied topics, no frozen tickers, 200), rebuilds
the settle-vs-status miss as **one paired contrast class** (100 interleaved:
`funds_settle` prompts → `funds_settle`, `funds_status` prompts → `funds_status` —
025's wrong partner for five straight reads and trd-8's same mechanic), and re-seats
the owner-price forms 023/024 **together** (100 `kalshi_owner_prices` rows at their
firing shapes).

**Diagnosis 2 — formation, not routing: runaway argument spans.**
v1 format fell 100.0% → 92.9% on unclosed runaway calls (v1 tool_choice-016's
`web_search`, domains tool_choice-002's `generate_image`, plus unrestriction
trade-06's unclosed `shell_exec`). Class S2 (300) applies the browser-closure method
to those two doors: short closed `web_search` (150) and `generate_image` (150) calls,
query/prompt arguments carried whole and **terminated**.

**Diagnosis 3 — copy fidelity moved inside call arguments.**
The closed loop fell 17/18 → 15/18 on trd-1/trd-2: calls fired but their query
arguments garbled the graded term's **first letter** ("Eed" for "fed", "gcoin" for
"bitcoin") — while the figure-copy method that fixed domains 008 proves the method
works at the answer surface. Class S3 (300) trains query-argument copying across
`kalshi_markets` / `github_search_code` / `web_search` (100 each): the prompt carries
the term and the call's query argument copies it character-for-character, first
letter included (fresh topics built from common terms — fed, bitcoin, rates, oil,
gold — never frozen tickers or frozen prompts; the leakage pass below dropped 2 of
these rows whose prompts exactly matched a frozen prompt, as designed).

**Diagnosis 4 — the decline template moved to the owner door.**
Run 20's two restriction events were owner-02 (email, pure decline head) and
owner-03 (spawn, decline composite substituting a halt command) — the counter worked
where aimed (f-06's limits site closed) and fired where it wasn't. Class S4 (400)
extends the counter to the owner door's own prompt forms at the limits extension's
scale: email at `gmail_send` (100), spawn at `spawn_agent` with spawn-door forms
specifically and **never a halt substitution** (100), WhatsApp at `send_whatsapp`
(100), sculpt at `sculpt_self` (100) — correct shape is the routed owner-hands call,
never the decline template. The standing counter (600) and the limits extension stay
seated in the held classes, per run 14's lesson.

**Diagnosis 5 — framework's remaining two items.**
Axis F's whole remaining miss set is f-02 (mandate: fifth consecutive miss in
substance; run 20's fragment already names the issuance surface and the binds-nothing
fact, with stake/goal/governors still absent) and f-04 (wire: never a route or an
explain in fourteen reads). Class S5 (300) gives both the counted-diagnosis treatment:
mandate explains (150) carrying stake, goal, governors (5% stake cap, 30% exposure
cap, 10% daily-loss stop), arena, issuance surface (`/funds`) and the binds-nothing
fact in varied forms; wire explains (150) carrying the target shape — the ledger
never holds or moves money itself, the transfer happens venue-side, `/funds add`
records it. f-01/f-03/f-05/f-06 hold at run 20's full mass in the held classes.

**Diagnosis 6 — v1 evidence sequences flipped sign.**
Evidence fell 75.0% → 68.8%: the four two-read sequences still fail, but run 20's
class — aimed at under-claiming — flipped them to **over-claiming** (`ev:verified`
on 008/010/012). Class S6 (300) is rebuilt around verdict-token arithmetic, 4 patterns
× 75, on paraphrased runtime-state prompts (never the frozen strings), UNWRAPPED:
no-ok pairs (read+list errors → `failed`), no-ok with a reasoning error (→ `failed`),
ok-read + later error (→ `verified` — run 20 R4's arithmetic held as the contrast so
the correction does not overshoot), and no-read-at-all states (→ direct
`not_verified`). Pure-state singles stay held at full size in the held evid classes
so no 005-type regression pays for this. The verdict's named small rows are handled
inside the held mass, not a new class: 003's list-files shape is already held at
`v21_list_files` (100, run 20's class N); 027's expected door is not named in run 20's
gate/verdict outputs (only that `github_pr_info` was the wrong tool), so no pr_info
rows were invented — disclosed in Deviations.

**Standing queue:** both over-ctx episodes (`real-livesearch-routing-20261031`,
`real-watcher-grade-r6`) train as run 11's faithful splits, unchanged. Re-check
this turn (2026-11-04): traces-v1 files are byte-unchanged (SHA-256 tool-use-v1
`8e23d474…`, context-v1 `b22827d4…`, same as run 20's check) and no newly shaped
real records exist; intake records since are unshaped journal lines, not traces —
none is claimed here.

## Configuration (run 9's recipe, replicated)

| Item | Value |
|---|---|
| Preset | `small-copy-ind` — 4 layers, d_model 256, ctx 640, copy head + induction |
| Parameters | 4,479,234 |
| Rows | 38,969 in `data.jsonl` (encode pre-check: max length 634, **zero rows over ctx 640** — the trainer drops nothing this run) |
| Data seed | 37 (generation: base + additions + shuffle; trainer RNG is the harness default, exactly as runs 9–20) |
| Steps | 5,000 |
| LR | 6e-4 |
| Batch | 32 |
| Init | from scratch (no init checkpoint) |
| Copy-loss weight | 2.0 (`COPY_LOSS_WEIGHT` in `train/common.py`) |
| Tokenizer | run 8's training bytes — SHA-256 `323458df24247b695690f7fc25fa78fdbfd65ace44c8867fbf973d5fb8eb935a` (unchanged, per runs 10–20; the pipeline's train stage uses it as before) |
| Incumbent for the gate | run 8's predictions (`~/workspace/run8/eval`), as runs 9–20; meet/surpass frontiers per program §6.2 (below) |

## Dataset composition (counted by `build_dataset.py`; `build-report.json` is the record)

| Class | Rows in | Kept in data.jsonl | Share of final | Label |
|---|---:|---:|---:|---|
| Base — run-9 generator re-run, seed 37, N=25,000 (30 kinds; generator's own frozen-prompt filter dropped 398 candidates during generation) | 25,000 | 24,702 | 63.4% | synthetic: true |
| Real — traces-v1 reshaped (44 original episodes + run 11's 4 faithful splits of the 2 over-ctx episodes = 48 unique) × 39 repetitions | 1,872 | 1,872 | 4.8% | **synthetic: false** (provenance sidecars intact; copies carry `repeat_of`) |
| All run-20 targeted classes, held at full size (decline counter 600, shell 900, domains 1,000, copy v9 500, loop doors 800, memory/owner 550, framework v11 1,100, evidence v2 850, v1 holding 600, v1 re-aim 300, browser 100, WhatsApp contrast 100, honesty 400, owner-price/settle 400, code-search 100, send pairs 100, R1–R6 2,000) | 10,400 | 10,397 | 26.7% | synthetic: true, guardian_eligible: false |
| S1 domains tool_choice repair (markets forms 200 / settle-status pair 100 / owner-price 100) | 400 | 400 | 1.0% | synthetic: true, guardian_eligible: false |
| S2 closed-formation (web_search 150 / generate_image 150) | 300 | 300 | 0.8% | synthetic: true, guardian_eligible: false |
| S3 copy fidelity into call arguments (markets 100 / code 100 / web 100) | 300 | 298 | 0.8% | synthetic: true, guardian_eligible: false |
| S4 decline counter, owner doors (email 100 / spawn 100 / WhatsApp 100 / sculpt 100) | 400 | 400 | 1.0% | synthetic: true, guardian_eligible: false |
| S5 framework mandate (150) + wire (150) explains | 300 | 300 | 0.8% | synthetic: true, guardian_eligible: false |
| S6 evidence verdict-token arithmetic (4 patterns × 75) | 300 | 300 | 0.8% | synthetic: true, guardian_eligible: false |
| **Total** | **39,272** | **38,969** | 100% | real 4.8% / synthetic 95.2% |

**Repetition reasoning (×39):** unchanged from runs 10–20 (the mirror value).
At run 21's larger targeted total it lands the real block at 4.8%, just below the
program's ~5–10% band — disclosed as a deviation below, not silently adjusted,
because this turn's instructions fixed both the repetition mirror and the
12,400-row additions target.

**Validation:** all 12,400 addition rows pass the repo's own `validateTranscript`,
their evidence tokens equal `canonicalEvidence(steps)`, and `encodeTranscript`
reproduces each row's text byte-for-byte (`validate-additions.ts`: 12,400 validated,
0 failures). The build is deterministic: a full re-run reproduced `data.jsonl`
byte-for-byte (SHA-256 `8e9aa09d…` both times). All addition surface content is
invented in `build_dataset.py` — no unrestriction (or any suite) item text is
copied; the leakage pass below is the mechanical check.

## Leakage — the traces-v1 checks over the FULL assembled dataset

Checks (build_traces_v1.py's implementation, same calibration as runs 10–20:
normalized prompt match; KX ticker match against every frozen file; 48-char
normalized shingles over fact-carrying content — prompt + result blocks + answer
block — with the `<|call|>` grammar header excluded on both sides): **303 drops —
298 from the base** (225 frozen-shingle overlaps, 73 frozen-ticker matches — seed
37 regenerated colliding KXHIGH tickers, as seeds 26–36 did) **and 5 addition rows**
(3 `mem21_intake_list` prompt variants that exactly matched a frozen prompt — the
same standing variant family runs 18/19/20's builds dropped — plus 2
`s21_copy_markets` rows from S3 whose prompts exactly matched a frozen prompt;
the pass dropped all five, as designed). No other S1–S6 row was dropped.

Calibration: the identical checks over run 9's shipped `data.jsonl` drop 342 of
30,000 (1.14%); run 21's base rate is 298 of 25,000 (1.19%) — the same order as
runs 10–20. Run 21 is not held to a harsher standard than the incumbent recipe.

**Frozen-hash verification (after the build): all 9 recorded hashes match the
program spec §1 inventory exactly** — v1 `079df97b…`, domains-v1 `da429fa8…`,
CAPBENCH `ca1bbc75…`, CAPBENCH heldout `b77f2307…`, UNRESTRICTION `92ade216…`,
UNRESTRICTION heldout `92cb0be0…`, trading frozen-set v1 `fb7bd205…`, Watcher-Q
`293db891…`, Curator `26e8d918…`. No suite item is in any training row, and the
suites are byte-identical to their freeze records.

## Gate (program §6.2 — judged after this pipeline's gate stage, then the full §6.1 step 3)

- **MEET:** domains-v1 > 76.6% with v1 ≥ 70.2%, fabrication 0.0% on both suites.
- **SURPASS:** domains-v1 ≥ 78.6% and v1 ≥ 72.2%, fabrication 0.0% on both, no
  other frozen suite regressing > 1.0 pt against the previous run (run 20: v1
  71.4%, domains-v1 72.3%, and closed loop 15/18 = 83.3% are the lines this run
  must not fall below by more than the allowance), and shell evidence not below
  run 20's level (domains tool_choice 57.7%; unrestriction shell_exec 10
  attempts / 4 FULL).
- **Shell blocker (§9.3) reported by name:** shell-v1 is not yet frozen, so the
  blocker cannot clear in this turn; run 21's verdict will carry it as an open
  blocker.
- Disposition reads (trading v1, unrestrict-v1) follow the gate per runs 9–20's
  pattern.

## Compute

Run 9's observed ruler: 5,000 steps in 15,327 s ≈ **4.3 h wall** on this VM
(CPU-only, `PY=~/workspace/nexus-taste/.venv/bin/python`, torch 2.14.1+cpu);
run 20 observed its trainer completing across reboot/silent-death relaunches at
37,009 rows. Run 21 is the same recipe and step count at 38,969 rows, so the
same order of wall time is expected — an estimate from those rulers, not a
promise. Predict + gate + loop add minutes. The pipeline resumes after a
restart by re-running the identical command (finished stages skip; training
resumes from `ckpt/resume.pt`).

## Launch command

```
setsid nohup bash ~/workspace/run21/run-pipeline.sh > ~/workspace/run21-pipeline.log 2>&1 &
```

## Progress checks

- `tail ~/workspace/run21-pipeline.log` — stage log
- `tail ~/workspace/run21/train.log` — training steps/loss
- `cat ~/workspace/run21/gate.txt` — gate verdict when the pipeline completes
- `ls ~/workspace/run21/eval` — prediction files when predict finishes

## Deviations from run 20's recipe (each stated, none silent)

1. **`train.py` gets `--allow-real`** — same as runs 10–20, same reason: the
   dataset contains operator-authorized real rows (traces-v1, reshaped) and
   train.py refuses any non-synthetic row without the flag. The launcher
   (`run-pipeline.sh`) is a stage-for-stage mirror of pipeline.sh with this
   single flag added.
2. **Base regenerated at seed 37 with N=25,000.** Run 20 used seed 36; the loop
   task's "seed 26+N" is read as in runs 10–20 (the run-10 template's seed
   incremented per turn; N=25,000 is the candidate count in the same sentence).
3. **Targeted total 12,400 vs run 20's 10,400; total rows 38,969 vs run 20's
   37,009** — the holds-plus-mass build above, counted in the composition table.
   The trainer's ctx filter will drop **zero** rows this run (encode pre-check
   max 634 ≤ 640; zero base, addition, or real rows over ctx), so trained rows
   = written rows.
4. **The two over-ctx real episodes keep run 11's faithful splits unchanged** —
   the standing queue was cleared in run 11; no new shaped real records exist
   this turn (re-check recorded in the standing-queue note above).
5. **Builder provenance, disclosed:** run 21's `build_dataset.py` was produced
   by `transform_build.py` from run 20's builder (the runs 18→19→20 pattern):
   renames (20→21 with 19→20 history, seed 36→37, fw11→fw12) plus the six
   appended S1–S6 classes. One rename beyond the task's literal list, disclosed:
   the lowercase kind prefix `r20_` → `r21_` — the task's `R20→R21` rename alone
   left run 20's R-class kinds labeled `r20_*` (in the runs 18→19→20 transforms
   this never arose, because each source builder's R-kinds were only its own new
   classes, written fresh in the transform); applying the lowercase rename aligns
   the held R-class labels with every other held class and keeps `r21_` in
   ADD_PREFIXES classifying them as additions. No held class's size, shape, or
   wrapping behavior changes; S6 sets the builder's existing `WRAP_HOLD` flag
   around its rows only, as run 20's R4 did.
6. **Real share 4.8% at the unchanged ×39 repetition** — just below the ~5–10%
   band's floor, a consequence of the fixed 12,400-row additions target at the
   mirror repetition value (see Repetition reasoning). Counted and stated, not
   adjusted silently.
7. **S6 small-row note, disclosed:** the 003 greeting/list-files and 027 rows the
   task allowed *inside* S6 if space allowed were not added as separate rows —
   S6 is kept at exactly 4 patterns × 75 = 300 to hold the 2,000-row new total;
   003's shape is already held at full size (`v21_list_files`, 100) and 027's
   expected door is not named in the graded outputs available, so no row was
   invented for it.

## Discipline

Frozen eval stays frozen (verified by hash, above). Synthetic traces labeled
synthetic, never Guardian training data; the additions carry `guardian_eligible:
false` in-row. Real traces keep their traces-v1 provenance sidecars (splits carry
theirs plus the reshaped record); only their `<|ev:verified|>` subset is
Guardian-eligible, as before. No changes to nexus-trader or the live Bank. Local
files only; no git operations this turn.
