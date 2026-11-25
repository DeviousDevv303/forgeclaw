# Run 30 — GRADE: FAIL — do not swap

Candidate: `~/workspace/run30/ckpt/model.pt`
sha256 d4f4e3cc4dfddce57018d0bed6c0af9f893fbcb1d0d998f5e9ac53895962e6be
(params 4,479,234, ctx 640, frame v2; trained from the Run 29 checkpoint on the
82,789-row tranche-5 mix; died and was relaunched repeatedly through the
campaign, final relaunch completed step 2,499/2,500 on 2026-11-13 22:06 CST.)
Graded 2026-11-14 on the same four gates, frozen suites, and banked states as
Runs 27/28/29 (`grade_pipeline.sh`, a path-repointed twin of run29's; pipeline
DONE Sat Nov 14 22:54:00 UTC 2026 — the script's exit code 1 is only its final
`wc -l` tripping on the legacy `replay28-v2-records.jsonl` name, all four gate
stages completed and banked; artifacts in `eval/`, `replay/`,
`bench-records.jsonl`; aggregate recomputed from `aggregate.py`). Run 25 holds
the seat.

## Gate 1 — frozen suites: FAIL (domains still below the seat)
- v1 **75.0%** (63/84) — best of the series: above Run 25's 70.2%, Run 27's
  73.8%, Run 28's 71.4%, and Run 29's 72.6%.
- domains-v1 **85.1%** (40/47) — recovered from Run 29's 83.0% but still BELOW
  Run 25's 87.2% and Run 28's 89.4%.
- Fabrication **0.0%** on both suites. Format 92.9% / 100.0%.

## Gate 2 — desk replay (28 states): FAIL — the posture flipped to never-enter
- Valid 28/28, grounded 28/28, echo 0 — form still perfect.
- **Constant-NONE collapse** (the mirror image of Run 29's constant-YES):
  28 states, **0 entries** — every state got action=none (0 YES / 0 NO).
- Side agreement on |distance| ≥ 3 bps: **unmeasurable — no entries on the
  18-state base** (bar 80%; Run 29: 22.2% on 28 entries). enter_no share on
  negative distances likewise undefined: 0 entries where Run 29 entered all 14.
- Ticker fidelity: **no propose calls at all** (raw propose calls 0) — the
  metric has nothing to measure, vs Run 29's 3.6% on 28 calls.
- Notable: the discrimination tranche 5 targeted DID land in the stated
  probabilities — stated p was on the correct side of 0.5 in **83.3%** of the
  18 |distance| ≥ 3 states (mean |p − book median| 0.015). The model assesses
  the side correctly and then does not act on it.

## Gate 3 — held pool (40 states): PASS on the hard line
- 40/40 valid, all action=none. **Zero exits proposed, zero below blended
  entry** — the hard line holds for the second consecutive run.
- Caveat, unchanged from Run 29: it also exits nothing on the 11 at/above-entry
  states (and none of the 4 stop-held states) — still a never-exit posture,
  not discriminating exits.

## Gate 4 — benchmark §A + Monte Carlo: FAIL — no entries to grade
- §A entry: valid 10/10, **entries 0/10** — side agreement unmeasurable (bar
  80%; Run 29 entered 10/10 at 0.0%). Stated probabilities again track the
  side (80.0% on the correct side of 0.5, n=10). §A Brier model 0.4767 vs
  market 0.7636 (n=3) — worse than Run 29's 0.096.
- MC entry: 4/4 valid, **entries 0/4**, side agreement unmeasurable (Run 29:
  100%, n=3). Brier model 0.0518 vs market 0.0377 (n=4) — the model now
  trails the market where Run 29 led it.

## Net
Form remains won everywhere (100% valid + grounded on every pool, fabrication
0, echo 0), v1 hit a series best (75.0%), and the below-entry EXIT hard line is
clean for the second run in a row. But the entry reflex itself is gone: Run 29
entered everything on the wrong side; Run 30 enters nothing anywhere — replay,
§A, and MC all record zero entries, so every side-agreement bar fails by
absence. The side-vs-distance discrimination tranche 5 was built to teach is
visible in the stated probabilities (83.3% correct side of 0.5 on the replay
base) but never converts into an entry call. No seat swap; Run 25 stays. Next
iteration under the owner's autonomous-training directive: tranche 6 must
re-teach the entry act itself on discriminated states — probability-to-action
conversion — while keeping tranche 5's probability discrimination and the
held pool's below-entry discipline.
