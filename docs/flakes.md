# Flake registry

Tests that failed once without a known cause. This file is the shared record: nothing about a
flake lives only in a chat thread.

## Rules

1. **Passing re-runs do not clear an entry.** A failure nobody saw is "unexplained", not "gone".
   An entry leaves **Open** only when it is explained and fixed (with the commit), or when the owner
   decides in writing to retire it.
2. **Capture the failure.** Run the suite with output saved (`npx vitest run > run.log 2>&1`) so the
   assertion text and stack are kept. An entry with no captured message says so.
3. **No skipping, no `.skip`, no quarantine** to get green (see the project conventions). A flake is
   fixed at its cause or stays listed.
4. **Never merge around an unnamed failure silently.** Disclose it in the PR body and add it here.
5. Facts only: what failed, when, on which change, what was run since. Mark guesses as guesses.

Status: **unexplained** (no cause known) · **explained** (cause known, not fixed) · **fixed** (commit named).

## Open

| # | Test | First seen | Status | Evidence |
|---|---|---|---|---|
| 1 | Unknown (not captured) | 2026-10-22, full `vitest run` on the `ddgWorkflowSearch` branch (PR #229, before commit `cf0514d` was final) | unexplained | 1 test failed in one full run; the message was not saved. Afterwards the full suite passed 7 of 7 times on the same code. |
| 2 | `src/components/NeuralNetworkBackground.test.ts` › "keeps the animation loop running after an automatic density change" | 2026-10-22, full `vitest run` on the `useNeuralState` branch (PR #230, commit `fa9a2b9`) | unexplained | 1 failure in one full run; the message was not saved. Afterwards: 3 full runs and 6 isolated runs passed. The test drives the component with a fake clock and fake `requestAnimationFrame`; it does not use `useNeuralState`, so the PR #230 change is not implicated by anything seen. Guess only: a clock or rAF-queue dependency on test order or timing. |

### Reported by the owner, not yet in the repo

The owner reports further flakes found in a separate session, including in `NeuralNetworkBackground`
and `appResumeOnReturn`, and a proposal for a shared clock helper. None of that is in this
repository, so it is **not** listed as fact. Whoever has those details should add them as rows
above, with the failing assertion text.

## Closed

None.

## Handover (for Muse)

Assignment, in this order. Stay inside `docs/directive` rules in `docs/agents/muse-directive-2026-10-20.md`
(draft PR, own branch `muse/<short-name>`, evidence in the PR body, no protected paths without the
owner's named OK).

1. **Name entries 1 and 2.** Run the full suite repeatedly with output saved
   (for example 30 runs, `--sequence.shuffle` on and off) and record the exact failing assertion,
   or record that 30 runs did not reproduce it (still **unexplained**, not cleared).
2. **Look at the shared pattern in entry 2:** tests that advance a fake clock and fake
   `requestAnimationFrame` by hand (`NeuralNetworkBackground.test.ts`, `appResumeOnReturn`).
   Check whether leftover callbacks or a clock that starts at a fixed value can leak between tests.
   Propose a fix as its own change, with a test that fails before and passes after.
3. **Add the owner-reported flakes** from the other session as rows with captured evidence.
4. **Watch the count.** If new entries keep appearing after the fixes land, the problem is the test
   harness, not individual tests. Say so in the PR instead of fixing them one by one.
