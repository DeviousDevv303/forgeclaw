# CAPFIX pre-registration — Amendment 1 (committed BEFORE any capfix checkpoint exists)

Amends `capfix-preregistration-2026-10-31.md` (`82e0c8f`, kept unedited). Timestamp = this commit; capfix is at step ~1650/5000 and has only
`resume.pt`. Reason: the control exposed defects in my instrument and in the criterion's lowercase bar. Disclosed in full below.

## 1. Probe corrected: v1 -> v1.1 -> v1.2 (final, FROZEN)
| version | image template | sha256 (prefix) | control routing on image arm | template validity gate |
|---|---|---|---|---|
| v1 | `... the {E} headquarters at dawn` | `336c3b4f935e10e7` | 0/60 | FAIL (`headquarters` not in generator) |
| v1.1 | `... the {E} storefront at dawn` | `9271fb403e381cc3` | 0/60 | FAIL (`storefront` not in generator) |
| **v1.2** | `Generate an image of a red {E} in the snow` | **`03178656007183d9`** | 0/60 | PASS |
**My first diagnosis was wrong/incomplete.** I attributed v1's failure to a lexical collision (`headquarters` ~ the head-commit family). v1.1
removed that word and still failed, so the cause was not that word. The rule I adopted instead is a **template validity gate**
(`build-probe.py`): a template must be a structural instance of a training template of its family, checked by (a) the frame occurring verbatim
in the generator source and (b) every non-slot word occurring in the generator vocabulary. It fails v1 and v1.1 and passes v1.2 (negative test
run). The Kalshi arm already satisfied it and is unchanged. Entity words were already verified disjoint from the generator, the frozen evals and
capfix's actual 30,000 training rows; the widened gate adds the **template-vocabulary class**, which my first "verified disjoint" did not cover.
**v1.2 is frozen. There will be no further template changes.**

## 2. Control re-based (run-7 checkpoint, `scratchpad/ckpt-ind7`, same scorer, probe v1.2; predictions verified fresh by mtime)
- **Image arm: INCONCLUSIVE for this model.** Routed 0/30 capitalized, 0/30 lowercase (always `route:defer`). Run 7 routes "a red pickup truck
  in the snow" but defers when the entity fills the noun slot: a **checkpoint property** (brittle image routing), not a probe property.
- **Kalshi arm:** capitalized 2/30 strict (6.7%, 95% CI 2-21), lowercase 1/30 (3.3%, CI 1-17); copies are corrupted in BOTH forms (`Nfizers`,
  `eartmart...`). Floor effect: **no capitalized-vs-lowercase read is available from this control, ever.**
- **Consequence for the criterion:** the original lowercase bar ("run-8-level", then "control lowercase") is **vacuous** (control lowercase =
  3.3%). It is kept as a non-regression floor only, and the discriminating readings are the capfix-internal ones in section 3.
- One earlier control re-score in this session was **invalid** (a quoted heredoc left `$S` unexpanded, so the old v1.1 items were re-scored; the
  identical numbers exposed it). Redone with fresh predictions.

## 3. Interpretability rule and reading table for the capfix model (fixed now)
A (form, tool) cell is **interpretable** iff the model routes >= 50% of its 30 items to the expected tool; otherwise it is reported
**INCONCLUSIVE** (routing failure, not a copy verdict) and excluded. If no capitalized cell is interpretable the whole run is INCONCLUSIVE.
Over interpretable cells, with `cap` and `low` = pooled strict copy rates (n reported; Wilson intervals; ~15 pts unresolvable at n=30-60):
| outcome | reading (fixed in advance) |
|---|---|
| cap >= 90% and low >= 90% | capitalization effect fixed (credited to the bundle; the gap isolates it) |
| cap < 90%, low >= 90%, gap (low-cap) >= 20 pts | capitalization effect **persists**: the fix is insufficient, the hypothesis is not supported by this run |
| cap < 90%, low < 90% | **general** copy weakness at this scale: capitalization neither confirmed nor falsified |
| cap >= 90%, low < 90% | anomalous; reported as such |
| gap between 10 and 20 pts | ambiguous; reported as ambiguous |
**CAPFIX-PASS (unchanged headline) = cap >= 90% over interpretable cells AND low >= the vacuous control floor (3.3%).** The table above, not the
headline, carries the scientific reading.

## 4. Still true / still stated
A PASS is credited to the bundle; run 8's checkpoint on this probe remains the clean isolation (`muse`'s to run, probe v1.2). The mechanism is
inferred, not shown by attention evidence. Probe + scorer + builder are in `nexus-llm/eval/capprobe-v1/`.
