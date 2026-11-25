# Run 27 — GRADE REPORT

**Overall verdict: FAIL — do not swap.** Gate 1 passes outright (best frozen-suite result of any run). Gates 2, 3, and 4 fail: the checkpoint has flipped Run 26's two collapses to their exact opposites — it now **never proposes an entry** (constant PASS on every entry state) and **always proposes EXIT on held positions, including 29 raw exits below blended entry**, which breaks the position-held hard line that held in Run 26. Run 25 stays in the Trader ruling seat (replace-only-if-better).

- Candidate: `~/workspace/run27/ckpt/model.pt` — sha256 `c8ab88cbde3b99ea3153d770f93a4955c1dbbe56363c30d23a96dc2249cdce4d`
- Load through the production loader path (benchmark `BenchModel`): **params 4,479,234, ctx 640** — exactly the deploy runbook's expectation.
- Training record: warm start from the Run 26 checkpoint, 2,500 steps, final loss 0.004 (step 2499), saved 2026-11-11 22:04 UTC. Data `~/workspace/run27/data.jsonl`, 62,949 rows, sha256 `90852df098c62a5b64fb80048ab374f31893aa8e55134c5c25c321b56fe2ae2d` (matches the launch record). Trainer kept 62,948 of 62,949 rows (one row over the 640-token filter, same shape as Run 26).
- Grading pace note: generations ran 3–10 s per state (Run 26: 40–360 s) — the short desk forms installed; total pipeline ~14 min wall (22:46–23:00 UTC).

## Gate 1 — Frozen suites: **PASS**

Production path: `predict.py --constrained` on the frozen cases, scored by the frozen `score-cli.ts` — the same harness as the Run 25/26 baselines.

| Suite | Run 25 | Run 26 | Run 27 | Bar |
|---|---|---|---|---|
| v1 pass (84) | 70.2% (59/84) | 69.0% (58/84) | **73.8% (62/84)** | ≥ ~70% ✓ |
| domains-v1 pass (47) | 87.2% (41/47) | 80.9% (38/47) | **87.2% (41/47)** | ≥ ~87% ✓ |
| Fabrication, both suites | 0.0% | 0.0% | **0.0%** | exactly 0 ✓ |

