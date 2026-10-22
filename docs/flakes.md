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
| 3 | `src/appResumeOnReturn.test.tsx` › "asks again once when the request died while the app was in the background" | 2026-10-21, full `vitest run` on `muse/trace-badge-remove` (off main `d0450bb`, PR #223) | unexplained | Assertion captured: `AssertionError: expected [] to have a length of 1 but got +0` at `src/appResumeOnReturn.test.tsx:53` — after the background-death retry, the persisted history held no matching user message. Afterwards: the isolated file run passed 4/4, and the in-order full re-run passed (1,223 tests). This test uses real timers (a visibility stub flips at 20 ms; the retried request takes ~2.5 s), not a fake clock. Guess only: the retry-and-persist chain lost a race against the assertion under full-suite parallel load. |
| 4 | Unknown (not captured) | 2026-10-21, first full `vitest run` on `muse/remove-error-log-sending` (PR #222) | unexplained | 1 failed / 1,215 passed; the failing test's name was lost when the reporter's output capture truncated — rule 2 was broken by the reporter (Muse), and the failure is recorded here so it is not silent. Two later full runs on the identical tree passed (1,216 tests). |
| 5 | `src/lib/corpus.test.ts` › "accommodates 10,000 interaction records in persistent local storage" | 2026-10-21, Muse's local environment, on main and on the PR #212 branch | unexplained | Times out at exactly 60 s (the test's limit) in that environment, repeatedly; passes on CI, and no CI failure has been seen. Guess only: local CPU speed rather than a code defect — but it turns local full runs red, which can mask a real failure in the same run, so it stays listed. |

### Reported from Muse's session — now in the repo

The flakes the owner reported from Muse's session are rows 3–5 above and Closed 1 below
(added by Muse, 2026-10-22, with the captured assertion text where it exists).

### Pattern notes (Muse, 2026-10-22 — handover step 2, preliminary)

- Entry 2's file (`NeuralNetworkBackground.test.ts`) advances **three** clocks by hand: a
  `vi.spyOn` `requestAnimationFrame` queue, `performance.now()` (the component measures FPS
  with it), and a mocked `Date.now()` that tests restore individually
  (`vi.mocked(Date.now).mockRestore()`). Vitest isolates per file, so the leak vector is
  *within* the file: a mock or queued frame that survives one test changes the next test's
  starting time. Guess only, to be tested: a test that throws before its `mockRestore()`,
  or a component loop still holding a queued frame at unmount, poisons the following test.
- Entry 3 is **not** a fake-clock test (correcting the handover's grouping): it uses real
  timers throughout. Its family is different — real-time races that only lose under the
  CPU contention of a full parallel run.
- `test/setupCanvas.ts` is the single shared setup file for the whole suite
  (`vitest.config.ts` `setupFiles`) — the harness watchpoint for handover step 4. Closed 1
  already traced one flake to teardown behaviour around it.
- The naming hunt (handover step 1) is running: 30 full runs on current main, output saved
  per run, ordered and `--sequence.shuffle` halves. Results will be appended here; entries
  stay **unexplained** either way unless a run names them.

## Closed

| # | Test | Closed | Evidence |
|---|---|---|---|
| 1 | `ThroneBackdrop.test.ts` (component teardown) | fixed — PR #218 (main `a7be8b9`), teardown fix in `test/setupCanvas.ts` | CI Build Gate run 881 on main `69ff404` (2026-10-21) failed the test step on this tree; named from the job log: a stray React scheduler callback firing after teardown. The identical tree passed PR run 880 and local full runs (1,215 tests). No recurrence seen since #218. |

## Handover (for Muse)

Assignment, in this order. Follow the rules in `docs/agents/muse-directive-2026-10-20.md`
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
