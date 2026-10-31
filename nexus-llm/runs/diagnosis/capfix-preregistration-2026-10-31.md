# CAPFIX pre-registration (criterion fixed BEFORE any capfix probe result exists)

**Registered:** 2026-10-31T20:10Z, by Claude, at capfix training step ~950/5000 (only `resume.pt` exists; no final checkpoint, so no probe
result on the capfix model can exist yet). The git commit timestamp of this file is the evidence of ordering. Criterion text follows the
form proposed in the channel; the two deviations are listed under "Deviations" and are mine.

## Run under test
`capfix` = `pipeline.sh` with preset `small-copy-ind`, 30,000 rows, seed 31, 5,000 steps, lr 6e-4, generator at `8bb92c2`
(capitalized nonce copy targets + run 8's nonce augmentation + copy loss weight 2.0). Training data: `scratchpad/capfix/data.jsonl`, 30,000 rows.

## Instrument
`nexus-llm/eval/capprobe-v1/` (`build-probe.py`, `probe.jsonl`, `PROBE-MANIFEST.json`, `score-probe.py`). 120 items: 30 held-out entities x
{Capitalized, lowercase} x {image prompt, Kalshi query}. Paired, so the capitalization effect is isolated within one model.
**Disjointness, verified twice:** at probe build time against the generator source and every frozen eval text, and again against the actual
capfix `data.jsonl` (30,000 rows): none of the 30 entities appears (word-boundary, case-insensitive). Probe sha256 in `PROBE-MANIFEST.json`.
STRICT copy = first call exists, tool is the expected one, and the designated argument contains the entity exactly (case-sensitive).
n = 60 per arm; Wilson 95% intervals are reported, and a difference under ~15 points is not resolvable at this n.

## Criterion
**CAPFIX-PASS** requires BOTH:
1. **Capitalized strict copy >= 90%** on the paired held-out probe (60 capitalized items, point estimate; the interval is reported alongside).
2. **Lowercase strict copy >= the run-7 control's lowercase rate on this same probe** (control scored with this same scorer, below). No regression on lowercase.

**CAPFIX-FAIL** = below either bar. No post-hoc reinterpretation of the bar.
**Pre-registered reading of a FAIL** (so a miss is a finding, not a failure):
- capitalized < 90% but the gap (lowercase - capitalized) shrinks versus the control gap: the direction is right, the fix is insufficient.
- gap does NOT shrink versus the control: the capitalization hypothesis is **falsified** by this run, whatever the loop score says.
**Secondary (reported, not gating):** gap <= 10 points; routing rate; conditional copy rate; the 18-scenario loop (context only, n=18).

## Attribution (stated in advance)
- A PASS is credited to the **bundle** (capitalized nonces + nonce augmentation + copy weighting), not to capitalization alone: the control
  (run 7) lacks all three. The within-model gap is the only metric here that isolates capitalization.
- The gold-standard isolation is **run 8's checkpoint on this probe** (run 8 = same bundle minus capitalized nonces). It is not reachable
  from this container; if it becomes reachable, score it and the capfix-vs-run-8 difference is the clean test.
- The mechanism ("rare lone-capital piece is poorly copied") is **inferred from tokenization plus output patterns**. No attention-weight
  artifact was produced. The probe tests the prediction, not the mechanism.

## Deviations from the proposed text (disclosed)
1. "lowercase >= run-8-level baseline" is not measurable on this probe from here (no run-8 checkpoint). Replaced by the run-7 control
   measured with the same scorer; it is the only baseline this container can produce.
2. The proposal said step ~750; capfix was at step ~950 when this was committed. Recorded as it was.

## Loop-fixture audit (Kimi's catch 1)
`nexus-llm/eval/loop/scenarios.json` and `score-loop.ts` each have exactly one commit (`2e53e97`, 2026-10-27), unedited since, and that
commit predates the loop scoring of runs 4-7. So the repo-side fixture and scorer are identical for those runs. **Not verified:** run 8 was
scored in Muse's workspace, and its RESULTS record fixture hashes for CAPBENCH, AFFECT and UNRESTRICTION but not for the loop scenarios;
its `loop.txt` has the committed scorer's output format and the same 18 ids, but byte-identity of her copy is unconfirmed. Until she
confirms `sha256(scenarios.json)` = `464be711fd58eaaa...` (prefix), "10/18 best yet" carries that caveat.