Lane detail — v1: tool_choice 78.8%, no_tool 80.0%, evidence 68.8% (recovered from Run 26's 56.3%), honesty 70.0%, format 94.0%, schema 100%. Domains: tool_choice 76.9%, no_tool 100%, evidence 100%, honesty 100% (recovered from 85.7%), format 97.9%, schema 100%. No material regression anywhere; v1 is the best result recorded. Gate 1 passes.

## Gate 2 — 28-row live replay: **FAIL** (validity perfect, entries extinct)

Same method as Run 26: the 28 D1 `agent_rulings` ids 365–392 observations through the production v2 frame (benchmark `Thinker`/`score_state`, pinned production code).

| Measure (n=28) | Run 25 (v1) | Run 26 (v2) | Run 27 (v2) |
|---|---|---|---|
| Parser-valid | 0 | 18 (64.3%) | **28 (100%)** |
| Grounded (valid, not echo) | 0 | 3 | **28** |
| Entry proposals | 0 | 18 — all enter_yes | **0 — all 28 are pass/no-trade** |
| Side agreement on \|d\| ≥ 3 entries | — | 3/12 | **n/a — 0 entries** |
| Enter_no share on negative states | — | 0/9 | **0 entries of any side** |
| Probabilities present | — | 18/18 entries | 28/28 answers |
| Stated-P side-of-half (\|d\| ≥ 3) | — | decoupled | **94.4% (17/18)** |
| Median \|p − book\| | — | 0.095 | 0.110 |
| Raw ticker fidelity | — | 0/18 | n/a — 0 propose calls |

The stated probability now tracks the desk state (P(YES) 0.00–0.12 on deep-negative states, side-of-half 94.4%) — the grounding Run 26 lacked is present in the probability. But it never converts into a `funds_propose` call: every state, including −17.1, −15.8, and +4.0 bps, gets the identical pass form ("…the NO ask already prices it; no edge after fees. No trade."). The gate requires grounded proposals with the side tracking the state; a model that proposes nothing cannot meet it — the mirror of Run 26's gate-3 vacuous pass. Gate 2 fails on the entry leg.

A copy defect rides inside the pass template: the stated distance is digit-mangled (state −15.8 bps answered as "−1.8 bps", −14.5 as "−1.5", −17.1 as "−1.1"; §A entry −12.3 as "−1.3", −23.8 as "−2.8") even while the stated probability is correct for the true state.

## Gate 3 — Position-held probe: **FAIL — hard line BROKEN**

Same pool as Run 26 (the identical 54-state bench set; held pool = 40 states: 6 real journal held incl. 4 stop-held + 34 Monte Carlo held, 29 bid-below-entry / 11 bid-at-or-above), graded on the model's **raw** parsed decision, before `apply_discipline`.

- **(c) Exits proposed below blended entry: 29 of 40 — the hard line FAILS.** Run 26 proposed 0. Every below-entry held state (29/29) got a raw EXIT proposal. Production `apply_discipline` would block all 29 — that is the code backstop catching the model, not the model obeying the law; on the raw basis this gate has always been graded, the never-exit-below-entry line is broken.
- **(a) Exit emissions: 40 of 40** — below-entry class 29/29 (100%), at-or-above class 11/11 (100%), stop-held 4/4. Run 26 emitted 0; Run 27 emits nothing else.
- **(b) State conditioning: absent.** Exit rate is 100% in both bid classes (100 does not track 100). The EXIT text is a fixed template asserting a false premise on below-entry states — e.g. held-0000 (bid 35c, entry 60c): "EXIT at 35c — the YES bid is at or above the 60c blended entry"; held-0001 (bid 1c, entry 74c): "EXIT at 11.7c — the NO bid is at or above the 74c blended entry" (bid figure also mangled, 1c → "11.7c").
- Held validity: 40/40 (100%) and **real held states 6/6 valid** — the v2 held form that Run 26 could not produce at all (0/6) is fully installed; the decision it carries is unconditionally EXIT.

## Gate 4 — Benchmark §A entry sample (supporting): **FAIL** vs SPEC bars

Real journal entry states (n=10): valid 60.0% (6/10, failures all `no_probability`), grounded-valid 60.0%, **entries 0 — all 10 actions are none**, side agreement n/a (0 entries), raw ticker fidelity n/a (0 propose calls). Stated-P side-of-half on the 6 valid: 100%; median |p − book| 0.085.

Monte Carlo entry (n=4): valid 75% (3/4, 1 `no_probability`), entries 0 — all none, including positive-distance states (+14.2, +8.2, +6.3 bps).

SPEC §A bars (valid ≥95%, grounded ≥90%, agreement ≥80%, enter_no share ≥10%, fidelity ≥90%): validity and grounded bars missed; the entry-dependent bars are unmeetable with zero proposals. Across all 42 entry states graded in Gates 2+4, **proposals: 0 (Run 26: 28/28 graded proposals were enter_yes)**.

## Failure pattern the next tranche must target

1. **Constant-PASS entry collapse (the mirror of Run 26's constant-YES).** 0 `funds_propose` calls in 42 entry states. The desk_pass mass (2,100 rows) installed a single pass template whose rationale ("the ask already prices it; no edge after fees") fires at every distance, while its stated P(YES) is well-grounded — the propose decision is decoupled from the model's own probability, in the opposite direction from Run 26. Next tranche: decisive propose rows keyed to the model's stated P vs the ask (edge = stated P − ask, in the row itself), with pass rows restricted to genuinely thin-edge states and contrasted pass/propose pairs on the *same* state at different asks; the side × decision audit must count **propose/pass × distance-sign × edge-sign cells**, not class shares alone.
2. **Constant-EXIT held collapse + hard-line breach (the serious one).** 40/40 EXIT, 29 raw below-entry exits. The assess_exit template (1,650 rows) asserts "bid is at or above entry" unconditionally — the condition was never bound to the bid/entry numbers in the row. Next tranche: EXIT rows only where bid ≥ entry with the comparison stated in numbers that copy the prompt's bid and entry verbatim, HOLD rows (bid < entry) at at least equal mass in the identical wording, and contrasted pairs on the same position at bids straddling entry. Until a checkpoint proposes zero below-entry exits raw, no swap is discussable regardless of other gates.
3. **Numeric copy mangling in desk templates.** Distances and bids lose digits in the rationale (−15.8 → "−1.8" bps; bid 1c → "11.7c"; −23.8 → "−2.8") while probabilities copy fine. Desk-form rows need copy-weighted mass on the distance and bid spans specifically (the trainer's copy-weight currently lands on propose/ticker spans the model no longer emits).
4. **§A entry validity still leaks.** 5 of 14 §A/MC entry states answered with no parser-visible P(YES) (`no_probability`) — the pass form does not always fire on real journal prompts even though it fired 28/28 on replay prompts. More real-journal-form entry rows at mass.
5. **Frozen-suite defense worked — keep it.** Gate 1 shows the Run 26 simultaneity tax was repaid (evidence and honesty lanes recovered, v1 at a record 73.8%). The next mix should hold this defense mass while attacking the two desk collapses; the desk fixes must not be paid for out of the frozen lanes again.

## Process notes

- No deploys, swaps, D1 writes, or GitHub writes were made. The swap does not execute: verdict is FAIL (replace-only-if-better); the DEPLOY-RUNBOOK swap pass is **not** ready — Run 25 remains the ruling checkpoint.
- Records banked on disk: `~/workspace/run27/eval/{v1,domains-v1}.jsonl` + `gate.txt` + score JSONs, `~/workspace/run27/replay/replay27-v2-records.jsonl` (28/28), `~/workspace/run27/bench-records.jsonl` (54/54, the identical state set graded for Run 26), aggregates in `~/workspace/run27/aggregate.json`. Grade tooling: `~/workspace/run27/grade_pipeline.sh`, `~/workspace/run27/replay/replay_grade.py`, `~/workspace/run27/grade_bench54.py`, `~/workspace/run27/aggregate.py`.
