# Run 32 — Grade Report

**Candidate:** `~/workspace/run32/ckpt/model.pt`
**SHA-256:** `1fc8bc03f4f554328299e2f936a7f608542e0f3c53766c0dbecf9ab861bdb84a`
**Incumbent (seat holder):** Run 25, sha256 `c41852fb0ac11f47c3ce2fc7715e816e95ec2e844e25881637eabaaac87f69b6`
**Verdict: FAIL — Run 32 does not take the seat. Run 25 remains seated.**
Every frozen gate failed. Two surfaces moved materially (Isles format,
production-frame entry attempts); two regressed (domains suite, held-pool
discipline). Detail per gate below; raw artifacts in `~/workspace/run32/`.

## Training

- Init: Run 31 checkpoint `797ff15e5612cbfd906bceb7953851e3ea85bceccab6905e6aa5ba6b64d7cce9`
  (chain rule: init from the previous run; Run 25 is the grading incumbent).
- Invocation (mirror of Runs 30/31): `train.py --data run32/data.jsonl
  --out run32/ckpt --preset small-copy-ind --steps 2500 --batch 32
  --lr 3e-4 --save-every 250 --allow-real --init run31/ckpt/model.pt`,
  under `run32/supervise.sh`. Params 4,479,234; ctx 640; vocab 4000;
  115,776 of 115,785 rows loaded; max len 637.
- Wall: launched 2026-11-19 23:03 UTC, completed 2026-11-20 03:56 UTC
  (rc=0) across **three VM restarts**, all absorbed by the supervisor
  (resumes at step 1500 and step 2250).

## Mix (115,785 rows, sha256 `20f85c781ad329d2310b7629610927c6a3bbf1af77023afe6ea34318a458c801`)

