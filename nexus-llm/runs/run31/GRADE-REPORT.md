# Run 31 — GRADE: FAIL — do not swap

Candidate: `~/workspace/run31/ckpt/model.pt`
sha256 797ff15e5612cbfd906bceb7953851e3ea85bceccab6905e6aa5ba6b64d7cce9
(params 4,479,234, ctx 640, frame v2; trained from the Run 30 checkpoint on the
91,989-row tranche-6 mix; died three times — the third death was the
2026-11-15 16:59 UTC VM restart, which killed the supervisor too — final
segment resumed at step 1,750 and completed step 2,499/2,500 on 2026-11-15
12:45 CST.) Graded 2026-11-15 on the same four gates, frozen suites, and
banked states as Runs 27–30 (`grade_pipeline.sh`, a path-repointed twin of
run30's; all four gate stages completed and banked; artifacts in `eval/`,
`replay/`, `bench-records.jsonl`; aggregate recomputed from `aggregate.py`).
Run 25 holds the seat.

## Gate 1 — frozen suites: FAIL (domains ties the seat, does not beat it)
- v1 **72.6%** (61/84) — above Run 25's 70.2% but below Run 30's series-best
  75.0%.
- domains-v1 **87.2%** (41/47) — recovered from Run 30's 85.1% to exactly
  Run 25's seated 87.2%. The gate rule is beat-the-incumbent
  (replace-only-if-better): a tie is not a beat, so Gate 1 fails on the
  domains half.
- Fabrication **0.0%** on both suites. Format 92.9% / 100.0%.

## Gate 2 — desk replay (28 states): FAIL — constant-NONE, third run running
- Valid 28/28, grounded 28/28, echo 0 — form still perfect.
- **Constant-NONE collapse, unchanged from Run 30**: 28 states, **0 entries**
  (0 YES / 0 NO; 19 negative-distance and 9 positive-distance states all got
  action=none). Raw propose calls: 0.
- Side agreement on |distance| ≥ 3 bps: **unmeasurable — no entries on the
  18-state base** (bar 80%). enter_no share on negative distances likewise
  undefined.
- The stated probabilities are now flawless: stated p was on the correct
  side of 0.5 in **100.0%** of the 18 |distance| ≥ 3 states (Run 30: 83.3%),
  mean |p − book median| 0.015. Tranche 6's discrimination is complete in
  the assessment and still never converts.
- Conversion had live targets and missed them all: 5 of the 18 decisive
  states carried an enterable aligned book (ask ≤ 85¢) — replay-369/370/371
  (d +3.6/+3.5/+4.0, YES ask 57–58¢, p 0.57–0.58), replay-375 (d +3.2, ask
  60¢, p 0.60), replay-382 (d −4.9, NO ask 78¢, p 0.22) — and every one was
  passed. This is not cap avoidance; the taught C1 conversion pairs did not
  transfer to the replay frame.

## Gate 3 — held pool (40 states): PASS on the hard line
- 40/40 valid, all action=none. **Zero exits proposed, zero below blended
  entry** — the hard line holds for the third consecutive run.
- Caveat, unchanged from Runs 29/30: it also exits nothing on the 11
  at/above-entry states (and none of the 4 stop-held states) — still a
  never-exit posture, not discriminating exits.

## Gate 4 — benchmark §A + Monte Carlo: FAIL — entries attempted, both degenerated
- §A entry: valid **8/10 (80.0%)** and grounded-valid **8/10 (80.0%)** —
  both below the §A bars (valid ≥ 95%, grounded-valid ≥ 90%) for the first
  time in the series. Graded entries 0/10, so side agreement is
  unmeasurable (bar 80%).
- The two non-valid records are the run's new defect, and it matters: on
  entry-0004 (d −3.9) and entry-0005 (d −4.7) the model **did** attempt a
  `funds_propose` — the entry reflex surfaced in the tool frame — and both
  calls degenerated mid-generation into `no_answer`: `max_stake` corrupted
  into digit soup (`20.74056056015e05605601560605651`,
  `.6555555555555555555555552555555`), entry-0005's market mangled to
  `KXBTC15M-26NOV10145-45` (state ticker `KXBTC15M-26NOV101445-45`), and
  the argument probability (0.85 / 0.76) contradicting the rationale's own
  stated P(YES) (0.440 / 0.340). This is Run 30's forensic pathology —
  multi-character digit-string corruption — resurfacing inside the propose
  call's numeric fields.
- §A stated probabilities (valid records): correct side of 0.5 in 100.0%
  (base 8). §A Brier model 0.6254 vs market 0.7636 (n=3) — better than the
  market, worse than Run 30's 0.4767.
- MC entry: 4/4 valid, **entries 0/4**, side agreement unmeasurable.
  Probabilities correct side of 0.5 in 100.0% (base 3). Brier model 0.0552
  vs market 0.0377 (n=4) — trails the market but inside the
  ≤ market + 0.02 bar (≤ 0.0577).

## Net
Assessment is now perfect and action is still absent. The stated
probabilities discriminate flawlessly on every pool (100% correct side of
0.5 on replay, §A, and MC, fabrication 0, form 100% valid + grounded on
replay and the held pool, below-entry hard line clean for the third run),
yet the run records **zero graded entries and zero exits anywhere**.
Tranche 6 completed the probability side of conversion and did not move
the act itself in the direct frame; and on the two states where the act
was attempted in the tool frame, the propose call degenerated through
digit corruption before it could parse. Two distinct defects, both named:
(1) probability-to-action conversion still missing in the direct-answer
frame despite perfect stated discrimination and five enterable replay
books; (2) propose-call integrity — numeric-field and ticker corruption
when the model does reach for the tool frame. No seat swap; Run 25 stays.
Next iteration under the owner's autonomous-training directive: tranche 7
must teach the entry act in both frames (direct and tool-call) and drill
propose-call field integrity (stake figures, ticker copying) as its own
class, while preserving the now-perfect probability discrimination and
the held pool's below-entry discipline.
