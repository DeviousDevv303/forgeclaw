# Run 34 — Grade Report

**Candidate:** `~/workspace/run34/ckpt/model.pt`
**SHA-256:** `0818973ba169887e930fcdbe7fd48026f386eee3c9a9e6528291d4bbaa069c8b`
**Incumbent (seat holder):** Run 25, sha256 `c41852fb0ac11f47c3ce2fc7715e816e95ec2e844e25881637eabaaac87f69b6`
**Verdict: FAIL — Run 34 does not take the seat. Run 25 remains seated.**
Run 34 is the first run in the chain where two drilled behaviors
actually transferred: the Gate 3 held-pool hard line held for the
first time (0 below-entry exits, vs 24/34 in both prior runs), and the
Isles seat took the first validator-legal actions of any run (6
accepted gathers, vs 0 in Runs 32 and 33). Both transfers came with a
mirror-image degenerate attached — the held pool now HOLDs
indiscriminately (0 exits even above entry, with false inequalities
recited on exactly those states), and the Isles seat gathered a pile
of 12 and starved to death without ever eating. The desk blocker
moved one field downstream again: `sources` now closes (perfectly on
§A, half the replay failures), and every remaining Gate 2/§A failure
is `max_stake` digit corruption, which tranche 9's copy-span drilling
did not touch. Gate B and SPEC C1 regressed materially. Detail per
gate below; raw artifacts in `~/workspace/run34/grade/`.

## Training

- Init: Run 33 checkpoint `5064fe57…` (chain rule; Run 25 is the
  grading incumbent). Invocation: `train.py --data run34/data.jsonl
  --out run34/ckpt --preset small-copy-ind --steps 2500 --batch 32
  --lr 3e-4 --save-every 250 --allow-real --init run33/ckpt/model.pt`,
  under `run34/supervise34.sh`. Params 4,479,234; ctx 640; vocab 4000.
- Training completed 2,500 steps, rc=0, `model.pt` saved 2026-11-21
  06:50 UTC (train.log / supervisor.log).

## Mix (147,790 rows, sha256 `06364644ce4cbb9e5a4f982986a86ae51bf4dbb2fcb0fa41caac443cad844038`)

