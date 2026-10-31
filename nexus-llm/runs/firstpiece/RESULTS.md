# First-piece-length probe: result (2026-10-31)

Criterion, probe and scorer were committed first (a7eb440, `runs/diagnosis/firstpiece-preregistration-2026-10-31.md`). Probe sha256 `1d2ed52b...2e72039`. Single pass, no retries, constrained decoding.

## Verdict (pre-registered reading): H NOT SUPPORTED

| capfix (primary) | n | routed to kalshi_markets | exact copy | first-char-error |
|---|---|---|---|---|
| S (first piece 1 char) | 31 | 31 | 3 (9.7%, CI 3-25) | 12 (38.7%) |
| L (first piece >= 3) | 31 | 30 | 4 (12.9%, CI 5-29) | 2 (6.5%) |

Interpretable (routing >= 50% each): yes. exact(L) - exact(S) = 3.2 points, below the 10-point NOT SUPPORTED line. The AND condition for SUPPORTED failed on the exact-copy half. The first-char-error gap (32.3 points) met its half, but the registered rule required both.

Run-7 control (secondary, non-gating): routing 9/31 and 11/31, so not interpretable; exact 1/31 vs 2/31.

The earlier 19/39 vs 3/21 split is not reproduced on matched items. The single-character-first-piece lead is dropped. No tokenizer claim follows.

## Post-hoc description (NOT pre-registered, not tested)

Exact copy is about 10% in both strata, so the failure is general, not stratum-specific. Counting on capfix outputs (61 queries):

- 51/61 start with the letter "e" although the entity does not (e.g. amazon -> "ezon", audi -> "edi", kenya -> "eya", tennyson -> "eny").
- 55/61 run past the entity into the template tail ("... beating earnings").

So the dominant pattern is a wrong leading character plus a wrong span end, in both strata. That points at the copy mechanism's span boundary handling, not at the tokenizer piece length. Candidate causes (untested): the template tail "beating earnings" is a stable continuation the model memorized; the copy head's start offset is mis-aligned for entities not in training. Whether "e" comes from a fixed bias token is unknown.

The first-char-error metric undercounts L: L outputs such as "eya" for "kenya" lose the first char AND more, so they fail the metric's "rest of word intact" clause. The 32-point gap is therefore partly metric shape.

## Caveats

n = 31 per stratum (CI about +/-17). One template. Word-likeness uncontrolled. Single checkpoint (capfix); single seed. Pool widened before scoring (disclosed in the pre-registration).

## Next (only operator-gated or needing a new pre-registration)

A matched probe varying the template tail (entity at end of query vs. followed by "beating earnings") would test the span-overrun lead directly, inference only. Not run; needs its own pre-registration first.

## Correction to the post-hoc section (same day, checked against the training data)

- Unconstrained decoding on the first 8 items gives byte-identical queries to constrained decoding, so the leading "e" is the model's, not constrain.py's.
- The span-overrun reading was WRONG as an error. Training queries copy a whole event phrase, not just the entity ("askovar shortage in Texas", "Apple above 250", "ethereum above 5k"; 2,084 Kalshi rows in the capfix data). Continuing into "beating earnings" matches that convention. The probe's exact-copy rule only requires the entity substring, so overrun is not scored as failure and should not be counted as one.
- What remains a real failure: the first character. 51/61 queries start with "e" for entities that do not, while only 158/2,084 (7.6%) training queries start with "e". On unseen words the copy path does not supply the first character and the model emits a default; the remaining characters are then partly copied, partly dropped (amazon -> "ezon").
- Still untested whether this is the first-copy-step failing (no preceding in-span token for the induction bias to key on). A direct test would score the first generated token against the entity's first character, inference only, with a pre-registered threshold.
