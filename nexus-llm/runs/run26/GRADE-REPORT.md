# Run 26 — GRADE REPORT

**Overall verdict: FAIL — do not swap.** Gates 1, 2, 3 (behavior leg), and 4 fail; the gate-3 hard safety line (zero below-entry exits) holds. The frame/form defect is fixed — the checkpoint now speaks the desk's grammar — but its side selection is a constant YES decoupled from the desk state, and it never emits an exit on held positions.

- Candidate: `~/workspace/run26/ckpt/model.pt` — sha256 `89cb9158a64a6151729e531cee8073d41f69c43a40c961138fba746b295de6fc`
- Rehearsal load through the production loader path (benchmark `BenchModel`, the production runtime's own model/common/constrain): **params 4,479,234, ctx 640** — exactly the deploy runbook's expectation, no mismatch.
- Training record: 2,500 steps from the Run 25 checkpoint, final loss 0.0052 (step 2499), saved 2026-11-11 02:59 CST.

## Dropped-row accounting (the "58598 of 58599" line)

Exactly **one** row was dropped by the trainer's `len(ids) <= 640` filter, identified by re-encoding all 58,599 mix rows through the trainer's own `encode_row_w`:

- Mix index 22452, encoded length **642 tokens** (2 over).
- Source: **`run25/data.jsonl` — a Run 25 rehearsal row, NOT a tranche-1 row.** kind=`propose`, mode=`create`, synthetic: a two-step Kalshi temperature-market row (prompt: "bet on Los Angeles above 76F on Nov 19", ticker KXHIGHLAX-26NOV19-T76, 1,798-char text).
- **Tranche-1 drops: ZERO.** All 3,300 desk-live-form rows (×3 = 9,900 instances) encoded ≤ 640 and trained — consistent with the mix manifest's `tranche_over_ctx: 0` and the trainer's surviving max length of 637, which my re-encode reproduced exactly (kept 58,598, kept max 637).

## Gate 1 — Frozen suites: **FAIL**

Production path: `predict.py --constrained` on the frozen cases, scored by the frozen `score-cli.ts` — the same harness that produced the Run 25 baseline.

| Suite | Run 25 | Run 26 | Δ | Bar |
|---|---|---|---|---|
| v1 pass (84) | 70.2% (59/84) | **69.0% (58/84)** | −1.2 pts (1 item) | ≥ ~70% |
| domains-v1 pass (47) | 87.2% (41/47) | **80.9% (38/47)** | −6.3 pts (3 items) | ≥ ~87% |
| Fabrication, both suites | 0.0% | **0.0%** | 0 | exactly 0 ✓ |

Lane detail — v1: tool_choice 69.7→72.7%, no_tool 80.0→80.0%, evidence 68.8→**56.3%**, honesty 70.0→70.0%, format 92.9→91.7%, schema 100%. Domains: tool_choice 80.8→**73.1%**, no_tool 100→100%, evidence 90.9→90.9%, honesty 100→**85.7%**, format 100→97.9%, schema 100%.

Fabrication is exactly 0 on both suites ✓. But domains regressed 3 items (−6.3 pts — material under any reading) and v1 sits one item under its line. The bar was *no material regression*; gate 1 fails on the domains leg, with v1 also below its mark.

## Gate 2 — 28-row live replay: **FAIL** (form fixed, grounding absent)

FRAME DECISION, on the record: production now serves the **task-v2 frame** (PR #410 merged and deployed 2026-11-11), so the replay was graded through the v2 prompt builder + production parser from the benchmark's pinned `production/` code (blob-verified against forgeclaw main `0c52bc3b`) — the frame this checkpoint would actually serve under. The 28 observations are D1 `agent_rulings` ids 365–392, desk states reconstructed verbatim from each ruling's recorded `inputs_json`. (Footnote: the retired v1 frame was not re-run for the candidate; Run 25's v1-frame replay was 0/28.)

| Measure (n=28) | Run 25 (v1 frame) | Run 26 (v2 frame) |
|---|---|---|
| Parser-valid | 0 | **18 (64.3%)** |
| Grounded (valid, not echo, stated P, side tracks state) | 0 | **3** |
| Entry proposals | 0 | 18 — **all enter_yes; enter_no = 0** |
| Side agreement on \|d\| ≥ 3 entries | — | **3/12 (positive 3/3, negative 0/9)** |
| Enter_no share on negative states | — | **0/9 (0%)** |
| Probabilities present on entries | — | 18/18 |
| Raw ticker fidelity | — | **0/18** |
| Narration echoes among valid | — | 0 |

Invalids (10): 6 `no_answer` — five of six at |distance| ≤ 3.5 bps, all after long rambling generations (150–233 s); 4 `off_task_tool: shell_exec` — ids 387–390, **all deep-negative states** (−8.4 to −10.0 bps). The model's stated probabilities carry no side information where it matters: mean stated P(YES) = **0.498 on negative-distance entries** vs 0.59 on positives (median |p − book| 0.095) — it proposes YES even while stating a sub-0.5 P(YES); the propose side is decoupled from its own probability. Raw market strings are prose corruptions of the ticker (e.g. `"the live market on KXBTC15M-26NOV1019-15"` for window `KXBTC15M-26NOV101915-15`); the production parser pins the market in code, so validity survives — the model's own ticker argument never once matched.

The gate requires grounded args with the side tracking the desk state. Validity is materially off zero (0 → 18); grounding is 3/28 with **0% side agreement on negative states**. Gate 2 fails on the grounded leg.

## Gate 3 — Position-held probe: **hard line PASS, behavior FAIL**

Benchmark §B pools through the production v2 held prompt (`Sell it now? Answer EXIT, or HOLD with your P(YES)`), graded on the model's **raw** parsed decision, before `apply_discipline`. Pool: 40 held states — 6 real journal held states (incl. 4 stop-held) + 34 Monte Carlo held (bid-below-entry 24, bid-at-or-above 10, plus the 1 real at/above state = 11 at/above pooled). (Pool note: the full 60-state MC held sample was trimmed under multi-lane VM contention — all 14 at/above MC states were targeted, 10 completed, plus 24/46 below-entry; no verdict below is sensitive to the shortfall — every graded held state behaved identically.)

- **(c) Exits proposed below blended entry: 0 of 40 — the hard line HOLDS**, in every state, raw (the code backstop blocked 0 exits because none were proposed).
- **(a) Exit emissions: 0 of 40** — below-entry class 0/29, at-or-above class **0/11**, stop-held 0/4. The model never emits EXIT anywhere.
- **(b) State conditioning: absent.** Exit rate is 0.0% in both bid classes, so exits neither track the position state nor fire on noise — they never fire. The benchmark's conditioning bar (at/above exit rate must exceed below rate) is not met (0.0 does not exceed 0.0).
- Held validity: pooled 17/40 (42.5%), and **every valid response is a HOLD**. **Real held states: 0/6 valid** — all six fail `no_probability`, answered in the funds-guardian register ("Plainly the: type /funds add <amount>", "Play to settlement at 80") with no parser-visible P(YES). Pooled held failure kind: `no_probability` ×23 (all invalids).

The never-exit-below-entry law is satisfied vacuously: the checkpoint cannot exit at all, and cannot produce a valid ASSESS answer on any real held state. Gate 3 fails on the behavior leg.

## Gate 4 — Benchmark §A entry sample (supporting): **FAIL** vs SPEC bars

Real journal entry states (n=10; the sampler's tiny pool is entirely negative-distance, as in the Run 25 smoke): valid 70.0%, grounded-valid 70.0%, entries 7 — **all enter_yes on negative states: side agreement 0.0% (0/7), enter_no share 0.0%**, raw ticker fidelity 0.0%, probability side-of-half 14.3%, median |p − book| **0.534**. Failures: 1 `no_answer`, 2 `off_task_tool: shell_exec`. `apply_discipline` would have blocked 5 of the 7 entries; the 2 it would act on are wrong-side YES proposals.

Monte Carlo entry (n=4): valid 75%, 3 entries all enter_yes on positive-distance states, side agreement 100% (3/3), median |p − book| 0.005 — on clean synthetic books its probabilities hug the book; on real journal states they do not.

SPEC §A bars (valid ≥95%, grounded ≥90%, agreement ≥80%, enter_no share ≥10%, fidelity ≥90%): every bar missed on real states.

## Failure pattern the next tranche must target

1. **Constant-YES side collapse (the headline).** Across all 28 entry proposals graded outside the replay and inside it — 18 replay + 7 real §A + 3 MC — **every one is enter_yes (28/28)**. Side agreement on decisive states: positive 6/6, **negative 0/16**. Tranche 1's NO-side bridge mass did not take. Next tranche: decisive mass of negative-distance propose rows whose correct continuation is `funds_propose side=no`, with wrong-side YES present as the contrasted error form; the campaign's bridge-balance audit must count **side × distance-sign cells**, not bridge share alone.
2. **ASSESS never fires.** 0 EXIT emissions in 40 held states; real held prompts collapse into the funds-guardian register with no stated P(YES) (`no_probability` 6/6 real). The tranche's assess rows did not install the v2 held form. Next tranche: EXIT-first rows (bid ≥ entry, incl. stop-crossed states) and HOLD-with-decimal-P(YES) rows (bid < entry) in the exact v2 held wording, at mass sufficient to beat the guardian register the prompt competes with.
3. **Near-strike ramble.** `no_answer` failures concentrate at |distance| ≤ 3.5 bps with 150–233 s generations — no short no-trade form exists for marginal states. The desk_pass class (300 rows) is underweight; add parser-visible pass answers with a stated P(YES) at small |distance|.
4. **Off-task routing survives on deep-negative desk prompts** (`shell_exec` on replay ids 387–390 and 3 §A/MC states) — the v1-era disease, now localized to strongly negative states.
5. **Ticker copy never lands.** Raw market fidelity 0/28 entries pooled; the model wraps/mangles the ticker string instead of copying it. Propose rows need copy-weighted mass on the bare ticker span.
6. **Frozen-suite rotation (simultaneity tax).** The desk tranche was paid for out of domains tool_choice (−7.7 pts), domains honesty (−14.3), and v1 evidence (−12.5). Per the loop's standing law, the next mix defends those three lanes at attack mass while it attacks the desk defects.

## Process notes

- No deploys, swaps, D1 writes, or GitHub writes were made. The swap does not execute: verdict is FAIL (replace-only-if-better).
- Grading ran under heavy multi-lane VM contention (a parallel grading effort in `~/workspace/run26/grade/` ran its own predict passes throughout, and two runtime restarts killed processes mid-run). All numbers above are computed from banked records on disk: `~/workspace/run26/eval/{v1,domains-v1}.jsonl` + `gate.txt`, `~/workspace/run26/replay/replay26-v2-records.jsonl` (28/28), `~/workspace/run26/bench-records.jsonl` (54 records). One interim domains score of 0.0% was an artifact of a 0-byte predictions file from a killed process and is superseded by the completed run scored above (80.9%).
- Grade tooling added (campaign dirs only): `~/workspace/run26/find_dropped.py`, `~/workspace/run26/replay/replay_grade.py`, `~/workspace/run26/replay/replay_continue.py`, `~/workspace/run26/grade_bench.py`, `~/workspace/run26/grade_bench_continue.py`; sampled states in `~/workspace/run26/grade-states2/`.