| Block | Unique | Reps | Instances |
|---|---|---|---|
| Run 25 rehearsal (carries defense + Oct real slice) | 48,699 | ×1 | 48,699 |
| Defense extra (dom24_/honesty24_/evid24_) | 2,250 | ×1 | 2,250 |
| Tranche 3 kept (assess/propose classes out) | 1,370 | ×2 | 2,740 |
| Tranche 4 kept (assess AND propose out — old dialect) | 1,467 | ×2 | 2,934 |
| Tranche 5 kept (assess out) | 4,600 | ×2 | 9,200 |
| Tranche 6 kept (assess out, superseded by t7) | 4,600 | ×3 | 13,800 |
| Tranche 7 desk (new) | 8,600 | ×3 | 25,800 |
| Isles engine rows (new) | 3,450 | ×3 | 10,350 |
| Real block missing rows (via PR #424 `load_real_block`) | 3 of 47 | ×4 | 12 |

**Known omission (standing blocker):** the #235→Corpus producer has never
run live (no GitHub token on this machine), so the post-Oct-31 verified
#235 pairs are not in this mix — the same omission Runs 25–31 carried.

**Tranche 7** (generator `run32/gen_tranche7.py`, seed 3207; production
fee function imported from `trader_agent`; NO book = exact complement of
the YES book everywhere): recognition-first propose in tool frame (1,900)
and direct frame (1,400), fee-eaten recognition-first (300), 800
recognition-only minimal pairs (hi enters / lo passes on the same prompt),
600 book-only control pairs, 600 recognition-first assess pairs
(EXIT at/above entry, HOLD below), 1,000 digit-integrity copy drills
(tickers, prices, probabilities, max_stake as weighted copy spans).
Recognition segment precedes the route token in every completion
(pack v1.1 §10). Pre-mix audit PASS after two caught-and-fixed generator
defects (pass rows' recognition order; pass-edge band solved to
[−3, 0.3]c so no pass row states an entry-grade edge).

**Isles rows** (3,450): generated inside the nexus-isles engine from real
genesis worlds (30 variants × 40 ticks, both seats recorded through a
RecordingBackend wrapping the engine's own survivalPolicy) plus
policy-consistent observation mutations; prompts rendered by the merged
adapter's own `buildNexusPrompt`; every target validated through the
driver's `parseBackendActions`. Classes: gather 1,500 / eat 1,200 /
idle 600 / directive 150.

**Synthetic Intuition pack v1.1** — located at
`~/workspace/fc-fix/nexus-llm/synthetic-intuition/PACK-V1.1.md`, sha256
verified `df158f084162069733896724163c7703a89593e788d21749f7e4dba7b3214654`
before use. Folded in as teachings (§10 recognition-before-route order;
class 7 recognition-action-gap pairs; NO-ask complement identity), not by
running the pack's blocked pilot builders (they require a frozen
mix-design JSON that does not exist on disk).

## Gate results

### Gate 1 — eval suites (pipeline gate flow, constrained decode) — FAIL
| Suite | Run 32 | Run 31 | Run 25 | Fabrication |
|---|---|---|---|---|
| v1 (84) | **73.8%** | 72.6% | 70.2% | 0.0% |
| domains-v1 (47) | **83.0%** | 87.2% | 87.2% | 0.0% |

Gate rule is beat-the-incumbent: v1 improved (+1.2 over R31, +3.6 over
R25) but domains **regressed** 87.2% → 83.0% (tool_choice 73.1%). FAIL.

### Gate 2 — desk replay, 28 live states (production v2 frame) — FAIL
Valid 17/28 (60.7%), entries **0**, stated P on the correct side of 0.5 in
100% of answered |d|≥3 states. The failure anatomy changed completely:
the model now **attempts** `funds_propose` with correct recognition
(side, probability, post-fee edge all right in the rationale — e.g.
replay-383 at −9.0 bps: P(YES) 0.008, NO ask 80.0c, edge +10.1c), but the
call dies in the **`sources` field** (degenerate repetition loops) and in
**`max_stake` digit corruption** (`1.930000404040000000040…`); the JSON
never closes and the Thinker discards the answer (11/28 `no_answer`).
Tranche 7 drilled max_stake in isolation but omitted `sources` from the
propose argument set entirely — the un-drilled field is where the call
breaks. FAIL (bars: valid ≥95%, entries >0).

### Gate 3 — held pool, production discipline — FAIL (hard line broken)
34 scored states: model action **EXIT on all 34**, including **24 exits
below blended entry** — the first below-entry model exits since the line
was established (Runs 29/30/31: zero). All 24 were blocked by the
production discipline layer (`discipline_blocked_exits: 24`), so the desk
would not have executed them, but the gate grades the model. Raw outputs
are garbled tranche-7 assess fragments asserting false comparisons
("EXIT at 35c — the NO bid 35c — the desk's at or above entry" on a
60.0c entry). FAIL.

### Gate 4 — §A entry pool (10) + MC (4) — FAIL
§A valid 5/10 (50.0%; bar 95%), grounded-valid 50.0% (bar 90%), entries 0.
MC entry 4/4 valid, 0 entries (unchanged from Run 31). FAIL.

### Gate B — Synthetic Intuition pair battery (48 frozen pairs) — FAIL
0/48 flips (Run 31: 0/48). Row accuracy 32/96. In the minimal
trainer-frame presentation the model never proposes (pass 77,
direct-other 19) — conviction fires only in the production frame
(Gate 2), not here. FAIL.

### SPEC gates C1/C2/C3 (frozen pack, fc-main-check pin) — FAIL ×3, unchanged
| Gate | Run 32 | Run 25 |
|---|---|---|
| C1 well-formed | 24/34 | 24/34 |
| C1 command-correct | 0/34 | 0/34 |
| C2 (all three bars) | 0/6 | 0/6 |
| C3 decomposition | 5/25 | 5/25 |
| C3 brief completeness | 0/49 | 0/49 |

Every headline identical to the incumbent. (`run32/spec-gates/`)

### Trading benchmark — frozen 163 settled windows — FAIL
**1/163 picks** (Run 25: 0/163), the single pick correct (>15 bps band).
162 outputs categorized direct: the kalshi_read answer family with
garbled tickers ("KXBTC-26OCTOCT-300"). Distance-sign baseline: 142/163.
FAIL. (`run32/trading-grades.json`; runner twinned from the benchmark's
own `run_benchmark.py`, subject run32 in create mode — Run 32's propose
rows are create-mode.)

### Capbench v1.1 (58) — FAIL, unchanged
0/58 pass, toolOk 0/58 — identical to Run 25. (`run32/capbench-scores.jsonl`)

### Isles adapter tick test — parse PASS, validator-legal FAIL
Harness: the real SeatDriver + World + validator, the merged adapter's
own prompt builder (`buildNexusPrompt`) and strict parser
(`parseNexusRawActions`), sidecar transport identical to the adapter's;
the candidate is labelled `nexus:run32-candidate` because the merged
adapter's checkpoint-sha check still names Run 25 (the harness bypasses
only that label check — disclosed in the test header,
`tests/runner/run32-grade.test.ts`, temporary). 12 driver ticks on the
genesis-example world (seed 424242), journal `verify()` ok.