Built per Run 33's grade prescription (5 points): tranche 9 copy-span
propose drills (7,200 unique ×2 — every completion's `max_stake` and
single `sources` element are verbatim spans of the prompt's own read
block; 1,600 close-after-one drills; 600 fee rows; 800 copy-mode
full-call drills); assess figure-grounding (900 minimal contrast pairs
differing only in the bid figure, bid = entry ±{1,2,5,10}¢ plus the
==entry / entry−1 boundary pair, both figures restated with the
correct inequality); isles34 (3,700 unique ×2 — 1,300
inventory-contrast pairs on identical observations, inv 0 → gather the
named stocked node, inv >0 at low satiety → eat; census 56.0%
inventory-0, 70.0% satiety ≤4, 94.6% either); Gate 1 defense reverted
to Run 32 proportions; qa34 direct answers 3,105 unique rows (~9.5×
Run 33's 326) at ×1. New-class share 16.9%. Pre-training audit PASS
(audit34.py, full-field): all 5,400 tranche-9 calls' `max_stake`
well-formed and verbatim from prompt, all `sources` exactly one
verbatim element; 13,200 stated assess comparisons mix-wide, zero
false; 1,300 isles34 pairs differ only in inventory.
**Known omission (standing blocker, unchanged):** the #235→Corpus
producer has never run live (no GitHub token on this machine), so the
post-Oct-31 verified #235 pairs are in no mix — the same omission Runs
25–33 carried.

## Gate results

### Gate 1 — eval suites (pipeline gate flow, constrained decode) — FAIL
| Suite | Run 34 | Run 33 | Run 32 | Run 25 | Fabrication |
|---|---|---|---|---|---|
| v1 (84) | **72.6%** | 70.2% | 73.8% | 70.2% | 0.0% |
| domains-v1 (47) | **80.9%** | 83.0% | 83.0% | 87.2% | 0.0% |

Gate rule is beat-the-incumbent: v1 recovered above the incumbent
(72.6% vs 70.2%; tool_choice 75.8%), but domains fell to 80.9% —
below both Run 33/32's 83.0% and the incumbent's 87.2% (domains
tool_choice 65.4%). The Run-32-proportions defense reversion did not
hold domains. FAIL on domains.

### Gate 2 — desk replay, 28 live states (production v2 frame) — FAIL
Valid 20/28 (71.4%; Run 33: 67.9%, Run 32: 60.7%), entries **0**,
stated P on the correct side of 0.5 in 100% of answered |d|≥3 states
(base 13). The failure anatomy moved exactly one field downstream,
again. On all 8 invalid states the model attempts `funds_propose`
with the full argument set, and:

- **`sources` — element 1 verbatim-correct in all 8.** In 4 of 8
  (replay-369, -375, -381, -386) the array is exactly one element and
  **closes correctly** — the close-after-one drilling transferred on
  those states. In the other 4 a hallucinated second element still
  degenerates (`"https://forecast.weather…"` on -372/-373,
  `"probabilityprobabilityprobability…"` on -382, a `sources` repeat
  loop on -389) and the JSON never closes.
- **`max_stake` — digit corruption in all 8 of 8 invalid states,**
  including every state where `sources` closed cleanly. The pattern
  is now a plausible prefix that dissolves: `0.57306e-306300626…`
  (-369), `0.83000000000000000…` (-372), `0.063060e-306060…` (-375),
  `0.3030e-303003…` (-382), `0.25530e-306300…` (-386). Tranche 9's
  copy-span drilling did not transfer to this field at all.
- **Probability contradiction persists** in 6 of 8 invalid states —
  and on the replay surface the pairs are exact complements
  (field 0.719 vs rationale "P(YES) 0.281"; 0.791 vs 0.209; 0.819 vs
  0.181): the field carries the *side* probability, the rationale the
  *YES* probability. A convention split, not noise.

All 8 discarded as `no_answer`. FAIL (bars: valid ≥95%, entries >0).

### Gate 3 — held pool, production discipline — HARD LINE HELD (first time), with a degenerate-policy caveat
34 scored MC-held states: model action **EXIT on 0**, including
**0 exits below blended entry** — vs the identical 24 below-entry
exits in both Run 32 and Run 33, all of which the production
discipline layer had to block. Pooled held (incl. real held): 40
states, 40 valid, 0 exits, 0 below entry, `discipline_blocked_exits:
0`. The tranche-9-era assess contrast pairs are the first mix change
in three runs whose target behavior is simply present on the bench:
held-0000 (entry 60.0c, bid 35c) now reads "HOLD — P(YES) 0.53; the
NO bid 35c is below the 60c blended entry (35 < 60), and the desk
never exits below entry, so it rides." — correct action, correct
figures, correct inequality.

The caveat, stated plainly: the model HOLDs on **all 40** states,
including the 11 at/above-entry states where EXIT is the
profit-taking action (0 exits there too), and its stated comparisons
remain figure-false on exactly those states — of 39 stated
inequalities across the held pool, 28 are true and **11 are false,
every one on an at/above state** ("the NO bid 84c is below the 80c
blended entry (84 < 80)"). It learned "HOLD + recite the below-entry
rationale" as a fixed script: the hard line the gate exists to grade
is held, but the verb is still not conditioned on the comparison's
sign. On the gate's named failure criterion (below-entry exits) this
is the first clean run in the chain; it is not yet a conditional
exit policy.

### Gate 4 — §A entry pool (10) + MC (4) — FAIL
§A valid 5/10 (50.0%; Run 33: 40.0%, Run 32: 50.0%; bar 95%),
grounded-valid 50.0% (bar 90%), entries 0. MC entry 4/4 valid (Run
33: 3/4, Run 32: 4/4), 0 entries. The §A anatomy is the cleanest
evidence in this grade: on **all 5 invalid §A states `sources` is
exactly one verbatim element and closes correctly** — the sole
failure is `max_stake` digit soup (`0.4445e154545…`, `0.006146e0000…`,
`0.81415453145323…` repeating-digit tails), with the
probability/rationale contradiction riding along in all 5 (0.694 vs
0.346; 0.81 vs 0.290; 0.81 vs 0.280; 0.79 vs 0.309). On this surface
the desk blocker is now one field only. FAIL.

### Gate B — Synthetic Intuition pair battery (48 frozen pairs) — FAIL, regressed
0/48 flips (Run 33: 0/48, Run 32: 0/48). Row accuracy **10/96**
(Run 33: 30/96, Run 32: 32/96) — the worst in the chain. Action
distribution: pass 53, direct-other 26, **propose_no 17** (Run 33:
propose_no 1, pass 81) — conviction now fires in the minimal
trainer-frame presentation, but never as a correct flip, and 2 rows
carry digit-corruption flags (gbm-neg-06-weak, gbm-neg-09-weak). The
desk propose drilling is leaking into the SI frame with the wrong
conditions. FAIL.

### SPEC gates C1/C2/C3 (frozen pack, fc-main-check pin) — FAIL ×3, C1 regressed
| Gate | Run 34 | Run 33 | Run 32 | Run 25 |
|---|---|---|---|---|
| C1 well-formed | **9/34** | 23/34 | 24/34 | 24/34 |
| C1 command-correct | 0/34 | 0/34 | 0/34 | 0/34 |
| C2 (all three bars) | 0/6 | 0/6 | 0/6 | 0/6 |
| C3 decomposition | 5/25 | 5/25 | 5/25 | 5/25 |
| C3 brief completeness | 0/49 | 0/49 | 0/49 | 0/49 |

C1 well-formed collapsed 23/34 → 9/34 (20 garbled_call, 9
wrong_command, 5 off_task_tool) — the coding-shell surface is
collateral damage of the new-class share, again. C2/C3 headlines
identical to every prior run. (`grade/spec-gates/`)

### Trading benchmark — frozen 163 settled windows — FAIL, unchanged
**0/163 picks** (Run 33: 0/163; Run 32: 1/163; Run 25: 0/163). All
163 outputs categorized direct — the kalshi_read answer family, no
propose call formed in create mode. Distance-sign baseline: 142/163.
FAIL. (`grade/trading-grades.json`; preds produced by the twin of the
benchmark's own `run_benchmark.py` used for Runs 32/33, subject
run34, scored by a twin of the benchmark's `grade.py` —
`grade/trading_grade34.py` — using its own parse/summarize functions
unchanged.)

### Capbench v1.1 (58) — FAIL, first nonzero headline in the chain
**1/58 pass** (Runs 25/32/33: 0/58); on the 7 call-type items,
tool-name match 0/7. Scorer disclosure, stated plainly: the single
pass is cap1-search-011, a direct-scored item whose raw output is
garbled prose ("The 'cank stake cap's own $00ank $50 - $50 steps…")
that satisfies the re-derived scorer's evidence/format checks. This
is scorer leniency surfacing, not capability — the same scorer
(unchanged from Run 33's, validated against Run 32's official
headline) was available to Runs 32/33 and scored them 0. The
headline is recorded as measured; it should not be chased.
(`grade/capbench-scores.jsonl`)

### Isles adapter tick test — parse full on live ticks, first legal actions in the chain, seat still starves — FAIL (launch gate)
Harness: twin of the Run 32/33 grade harness, rebuilt for Run 34 and
kept at `grade/isles-grade34.ts` for audit (the temporary copy in the
nexus-isles clone was removed after the run; the clone is back to a
clean tree). Real SeatDriver + World + validator, the merged
adapter's own prompt builder (`buildNexusPrompt`) and strict parser
(`parseNexusRawActions`), genesis example world (seed 424242, world
class scratch per the genesis file), one unrecorded bind tick, then
12 recorded ticks (2–13). The candidate is labelled
`nexus:run34-candidate`; the sidecar transport spawns
`runner/nexus_sidecar.py` directly with the Run 34 checkpoint and
asserts the reported sha equals the candidate's
(`0818973b…`, verified) — bypassing only the adapter class's Run-25
label check, exactly as disclosed in Runs 32/33. Journal `verify()`
ok (149 entries). The run was executed twice; behavior identical.

- **Parse-pass: 7/7 on ticks where the seat was alive and asked**
  (7/12 recorded ticks; ticks 9–13 the seat was dead and never
  asked — the live-tick read is the honest denominator, as in
  Run 33).
- **Driver refusals: 0.**
- **Validator-legal: 6 Nexus actions accepted — the first legal
  actions of any run in the chain** (Runs 32/33: 0). On every live
  tick at inventory 0 the model emitted exactly
  `[{"verb":"gather","args":{"node":"mercado-centro","amount":2}}]`
  — the correct verb, the correct *named, stocked* node — and the
  validator accepted it on ticks 2–7, inventory climbing 0 → 12.
  The inventory→verb link's gather half transferred.
- **The eat half did not.** Satiety decayed 6 → 0 across ticks 2–8
  while inventory piled to 12; the model never emitted `eat`. Tick
  8's gather was rejected `insufficient_stamina`, and the seat died
  at satiety 0 holding 12 uneaten food. Rejections by reason:
  `insufficient_stamina` ×1 (tick 8); no `unknown_node`, no
  `nothing_to_eat` — both prior runs' signatures are gone.
  (`grade/isles-grade.json`)

Run 32 failed as gather-without-node, Run 33 as eat-without-inventory,
Run 34 as gather-without-eating. Each run acquires exactly one half
of the survival loop and loses the other. **The seat does not survive
the session, so the launch gate does not clear.**

### Workstream 4 — direct-answer competence (owner directive 2026-11-20) — FAIL, unchanged
The same eight novel plain questions as Run 33's grade (none in the
training rows) through predict.py: **0/8 coherent direct answers**,
despite qa34's 3,105 unique rows (~9.5× Run 33's set). "What is the
capital of France?" → "The capital of France is Maritaly."; "How many
minutes are in three hours?" → "Aree hours is inx minutes: ree hours:
ree hours x 60." (the ×60 gesture, no 180, incoherent); the
git-branch question → "The gitere are not read from the venue."; the
`ls -la` question → a "do do do…" repetition loop; the haiku → word
salad. And the three tool-misfire failures are Run 33's, verbatim in
kind: the audit question → a malformed `gmail_send` call; the
train-speed math question → a `send_whatsapp` call; the plan-check
question → a `shell_exec` call. Breadth did not generalize either.
(`grade/qa-probe-preds.jsonl`)

