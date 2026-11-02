# REVIEWER v1 2×2 diagnostic — read-out (rules R1–R7 applied mechanically)

Pre-registration: `PREREGISTRATION.md` (SHA-256 `94a54e68…d595`, commit `fa0643f`). Results: `results.jsonl`, 36 rows, every rc = 0, task and context verbatim in every prompt, no time-budget stop. **This grades nothing.**

| Cell | Prompt / mode | T (traps flagged, of 6) | K (exact kind) | Ctl (of 3) | M (malformed) | Blessed traps flipped |
|---|---|---|---|---|---|---|
| A | scaffold / non-thinking | 2 | 1 | 3 | 0 | none |
| B | scaffold / thinking | 4 | 2 | 3 | 0 | RV-03, RV-05 |
| C | neutral / non-thinking | 2 | 1 | 3 | 0 | none |
| D | neutral / thinking | 3 | 2 | 3 | 1 (RV-04: 3000-token cap, no verdict) | RV-03, RV-05 |

Per row (A / B / C / D):
- RV-02: match / match / match / match
- RV-03: match / inflated-count ✓ / match / inflated-count ✓
- RV-04: stale-count ✓ / stale-count ✓ / stale-count ✓ / malformed
- RV-05: match / inflated-count / match / self-contradiction ✓
- RV-07: match / match / match / match
- RV-08: self-contradiction / lost-lines / lost-lines / lost-lines
- Controls RV-01, RV-06, RV-09: `claims-match` in all four cells.

- **R1 (prompt implicated): NOT MET.** T(neutral) − T(scaffold) is 0 with thinking off (C − A) and −1 with thinking on (D − B). Strong form: neutral flips 0 of 4 blessed traps (C) and 2 of 4 (D), and ≥ 3 are required.
- **R2 (mode implicated): NOT MET.** T(thinking) − T(non-thinking) is +2 under the scaffold (B − A) but +1 under the neutral prompt (D − C), and R2 needs ≥ 2 under both. Ctl = 3 in both thinking cells.
- **R3 (conditional):** the mode effect holds under the scaffold only (+2). Under the neutral prompt it is +1 with one row lost to the token cap. Stated as recorded, not reinterpreted: RV-04 was flagged correctly in A, B and C, but under R1–R7 a malformed row counts as neither flag nor match. **Same rows in both columns:** thinking flips the same two blessed traps under both prompts (RV-03 count, RV-05 contradiction). RV-02 (lost-lines) and RV-07 (unread-reply) are blessed in all four cells.
- **R4 (neither):** neither R1 nor R2 holds. The permissive failure persists across both prompts and both modes on Q4_K_M, so **the weights at Q4_K_M remain the leading candidate. Quantization precision was not tested.**
- **R5 (converse rows):** the neutral prompt never turned RV-04 or RV-08 into `claims-match`. There is no counter-evidence to R1, and R1 is not met in any case.
- **R6 (over-rejection):** Ctl = 3 in every cell, so no flip is over-rejection.
- **R7 (replication):** cell A equals run 1 on all 9 verdicts and all 9 token counts. The grading seat verified this independently (6567582577).

**What this says for design, in the rule's terms and nothing more:** the accept-leaning scaffold is not the lever. Thinking mode moves the count and contradiction classes (RV-03, RV-05) in both prompt columns, but it clears the pre-registered bar in only one, so it stays a candidate and not a finding. The two classes that need a read of the diff or of the code (lost-lines, unread-reply) fail in every cell, and those are where deterministic checks have to carry the load.
