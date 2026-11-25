# Run 28 — GRADE: FAIL — do not swap

Candidate: `~/workspace/run28/ckpt/model.pt`
sha256 f27bdd6e499fe6d997d667af2eb26db4808bbe1e1ba0e17b64fbf5e7147b8362
(params 4,479,234, ctx 640; trained from the Run 27 checkpoint on the 62,949-row
Run 28 mix incl. tranche 3 ×3; step 2499/2500, final loss 0.007 — after a VM
restart at step ~2,200 killed the first attempt and a resume from step 2,000
completed it.) Graded 2026-11-12 on the same four gates, frozen suites, and
banked states as Run 27 (`grade_pipeline.sh` twin; artifacts in `eval/`,
`replay/`, `bench-records.jsonl`, `aggregate.json`). Run 25 holds the seat.

## Gate 1 — frozen suites: PASS (with a regression noted)
- v1 **71.4%** (Run 25: 70.2% · Run 27: 73.8%) — above the seat, below Run 27.
- domains-v1 **89.4%** (Run 25: 87.2% · Run 27: 87.2%) — improved.
- Fabrication **0.0%** on both suites. Format 92.9% / 97.9%.

## Gate 2 — desk replay (28 states): FAIL on side agreement
- Valid 28/28, grounded 28/28, echo 0 — form is perfect.
- **It proposes again**: 28 entries (25 YES / 3 NO). Run 27's constant-PASS
  collapse is cured.
- Side agreement on |distance| ≥ 3 bps: **38.9%** (bar 80%). On negative
  distances it still proposed enter_yes 16 of 19 times. enter_no share on
  negatives 21.4% (bar ≥10% — met). Ticker fidelity 64.3%.

## Gate 3 — held pool (40 states): FAIL — HARD LINE BROKEN
- 40/40 raw EXIT. **29 exits proposed below blended entry** — the identical
  count to Run 27. Owner law grades the model's raw output: below-entry
  exits must be ZERO. The code backstop blocked all 29
  (discipline_blocked_exits 29); no live harm, but the model did not learn
  the line despite tranche 3 carrying zero below-entry EXIT rows.

## Gate 4 — benchmark §A + Monte Carlo: FAIL on side agreement
- §A entry: valid 10/10 (Run 27: 6/10), entries proposed 10/10 (Run 27: 0/10),
  side agreement **40.0%** (bar 80%), ticker fidelity 10.0%.
- MC entry: 4/4 valid, side agreement 100% (n=3), Brier model 0.0158 vs
  market 0.0377; §A Brier model 0.5935 vs market 0.7636 (n=3).

## What Run 28 actually fixed
Grammar and form are won: 100% valid + grounded across replay, bench, MC,
and held pools; fabrication 0 everywhere; the model proposes entries in
every setting (Run 26 was constant-YES, Run 27 constant-PASS — Run 28 is
neither). Domains improved. This is the first candidate whose *form* is
fully production-shaped.

## What it did not fix — the two judgment defects, unmoved
1. **Side selection vs distance**: proposes YES into negative distance as a
   groove (replay side agreement 38.9% vs the 80% bar).
2. **Held-state EXIT reflex**: every held state gets EXIT, 29 of 40 below
   entry — third consecutive run failing the hard line (R26 emitted no
   exits; R27 29 below; R28 29 below).

## Diagnosis for the next tranche (hypothesis, evidence-shaped)
Tranche 3's targeted rows (1,000 sign-balanced propose; 500 exit / 500 hold
with zero below-entry exits) were outweighed by the 48,699-row rehearsal
mass inherited from Run 25's data, which carries the old YES-groove and
EXIT-reflex patterns at full weight. The targeted signal was correct but
outnumbered ~16:1. Run 29's tranche should (a) filter or down-weight the
rehearsal rows that teach the two defects (held-state EXIT rows whose bid <
entry; propose rows whose side fights the distance sign), and (b) raise the
targeted share so the corrected patterns are the majority voice on exactly
these two decision classes. Form needs no more teaching — spend the whole
tranche on judgment.
