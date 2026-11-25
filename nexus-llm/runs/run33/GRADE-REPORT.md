# Run 33 — Grade Report

**Candidate:** `~/workspace/run33/ckpt/model.pt`
**SHA-256:** `5064fe5785670a5697386cf6513d52d8832c17907ae5145134d293afd693095c`
**Incumbent (seat holder):** Run 25, sha256 `c41852fb0ac11f47c3ce2fc7715e816e95ec2e844e25881637eabaaac87f69b6`
**Verdict: FAIL — Run 33 does not take the seat. Run 25 remains seated.**
Every frozen gate failed. Run 33's four mix fixes were verified present in
the data and audited before training; none of them transferred to the
bench surfaces. Two surfaces regressed vs Run 32 (v1, §A), the held-pool
hard line broke with the *identical* count as Run 32 (24 below-entry
exits), and the Isles seat changed its failure verb (eat-loop instead of
node-less gather) without ever taking a legal action. Detail per gate
below; raw artifacts in `~/workspace/run33/`.

## Training

- Init: Run 32 checkpoint `1fc8bc03…` (chain rule; Run 25 is the grading
  incumbent). Invocation: `train.py --data run33/data-v2.jsonl
  --out run33/ckpt --preset small-copy-ind --steps 2500 --batch 32
  --lr 3e-4 --save-every 250 --allow-real --init run32/ckpt/model.pt`,
  under `run33/supervise33.sh`. Params 4,479,234; ctx 640; vocab 4000.
- Training completed 2,500 steps, final loss 0.1069, `model.pt` saved
  2026-11-21 00:23 UTC (train-v2.log; the run absorbed repeated VM
  replacements via resume.pt, 6 resume blocks in the final log chain).

## Mix (129,237 rows, sha256 `79d57ea2c0d5d15e2f4e71b7bb1ea548d12eb2f58456be3dbbb8b0cc73d33ccb`)

Base mix 128,585 rows (sha256 `217cb7db…`, full-field audit PASS) + 326
direct-answer rows ×2 (workstream 4) = data-v2. The base mix implements
Run 32's four prescriptions: tranche 8 propose rows with the complete
production argument set (all 3,800 propose-bearing rows carry max_stake
AND a single-element sources array); tranche 6 restored in full (assess
classes back); Isles rows rebuilt as node-choice contrast pairs (all
1,700 gather targets name a node; swap + priority pairs over
adapter-rendered observations, plus eat-low and hungry-gather twins);
new-class share capped at 17.4% (from 31.2%); domains defense doubled.
**Known omission (standing blocker, unchanged):** the #235→Corpus
producer has never run live (no GitHub token on this machine), so the
post-Oct-31 verified #235 pairs are in no mix — the same omission Runs
25–32 carried.

## Gate results

### Gate 1 — eval suites (pipeline gate flow, constrained decode) — FAIL
| Suite | Run 33 | Run 32 | Run 25 | Fabrication |
|---|---|---|---|---|
| v1 (84) | **70.2%** | 73.8% | 70.2% | 0.0% |
| domains-v1 (47) | **83.0%** | 83.0% | 87.2% | 0.0% |