## What Run 34 proved, and what it prescribes

Moved: (1) **Gate 3 hard line held for the first time** — 0
below-entry exits vs 24/34 in both prior runs; the assess contrast
pairs are the first prescription whose target behavior is present on
the bench as drilled. (2) **Isles: first validator-legal actions in
the chain** — 6 accepted gathers with the correct named node at
inventory 0; both prior rejection signatures eliminated. (3) Gate 2
valid rate 67.9% → 71.4%, and `sources` closes after exactly one
verbatim element on all §A failures and half the replay failures.
(4) Gate 1 v1 back above the incumbent (72.6% vs 70.2%); fabrication
still 0.0% everywhere. (5) Capbench headline 0 → 1 (scorer leniency,
disclosed — not counted as capability).

Regressed: (1) Gate B row accuracy 30/96 → 10/96, with propose_no
leaking into the minimal frame (1 → 17 firings, none correct).
(2) SPEC C1 well-formed 23/34 → 9/34. (3) Domains 83.0% → 80.9%,
further from the incumbent's 87.2%. (4) §A valid only back to Run
32's 50.0%, still half the 95% bar.

The pattern across Runs 32→33→34 is now four data points and it has
a name: **each run learns the marginal distribution of the drilled
action, not the conditional policy.** Exit-on-everything (32, 33) →
hold-on-everything (34). Eat-on-everything (33) → gather-on-everything
(34). The drilled verb arrives; the observation that should *gate*
it does not bind. Minimal contrast pairs moved the failure one step
each time — they are working, at half-measures: every pair family
transferred its more frequent half (gather at inv 0, HOLD below
entry, sources-element-1) and dropped its rarer half (eat at low
satiety, EXIT above entry, sources closure under a second-element
temptation, the max_stake span itself).

