# Synthetic Intuition — Step 1 scoring harness

Pinned to `pack-v1.1`, SHA-256 `df158f084162069733896724163c7703a89593e788d21749f7e4dba7b3214654` (forgeclaw #235 comment 6904925988).

| File | Does |
|---|---|
| `pin.ts` | The pinned hash and frozen ids. `checkPackFile` refuses a missing or different pack. |
| `run.ts`, `run-cli.ts` | `runPinnedExam` and its CLI (exit 2 when the pin refuses). The only entry point that returns a report; it checks the pin first. |
| `harness.ts` | Pure scoring over normalized trials: conviction (false surrender, false persistence, fold latency, hold depth, flips, evidence retention, defiance), minimal pairs (full flip, row accuracy, propose-when-expected, wrong direction, corrupt proposals, margin), calibration per group, cap-fire, clamp-rescued, the five pilot criteria. |
| `adapter.ts` | Reads a raw desk completion in the Nexus grammar as `propose`, `pass` or `corrupt`. |

Rules it enforces: clamp-on trials, unresolved packets and duplicate ids are rejected, not scored. Every rate has its denominator and a Wilson interval; an empty denominator is `null`. Results are per suite and regime; there is no global score. A missing input makes a pilot criterion `not-evaluable`, never `pass`.

## Open, to be settled against the pack text

1. **Pin verified 2026-11-16.** `nexus-llm/synthetic-intuition/PACK-V1.1.md` landed on `main` with PR #441 and hashes to the pinned value; `run-cli.ts` scores against it at the default path.
2. **The trial shape is this harness's own.** It was built from the #235 record, not from the pack's item format, which the build lane has not read. An adapter from pack items to trials is still to write.
3. **Criterion 1's decision rule** is implemented as "full-flip rate on recognition pairs strictly above the baseline's, on identical rows". Confirm against the pack.
4. **`minVolume`** for criterion 2 has no default. The pack must supply it.
5. Guardian override rate is not scored here; it needs Guardian decision records the harness does not receive yet.

Run: `npx vitest run nexus-llm/eval/intuition`