- **Parse-pass: 12/12 (100%)** — every tick emitted a JSON action array.
  Run 25 emitted ForgeClaw tool format and was refused every tick.
- **Driver refusals: 0.**
- **Validator-legal: 0 actions accepted.** Every tick the model emitted
  exactly `[{"verb":"gather","args":{"amount":2}}]` — the required
  **`node` argument is missing**; the world validator rejected it
  (`ACTION_REJECTED: unknown_node`) on every live tick (2–8). The output
  never varied with the observation; the seat starved to satiety 0.
  (`run32/isles-grade.json`)

The Isles format target is met; the action content is not yet legal.
**The launch gate does not clear.**

## What Run 32 proved, and what it prescribes

Moved: (1) Isles output format — ForgeClaw grammar → strict Isles JSON,
12/12 parse. (2) Production-frame conviction — entry is now *attempted*
with correct recognition on decisive states, where Runs 25–31 attempted
nothing. (3) v1 suite +1.2/+3.6 with fabrication still 0.

Regressed: (1) domains-v1 −4.2 vs the incumbent. (2) Held-pool discipline
— the never-exit posture flipped to always-exit with garbled comparisons;
the recognition-first assess replacement for tranche 6's assess classes
is the prime suspect (same census, new text shape, ×3).

Prescription for the next run (Run 33), in order:
1. Propose rows must carry the **full production argument set including
   `sources`** (short, well-formed, copied from the prompt's own read
   block), with max_stake drilled *inside* complete calls, not only in
   isolation — the call must close.
2. Restore tranche 6's assess classes alongside (not instead of) any new
   assess shape, and add assess rows rendered in the **production v2
   frame** (build_obs phrasing) so figure-reading transfers to the bench
   surface; re-verify the below-entry line before any seat change.
3. Isles: add gather rows whose node argument is the *only* varying
   span across near-identical observations (node-choice contrast pairs),
   plus eat rows at satiety 0–2 with inventory > 0, until the emitted
   gather names the node visible in the observation.
4. Domains defense: rebalance — the domains tool_choice drop tracks the
   tranche-7/Isles instance share (31.2%); cap new-class share or add a
   domains rehearsal block.

## 30M probe

## 30M probe

**Checkpoint:** `~/workspace/run32/probe30m/ckpt/model.pt`
**SHA-256:** `7a3af586041a297e932fe3dac4f0d2197b2e505e044dfd9ad9d5770ad08f5c6e`
**Spec as trained:** preset `nexus-30m` (27,595,776 params), FROM SCRATCH
on the same Run 32 mix, lr 6e-4, batch 8, steps 500 (4,000 samples),
save-every 100, `--allow-real`. Completed 2026-11-20 08:14:55 UTC,
final loss 0.6937 (from 8.42 at init).

Spec history (all disclosed in STATUS.md as they happened): the original
1000×32 configuration OOM-killed (rc=137) ~80s into every launch on this
VM; batch 16 survived only on a freshly rebooted machine and died to
co-tenant memory spikes and three further VM reboots; the configuration
was cut in stages to the 500×8 above — a ~1h window with resume saves
every 100 steps — which completed. The probe is therefore a *small-sample*
scale probe, not the originally specced 32k-sample one; its numbers are
reported as such.

**Probe grades** (reduced battery: Gate 1, Isles, Capbench):

| Surface | Probe (30M, scratch, 4k samples) | Run 32 main (4.5M) | Run 25 |
|---|---|---|---|
| v1 | 46.4% | 73.8% | 70.2% |
| domains-v1 | 27.7% | 83.0% | 87.2% |
| Fabrication | 0.0% | 0.0% | 0.0% |
| Isles parse-pass | 0/12 | 12/12 | 0 (refused) |
| Isles validator-legal | 0 | 0 | 0 |
| Capbench v1.1 | 0/58 | 0/58 | 0/58 |

Probe Isles outputs are garbled JSON fragments (`{"verb":"m":"mercado-…`)
— the surface shape is present, the syntax is not yet. Read: at 4k samples
from scratch, the 27.6M preset is far behind the warm-started 4.5M lineage
on every surface. The probe establishes the from-scratch baseline for the
preset on this mix; it is not a seat candidate and was never gated as one.
