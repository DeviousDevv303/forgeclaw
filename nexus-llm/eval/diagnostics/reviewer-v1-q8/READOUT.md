# REVIEWER v1 — Q4_K_M → Q8_0 diagnostic: read-out (rules P1–P4 applied mechanically)

Pre-registration: `PREREGISTRATION.md` (SHA-256 `09ffc729…017ec`, commit `ac95a634`). Results: `results.jsonl`, 18 rows, every rc = 0, every row on `Qwen3-8B-Q8_0.gguf` (SHA-256 `408b9555…83d6`), no time-budget stop. Comparators: the 2×2's Q4 cells A and B. **This grades nothing.**

| Cell | Traps flagged (of 6) | Exact kind | Controls (of 3) | Malformed | Blessed traps flipped | Tokens | Wall time |
|---|---|---|---|---|---|---|---|
| Q4 A (non-thinking) | 2 | 1 | 3 | 0 | n/a | 2156 | 1689 s |
| **Q8 QA** | **1** | **0** | 3 | 0 | **0** | 2139 | 2419 s (×1.43) |
| Q4 B (thinking) | 4 | 2 | 3 | 0 | n/a | 11074 | 4553 s |
| **Q8 QB** | **4** | **3** | 3 | 0 | **0** (new vs B) | 9599 | 5683 s (×1.25) |

Per row, Q4 → Q8 (non-thinking): RV-04 `stale-count` → `claims-match` (regressed); RV-08 `self-contradiction` → `lost-lines`; all others unchanged. Thinking: RV-05 `inflated-count` → `self-contradiction` (now the exact kind); all others unchanged.

- **P1 (precision implicated): NOT MET.** QA flipped 0 of the 4 blessed traps (RV-02, 03, 05, 07) against cell A, so the ≥ 2 bar failed, with controls 3/3. No build change is recommended, and the cost test never applies.
- **P3 (null): applies.** At Q4→Q8, quantization is not the limit. Q8_0 is near-lossless, so this implicates the model itself and strengthens the succession case. It says nothing about FP16 or other model families.
- **P2 (thinking, descriptive):** QB flips none of cell B's blessed traps (RV-02, RV-07), and traps flagged stay at 4. The one change is an exact-kind gain: RV-05 is now `self-contradiction`, so K goes 2 → 3.
- **Surprise clause:** RV-02 and RV-07 (the diff-reading classes) did not flip in either cell. Nothing surprising happened.
- **Direction of the non-thinking result:** QA is slightly **worse** than Q4 (RV-04 regressed). One row is noise by declaration, but the direction is opposite to the precision hypothesis.
- **Cost, for the record:** Q8 is slower on this CPU (×1.43 non-thinking, ×1.25 thinking) at about the same token counts.
- **Caveats:** n = 9, one seed per row, one model family, two precisions. A bounded result, not a proof that precision never matters.

**What this adds to the 2×2:** thinking mode and the prompt were ruled out earlier, and now quantization at Q4→Q8 is ruled out too. The permissive failure on the diff-reading classes (RV-02 lost-lines, RV-07 unread-reply) survived every change tested: two prompts, two modes, two precisions. Those classes need the deterministic checks (PR #357), or a different model.