Gate rule is beat-the-incumbent: v1 fell back to exactly the incumbent's
70.2% (Run 32's +3.6 gain lost; tool_choice 69.7%), and domains stayed at
83.0% — the doubled domains defense and the 17.4% new-class cap did not
recover the incumbent's 87.2% (domains tool_choice 69.2%). FAIL.

### Gate 2 — desk replay, 28 live states (production v2 frame) — FAIL
Valid 19/28 (67.9%; Run 32: 60.7%), entries **0**, stated P on the
correct side of 0.5 in 100% of answered |d|≥3 states (base 12). The
anatomy moved one field later: on all 9 invalid states the model now
attempts `funds_propose` and the argument set **does include `sources`**
— the first element is even correct (`"kalshi_markets
KXBTC15M-26NOV101930-30"`) — but the array's later elements degenerate
(`"side,"`, `"price0","price0","price0.64,"`, prose fragments about
/funds approve) and **`max_stake` digit corruption persists**
(`0.3030e-30300303030300300030300000003000261520`). The JSON never
closes; the Thinker discards all 9 as `no_answer`. A second defect rides
along: `arguments.probability` contradicts the rationale (0.774 in the
field vs "P(YES) 0.226" in the text on replay-372). FAIL (bars: valid
≥95%, entries >0).

### Gate 3 — held pool, production discipline — FAIL (hard line broken, identical to Run 32)
34 scored states: model action **EXIT on all 34**, including **24 exits
below blended entry** — the exact Run 32 count, with all 24 blocked by
the production discipline layer (`discipline_blocked_exits: 24`). The
tranche-6 assess restoration did not repair the line. The raw output on
held-0000 (entry 60.0c, bid 35c) is now a *fluent* false comparison:
"EXIT at 35c — the NO bid 35c is at or above the 60c blended entry
(35 >= 60), so the desk sells here." Run 32's version was garbled; Run
33's asserts the false inequality cleanly. Pooled held (incl. MC-held):
40 exits, 29 below entry. FAIL.

### Gate 4 — §A entry pool (10) + MC (4) — FAIL
§A valid 4/10 (40.0%; Run 32: 50.0%; bar 95%), grounded-valid 40.0%
(bar 90%), entries 0. MC entry 3/4 valid (Run 32: 4/4), 0 entries. FAIL.

### Gate B — Synthetic Intuition pair battery (48 frozen pairs) — FAIL
0/48 flips (Run 32: 0/48, Run 31: 0/48). Row accuracy 30/96 (Run 32:
32/96). Action distribution: pass 81, direct-other 14, propose_no 1,
propose_yes 0 — conviction still never fires in the minimal
trainer-frame presentation. No corrupt rows. FAIL.

### SPEC gates C1/C2/C3 (frozen pack, fc-main-check pin) — FAIL ×3, unchanged
| Gate | Run 33 | Run 32 | Run 25 |
|---|---|---|---|
| C1 well-formed | 23/34 | 24/34 | 24/34 |
| C1 command-correct | 0/34 | 0/34 | 0/34 |
| C2 (all three bars) | 0/6 | 0/6 | 0/6 |
| C3 decomposition | 5/25 | 5/25 | 5/25 |
| C3 brief completeness | 0/49 | 0/49 | 0/49 |

Every headline identical to the incumbent except C1 well-formed −1.
(`run33/spec-gates/`)

### Trading benchmark — frozen 163 settled windows — FAIL
**0/163 picks** (Run 32: 1/163; Run 25: 0/163). All 163 outputs
categorized direct — the kalshi_read answer family, no propose call
formed in create mode. Distance-sign baseline: 142/163. FAIL.
(`run33/trading-grades.json`; runner twinned from the benchmark's own
`run_benchmark.py` twin used for Run 32, subject run33.)

### Capbench v1.1 (58) — FAIL, unchanged headline
0/58 pass; on the 7 call-type items, tool-name match 0/7 (the other 51
items are final/direct-scored; none passed). Identical headline to Runs
25 and 32. **Scorer disclosure:** the original staged-suite scorer script
used for Runs 25/32 is not on disk; Run 33 was scored with a scorer
re-derived from the frozen items' expect blocks and the rubric in
`nexus-llm/runs/capbench-v1/RESULTS.md` + `eval/score.ts` parsing
semantics (`run33/score_capbench33.py`). Before use it was validated
against Run 32: applied to `run32/capbench-preds.jsonl` it reproduces
the official headline exactly (0/58 pass, toolOk false on all 7 call
items, 0 violations). (`run33/capbench-scores.jsonl`)

### Isles adapter tick test — parse partial, validator-legal FAIL
Harness: twin of the Run 32 grade test (temporary file, removed after
the run; the nexus-isles clone is back to a clean tree). Real SeatDriver
+ World + validator, the merged adapter's own prompt builder
(`buildNexusPrompt`) and strict parser (`parseNexusRawActions`), genesis
example world (seed 424242), one unrecorded bind tick, then 12 recorded
ticks (2–13). The candidate is labelled `nexus:run33-candidate`; the
sidecar transport spawns `runner/nexus_sidecar.py` directly and asserts
the reported sha equals the candidate's — bypassing only the adapter
class's Run-25 label check, exactly as disclosed in Run 32's grade.
Journal `verify()` ok (135 entries).

- **Parse-pass: 7/7 on ticks where the seat was alive and asked**
  (7/12 recorded ticks; ticks 9–13 the seat was dead and never asked —
  Run 32's harness recorded stale raws on those ticks, this one records
  none; the live-tick read is the honest denominator).
- **Driver refusals: 0.**
- **Validator-legal: 0 actions accepted.** The model never gathered.
  On every live tick it emitted exactly
  `[{"verb":"eat","args":{"amount":3}}]` with inventory 0, rejected
  `nothing_to_eat` on ticks 2–8; the output never varied with the
  observation, and the seat starved to satiety 0 and died.
  (`run33/isles-grade.json`)

Run 32's failure was gather-without-node (`unknown_node`); Run 33's is
eat-without-inventory (`nothing_to_eat`). The node-choice contrast
drilling did not transfer to the live adapter frame — no gather was
ever emitted. **The launch gate does not clear.**

### Workstream 4 — direct-answer competence (owner directive 2026-11-20) — FAIL
Eight novel plain questions (none in the training rows) through
predict.py: 0/8 coherent direct answers. "What is the capital of
France?" → "The capital of France is Tit of F."; "How many minutes are
in three hours?" → repetition loop; the git-branch explanation and the
`ls -la` question → garbled fragments; the audit question → a malformed
`gmail_send` call; the train-speed math question → a `send_whatsapp`
call to a fabricated number; the plan-check question → a `shell_exec`
call (`kill -np | grep test`). The 652 qa33 instances taught the
training rows' own answers without generalizing to novel plain
questions. (`run33/qa-probe-preds.jsonl`)

## What Run 33 proved, and what it prescribes

Moved: (1) Gate 2 valid rate 60.7% → 67.9% and the propose attempt now
carries the full argument set including `sources` — the drilled field
appears; it just doesn't survive. (2) Held-pool failure text is fluent
now (the garble is gone; the false comparison remains). (3) Fabrication
still 0.0% on both Gate 1 suites.

Regressed: (1) v1 73.8% → 70.2% (back to the incumbent). (2) §A valid
50.0% → 40.0%, MC entry 4/4 → 3/4. (3) Trading 1 pick → 0 picks.
(4) Isles live-tick behavior changed verb without gaining a single
legal action.

The pattern across Runs 32→33 is the finding: **each run's mix fixes
are verifiably in the data, and each fix moves the failure exactly one
step downstream without closing it** — sources omitted → sources
present but degenerating after element 1; max_stake drilled in
isolation → still corrupt inside complete calls; garbled assess →
fluent assess with the same false inequality; node-less gather →
no gather at all. The model is learning the *shape* of each drilled
surface at 4.5M/2,500 steps without the figure-grounding the gates
grade.

Prescription for Run 34, in order:
1. **Digit integrity inside complete calls is the desk blocker.** Drill
   max_stake and sources as *copy spans from the prompt's own read
   block* inside complete propose calls (the tranche-7 copy drills
   existed but were isolated); add a hard generator-side audit that
   every propose completion's max_stake is a well-formed decimal in
   (0, cap] and every sources element is a verbatim substring of the
   prompt. Consider shortening sources to the single-element form the
   production caller actually sends (tranche 8 already used
   single-element sources in training — the bench model still
   hallucinates extra elements; add explicit close-after-one-element
   drills with the array closing immediately).
2. **Assess figure-grounding, not assess shape.** The fluent false
   inequality (35 >= 60) says the comparison itself is unlearned.
   Generate assess pairs that differ ONLY in the bid figure crossing
   the entry figure (minimal numeric contrast pairs, bid ∈ entry±{1,2,
   5,10}c), with the completion restating both figures and the correct
   inequality token; audit pre-mix that no completion asserts a false
   comparison (the mix audit checked labels — extend it to parse and
   numerically verify every stated inequality in every assess
   completion).
3. **Isles: teach the observation→verb link, not just node naming.**
   Run 33 never gathered because eat-when-hungry fired without the
   inventory precondition. Add contrast pairs on IDENTICAL observations
   differing only in inventory (0 → gather from the visible stocked
   node; >0 at low satiety → eat), rendered through the adapter's exact
   prompt builder, and low-satiety/inventory-0 states as the majority
   of Isles rows (the live seat starts at satiety 8/inventory 0 and
   the bench's first decision is always gather-or-starve).
4. **Gate 1 defense is not a data-share problem anymore.** Domains
   stayed at 83.0% despite doubled defense and a 17.4% cap, and v1
   gave back Run 32's gain — at this scale the rehearsal is saturated.
   Stop spending mix share here; hold the Run 32 rehearsal proportions
   and accept Gate 1 as a tie-risk, or raise capacity (the 30M probe's
   from-scratch baseline says capacity alone, untrained-longer, is
   not the answer either).
5. **Direct-answer rows need breadth, not instances.** 326 unique
   rows ×2 did not generalize. Either grow unique direct-answer rows
   by an order of magnitude with held-out-style variety, or accept
   that the 4.5M desk model does not carry a general QA surface and
   route plain questions elsewhere in the app layer.

**Seat and launch: no change. Run 25 remains seated; the Nexus Isles
launch gate does not clear on Run 33.**
