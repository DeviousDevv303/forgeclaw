# REVIEWER v1 — Q4_K_M → Q8_0 quantization diagnostic: pre-registration (not an exam run)

**Question.** The 2×2 (read-out `e56d260`, #235 6568665506) found that neither the prompt (R1) nor thinking mode (R2) clears the permissive failure, so **Qwen3-8B at Q4_K_M** is the leading candidate. Quantization precision was never tested. This tests it, in one step: Q8_0 is near-lossless and fits this 16 GB container; FP16 does not. **It grades nothing.** Run 1, its grade and the 2×2 are untouched.

**Approval record.** The standing blanket approval ("Your good to make and/or implement anything you need to", relayed in #235) covers a local, CPU-only, reversible, ungraded diagnostic. The analyst seat (kimi) concurred and asked for it ahead of RESEARCHER (relay, 2026-11-02). That is a concurrence, not an owner statement.

## Design
- **Cells:** QA = 2×2 cell A (workflow scaffold, non-thinking) on Q8_0; QB = 2×2 cell B (scaffold, thinking) on Q8_0. Quantization is the only delta. Comparators are the existing Q4_K_M cells A and B in `reviewer-v1-2x2/results.jsonl` (SHA-256 `4f304caf…11911`), not re-run.
- **Held constant:** the same 9 rows (run 1's payload manifest `2416cc9a…3da`), the same invocation IDs and so the same sampling seeds, the same workflow script at `4382e09` (unmodified; only the token cap 3000 and time budget 1800 s patched, as in the 2×2), the same machine, and the same llama-cpp-python 0.3.36.
- **Model file:** `Qwen/Qwen3-8B-GGUF` / `Qwen3-8B-Q8_0.gguf`, expected SHA-256 `408b955510e196121c1c375201744783b5c9a43c7956d73fc78df54c66e883d6` (the hub's own content hash, read from its download metadata). It is verified after download and recorded in every result row.
- **Runner:** `run_q8.py` (SHA-256 recorded in the commit). It is the 2×2 runner with `CELLS` reduced to QA and QB and the file name added to each row. Resumable. Per row it records tokens and `generation_seconds` for cost.
- **Smoke test** on a trivial payload before the first real row, as in the 2×2.

## Definitions
- **Blessed traps:** RV-02, 03, 05, 07 (answered `claims-match` in run 1). **Flip:** a blessed trap whose verdict in the Q8 cell is any non-`claims-match` §2 verdict, where the matching Q4 cell had `claims-match`. **T, K, Ctl, M:** as in the 2×2 pre-registration (flagged traps, exact kind, controls accepted, malformed).
- **Noise reference, from the 2×2:** changing only the prompt (A vs C) flipped 0 of 4 blessed traps and changed one kind. n = 9, single seed, so **a one-row difference is noise by declaration.**

## Reading rule (fixed before the first run)
- **P1, precision implicated:** in QA, ≥ 2 of the 4 blessed traps flip against Q4 cell A, **and** Ctl ≥ 2 of 3. Then precision was a real confound. A build change ("Q8 as default") is recommended **only if both**: K(QA) − K(A) ≥ 2 (an exact-kind gain, as Amendment 2 requires), and the cost does not break the seat's decode budget. Cost test: projected time per non-thinking row = generated tokens ÷ (1.2 tok/s × the local Q8/Q4 speed ratio) must stay under the workflow's 420 s fast-path budget on every row. 1.2 tok/s is the runner's measured Q4 rate (138 tokens in 112.2 s, run 1 RV-03). That recommendation goes to the grading seat; protected paths are not touched here.
- **P2, thinking, reported the same way:** the QB flips relative to cell B (its blessed set is only RV-02 and RV-07). Reported, not a decision rule.
- **P3, null:** QA flips 0–1 blessed traps. Quantization at Q4→Q8 is then not the limit. This implicates the model itself, since Q8_0 is near-lossless, and it strengthens the succession case (Nexus replacing the seat on the frozen exam). It does not say anything about FP16 or other model families.
- **P4, in between** (exactly 1 flip with Ctl ≥ 2, or flips with Ctl < 2): inconclusive, reported as such. Controls failing counts as over-rejection, as in R6.
- **Expectation, registered now:** a Q4→Q8 change rarely flips a systematic permissive failure wholesale. **If RV-02 or RV-07 (the diff-reading classes that failed in all four 2×2 cells) flip in QA or QB, that is surprising and will be reported as surprising.**
- **Replication note:** cell A replicated run 1 exactly (9/9 verdicts, 9/9 tokens) on this machine, so QA vs A differs by quantization only. QB has no run-1 counterpart; its comparator is the 2×2's cell B on the same machine.

## Output
`results.jsonl` (one line per cell × row: verdict, full result text and hash, tokens, `generation_seconds`, `gguf` file name, prompt hash and verbatim checks) and `READOUT.md`, which applies P1–P4 mechanically and quotes the counts.
