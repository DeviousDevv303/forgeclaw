# REVIEWER v1 — 2×2 diagnostic pre-registration (not an exam run)

**Purpose.** REVIEWER run 1 (delivery record `92d0e681…`) and CURATOR v1 both failed in the permissive direction. Every dispatch in both exams shared three candidate causes: the weights (Qwen3-8B at Q4_K_M), non-thinking mode, and the workflow's system scaffold, which leans toward acceptance ("If the context is sufficient, do not refuse…", "Answer … directly when the supplied information supports it"). This diagnostic separates the second and third causes. **It grades nothing.** The frozen exam, run 1 and its grade are untouched, and the result informs design (CURATOR v2 scoping, prompt fixes) only. Conditions set by the analyst seat (kimi, relayed 2026-11-01): freeze the neutral prompt as an object, pre-register the reading rule, run all 9 rows.

## Design

| Cell | Prompt | Mode |
|---|---|---|
| A | workflow scaffold (as run 1) | non-thinking (empty `<think></think>`) |
| B | workflow scaffold | thinking |
| C | neutral | non-thinking |
| D | neutral | thinking |

- **Rows:** all 9, with run 1's payloads (manifest `2416cc9a10dd9718b1c9caa55651852e3e7ea0619653bfeba7b49ba9e0aff3da`): the same job text, the same canonical contexts and the same `invocation_id`s, so the sampling seed is held constant across cells.
- **Engine:** the real embedded script of `deepseek-16b.yml` at `4382e09`, run locally on CPU against the same GGUF file (`Qwen3-8B-Q4_K_M.gguf`) through llama-cpp-python 0.3.36. Torch/transformers are stubbed, and the fast path never uses them.
- **Patches**, each asserted to apply exactly once (`run_2x2.py`, SHA-256 `83bcaa7bdfaf2f203dc1c3368adf49cc17151bef6c5e709d6efeee9ac5676d97`):
  - All cells: `MAX_NEW_TOKENS=3000` and `FAST_TIME_BUDGET_S=1800`. The budget is equal in every cell so that thinking traces are not cut off. Run 1 hit neither cap.
  - Thinking cells: the empty think block is removed from the assistant prefix.
  - Neutral cells: the whole prompt is replaced by the **neutral template**, frozen here. It has no system turn.

```
<|im_start|>user\nTask:\n{task}\n\nContext:\n{context}<|im_end|>\n<|im_start|>assistant\n{think}
```

  `{think}` is the empty think block in cell C and nothing in cell D. SHA-256 of the template string: `97d0c96ea5dee76188c3467de180c2d22e4cf8761637e686e20e25086b729299`. "Neutral" here means *no stance*: no instruction to accept and none to doubt. Only the job text, which is identical in every cell, says what to do.
- **Verdict extraction (mechanical):** the first `"verdict": "<x>"` after any `</think>` in `result.txt`. If there is no match, the row is malformed and counts as neither a flag nor a match.
- **Smoke test** (trivial payload, all four cells) passed before this file was written. Each cell ran (rc 0). The thinking cells emitted `<think>` traces. Cell B's trace referred to the scaffold and cell D's did not.

## Reading rule (fixed before the first diagnostic run)

Per cell:
- **T** = trap rows (RV-02, 03, 04, 05, 07, 08) whose verdict is a §2 non-match verdict.
- **K** = trap rows whose verdict is exactly the expected kind.
- **Ctl** = controls (RV-01, 06, 09) answered `claims-match`.
- **M** = malformed rows.

n = 9 with a single seed per row, so **a difference of 1 row is noise by declaration.**

- **R1, setup implicated.** In *both* thinking states, T(neutral) − T(scaffold) ≥ 2, and Ctl ≥ 2 in both neutral cells. **Strong form:** in at least one thinking state, the neutral prompt flips ≥ 3 of the 4 traps run 1 blessed (RV-02, 03, 05, 07) away from `claims-match`, while Ctl ≥ 2 in all four cells.
- **R2, mode implicated.** Under *both* prompts, T(thinking) − T(non-thinking) ≥ 2, with Ctl ≥ 2 in both thinking cells.
- **R3, conditional.** An effect that holds in only one row or column of the 2×2 is reported as conditional on the other factor, not as R1 or R2.
- **R4, neither.** If neither R1 nor R2 holds, the permissive failure persists across both prompts and both modes on this quantization, and the weights at Q4_K_M remain the leading candidate. **Quantization precision is not tested here:** every cell is Q4_K_M. That is a separate experiment.
- **R5, converse rows.** RV-04 and RV-08 are reported per cell. If the scaffold causes blessing, the neutral prompt should not turn them into `claims-match`. If it does, that counts against R1 and is reported.
- **R6, over-rejection is not verification.** A trap flipped in a cell where Ctl < 2 is recorded as over-rejection. R1 and R2 both require their control condition.
- **R7, replication.** Cell A uses run 1's exact inputs and seeds, differing only in the token and time caps, which run 1 never reached. Its verdicts are compared with run 1's and any mismatch is reported (local CPU arithmetic may differ from the runner's). Cell A remains the comparator inside the 2×2 whatever the comparison shows.

## Output

`results.jsonl` holds one line per (cell, row): prompt hash, whether the task and context appear verbatim in the prompt, verdict, the full result text and its hash, and meta (tokens, time-budget stop, trimmed, context check, seed). The read-out applies R1–R7 mechanically and quotes the counts.