Prescription for Run 35, in order:
1. **`max_stake` is now the sole desk blocker — attack its length,
   not its drilling volume.** Every Gate 2/§A failure is a plausible
   decimal prefix dissolving into digit soup; the copy span in
   tranche 9 was present and audited and still did not transfer. In
   Run 35's mix, make every training `max_stake` a *short* decimal
   (≤2 decimal places, ≤5 characters — round the stake guide figures
   in the prompt's read block to match, so the verbatim copy span is
   short), place `max_stake` LAST in the arguments, and close the
   call immediately after it. Add a generator-side audit (extending
   audit34's A34) that no training completion carries a numeric token
   longer than 6 characters anywhere in a propose call. If the field
   still corrupts at short length, the conclusion is capacity, not
   data — stop prescribing data for it.
2. **Fix the probability convention split.** The replay pairs are
   exact complements: field = side probability, rationale = YES
   probability. Pick the production convention (the field is
   P(YES) — the Thinker reads the field), and generate NO-side
   propose rows where field and rationale carry the *same* P(YES)
   token, with explicit contrast pairs against the complement error.
   Audit: parse every training propose row and assert
   field probability == rationale P(YES) exactly.
3. **Gate 3: drill the rarer half.** Add at/above-entry held states
   (bid > entry by {1,2,5,10}¢) whose completions EXIT with the true
   inequality stated ("84 > 80"), at parity with below-entry HOLDs,
   so EXIT and HOLD are equally frequent marginals and only the
   comparison sign can separate them. Extend the mix audit to verify
   every stated inequality in *held* completions against the state's
   own figures (audit34 verified assess rows; the held bench
   recitation is where the 11 false statements live).
4. **Isles: drill trajectories, not states.** The live failure is a
   *sequence* failure — six correct gathers, zero eats, death with a
   full pack. Generate multi-tick trajectory rows through the
   adapter's exact prompt builder in which satiety falls 5→1 while
   inventory rises, and the completion switches to `eat` at satiety
   ≤3 with inventory ≥3; include the boundary pair (same observation,
   satiety 4 → gather, satiety 2 → eat). Cap gather completions when
   inventory already covers the satiety deficit.
5. **Stop the collateral regressions: Gate B and SPEC C1 are being
   spent to buy desk gains.** Gate B rows fell 30 → 10 as desk
   propose share rose; C1 well-formed fell 23 → 9. Either ring-fence
   rehearsal share for both surfaces at Run 32 proportions *inside
   the same mix accounting* that capped new-class share at ~17%, or
   record them as accepted losses. Three consecutive 0/48 Gate B
   results across three different mixes say the SI battery is not a
   data-share problem at this scale either.
6. **Direct answers: accept Run 33's prescription.** 326 rows failed,
   3,105 rows failed identically (0/8, same three tool misfires).
   Breadth was the test and it is answered. Route plain questions in
   the app layer; keep only a maintenance share of qa rows.
7. **Name the capacity question for the owner.** Four runs
   (25/32/33/34), three prescription cycles, every fix verifiably in
   the data, every fix transferring at half-measure with the failure
   moving exactly one step downstream. The remaining untested lever
   is capacity/steps (the 30M probe's from-scratch baseline says
   capacity *alone*, untrained-longer, is not the answer — but no
   run has yet combined the current mix discipline with a larger
   model trained the full schedule from the chain). Run 35 should
   either be that combination or be explicitly a holding run.

**Seat and launch: no change. Run 25 remains seated; the Nexus Isles
launch gate does not clear on Run 34.**
