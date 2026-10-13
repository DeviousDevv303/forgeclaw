# Shell Repair Batch 3 — Part 1 Record

Date: 2026-10-13

## Scope completed

This change implements **Part 1 of the Manus directive only**:

- Added `.github/workflows/shell-repair.yml`, a guarded repair workflow with input validation, branch isolation from `origin/main`, workspace confinement, protected-path refusal, post-patch verification, no-push-on-failure behavior, and PR-only landing.
- Added explicit `pending_run`, `pending_log`, `resolved`, `run_timeout`, and `log_timeout` resolution states to `src/lib/shellCorrelation.ts`.
- Added the requested bounded polling constants:
  - `SHELL_RUN_LIST_TIMEOUT_MS = 120000`
  - `SHELL_LOG_RETRIEVAL_TIMEOUT_MS = 300000`
  - `SHELL_LOG_POLL_INTERVAL_MS = 5000`
- Updated shell execution to continue polling for a job log after a correlated run completes, instead of treating a temporarily unavailable log as an immediate retrieval failure.
- Added regression tests for all resolution states.

## Verification

- `npm run test:run`: **201 passed, 8 skipped** across 39 test files.
- `npm run build`: **passed** (`tsc -b` and Vite production build).
- `git diff --check`: **passed**.
- Workflow structural check: **passed**, including all required guard stages and 15 named workflow entries.

## Branch protection prerequisite

Checked with GitHub’s branch protection API for `main`:

> `Branch not protected` (HTTP 404)

Therefore the required controls are not currently verifiable or enforced:

- PR-only changes to `main`: not enforced
- At least one required reviewer: not enforced
- Required `build-gate` status check: not enforced

No branch-protection settings were changed without operator sign-off. This remains a merge prerequisite.

## Deferred scope

- Part 2 upload routing was not started because Part 1 protection verification is not complete.
- Part 3 shell autonomy was not started because the reactive-versus-initiating scope decision is still pending.
- `tier1Active=false` was not changed.
