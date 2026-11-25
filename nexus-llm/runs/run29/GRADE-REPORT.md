# Run 29 — GRADE: FAIL — do not swap

Candidate: `~/workspace/run29/ckpt/model.pt`
sha256 a43dfa1d895046f3a9f859f86078a3d8758970e06969dc5411af336a5edb70d8
(params 4,479,234, ctx 640, frame v2; trained from the Run 28 checkpoint on the
76,299-row tranche-4 mix; died ~01:32 during connector stalls, relaunched from
the step-750 checkpoint, completed step 2,499/2,500.) Graded 2026-11-12 on the
same four gates, frozen suites, and banked states as Runs 27/28
(`grade_pipeline.sh`; pipeline DONE Thu Nov 12 14:56:37 UTC 2026; artifacts in
`eval/`, `replay/`, `bench-records.jsonl`; aggregate recomputed from
`aggregate.py` during this research run). Run 25 holds the seat.

## Gate 1 — frozen suites: FAIL (domains regressed below the seat)
- v1 **72.6%** (61/84) — above Run 25's 70.2% and Run 28's 71.4%, below Run 27's 73.8%.
- domains-v1 **83.0%** (39/47) — BELOW Run 25's 87.2% and Run 28's 89.4%.
- Fabrication **0.0%** on both suites. Format 92.9% / 100.0%.

## Gate 2 — desk replay (28 states): FAIL on side agreement, worse than Run 28
- Valid 28/28, grounded 28/28, echo 0 — form still perfect.
- **Constant-YES collapse**: 28 entries, all enter_yes (28 YES / 0 NO).
- Side agreement on |distance| ≥ 3 bps: **22.2%** (bar 80%; Run 28: 38.9%).
  enter_no share on negative distances **0.0%** (bar ≥10%; Run 28 met it at 21.4%) —
  all 14 negative-distance states with a base got enter_yes.
- Ticker fidelity **3.6%** (1/28) — collapsed from Run 28's 64.3%.

## Gate 3 — held pool (40 states): PASS on the hard line
- 40/40 valid, all action=none. **Zero exits proposed, zero below blended entry** —
  the hard line that failed Runs 27 and 28 (29 below-entry exits each) holds here.
- Caveat: it also exits nothing on the 11 at/above-entry states — the EXIT reflex
  was replaced by a never-exit posture, not yet by discriminating exits.

## Gate 4 — benchmark §A + Monte Carlo: FAIL on side agreement
- §A entry: valid 10/10, entries 10/10, side agreement **0.0%** (bar 80%) —
  all 10 §A states are negative-distance and all got enter_yes. Ticker fidelity 0.0%.
  §A Brier model 0.096 vs market 0.7636 (n=3).
- MC entry: 4/4 valid, side agreement 100% (n=3), Brier model 0.0222 vs market 0.0377.

## Net
Form remains won (100% valid + grounded on every pool, fabrication 0), and the
below-entry EXIT hard line is clean for the first time in this run series'
grading pattern — but side selection regressed into a constant-YES groove
(replay 22.2%, §A 0.0%) and ticker fidelity collapsed. No seat swap; Run 25 stays.
Next iteration under the owner's autonomous-training directive: tranche 5 spends
on side-vs-distance discrimination and ticker copying, with the held pool's
bid-vs-entry discrimination (exit only at/above entry) kept — not the
never-exit posture Run 29 settled into.
