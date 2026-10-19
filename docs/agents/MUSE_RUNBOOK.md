# ForgeClaw runbook for Muse (from Claude)

The goal is cheap, reliable routine work on Muse credits, with only real problems escalated to Claude.
Follow these steps literally. Do not improvise fixes outside the task you are on.

## Rules (all tasks)
1. **Evidence before code.** Before any fix, show the failing run ID, log line, or failing test. "I think X happens" is not evidence. #130 was built on an unchecked premise and cost an hour.
2. **Never weaken run correlation.** A run belongs to a dispatch only if its name contains that dispatch's invocation ID. No "most recent run" fallbacks, no time-window guessing.
3. **Protected paths need Cristian's named authorization.** Do not edit: `.github/**` (all workflows), `src/lib/forgeTools.ts`, `src/lib/guardianGate.ts`, `src/core/autonomyEngine.ts`, `engine/`, `foundation/`, `tests/foundation/`, `scripts/`, `package*.json`, any `*.config.*`, `tsconfig*.json`, `LICENSE*`. The full list is `.github/protected-paths.txt`.
4. **Never dispatch a workflow** (DeepSeek, image, shell) to test something. Ask Cristian to send the exact query from the app.
5. **Feature branch only.** One task per branch, branched from current `origin/main`. Never push to `main`.
6. **Every new test must fail when the fix is reverted.** Revert the fix, run the test, paste the failure, restore the fix.
7. **Gate before every push.** All five must exit 0:
   ```
   npx tsc -b
   npx eslint src
   npx vitest run
   npm run build
   git diff --no-renames -z --name-only origin/main | python3 .github/scripts/check-protected.py .github/protected-paths.txt
   ```
8. **Report with the template at the bottom.** "Attempted" is not "done", and "done" is not "verified live".

---

## Task 1: live check (run after every merge, deploy, or reported problem)
From a clean `forgeclaw` clone at the repo root, run `bash docs/agents/forgeclaw-livecheck.sh 12`. Optionally `export GH_TOKEN=<read-only token>` first, which is needed to fetch failed-run logs. The script is read-only: it never dispatches, pushes, or writes.

It ends with `RESULT: PASS` or `RESULT: ATTENTION NEEDED`. For each `!!` line:

| `!!` line | Meaning | What you do |
|---|---|---|
| the latest main run of a workflow did not succeed | Build Gate or Pages deploy failed on `main` | Open the run, read the failing step, report it. Fix only if it's in non-protected code and you have the failing log line. |
| router fix missing / page size not 20 / fallback is LIVE / old unreachable text | The live site is serving old or wrong code | Check the Pages deploy run for the `main` SHA. If the deploy succeeded and the bundle is still wrong → **escalate to Claude**. |
| failed: \<run url\> | A DeepSeek run concluded `failure` | Read the section 4 log lines. A `! [rejected] HEAD -> deepseek-results (fetch first)` line is the known mirror push race (Task 3), so report it and don't fix it. Anything else → **escalate to Claude** with the log lines. |
| success but NO mirror | Run succeeded but its result file never reached `deepseek-results` (same race, hidden by `continue-on-error`) | Report the run number. Known issue; don't fix it. |

Columns worth reporting even when the result is PASS:
- `gap` of `0m`/`1m` together with `DUP-of-#N` = the same question was dispatched twice. Report which runs.
- `ENVELOPE-ECHO` = the model echoed ForgeClaw's internal `[APPLICATION_IDENTITY…]` block.
- `DEGRADED` = the fallback checkpoint ran.
- `model` time above 20m = slow run. Report it.

## Task 2: harden image-generation run discovery: DONE, do not redo
Shipped in #133/#134 and corrected in #135 (`toolFetch` timeouts, working 401/403/404 fast-fail, tests (a)-(g)). Kept below for reference only.

### Original spec (reference)
**Problem (verified in source on main `20845d1`):** `findCorrelatedImageRun` and `waitForImageRun` use raw `fetch` with no timeout and no retry, and list `per_page=100` runs (~1.6 MB per poll on this repo). Any single failed read in either loop throws and ends image generation, even though the dispatch succeeded and the run is executing. This is the same bug DeepSeek had; #131 fixed it in `src/lib/deepseekArtifact.ts`. **Use that file as the template: copy its pattern, don't invent a new one.**

Exact changes:
1. Replace both raw `fetch` calls with `toolFetch` from `./githubFetch`, passing `{ ...ctx, timeoutMs: 30_000 }`. Wrap them in `githubStage('image-run-discovery GET /actions/workflows/generate-image.yml/runs', …)` and `githubStage('image-run-poll GET /actions/runs/{run_id}', …)`. For non-OK responses, throw `describeGithubHttpFailure(<same stage>, status, statusText)` in place of the current `GitHub runs list ${status}` / `GitHub run status ${status}` errors.
2. Add `export const IMAGE_DISCOVERY_PAGE_SIZE = 20` and use it in place of `per_page=100`.
3. Discovery loop: wrap `findCorrelatedImageRun` in try/catch, exactly like `waitForDeepSeekRun` in `deepseekArtifact.ts`:
   - rethrow `AbortError`
   - rethrow when the message matches `/GitHub HTTP (?:401|403|404)\b/`
   - otherwise store the message in `lastReadError`, log `console.warn('[image-discovery] read failed …')`, and keep polling
   - set `lastReadError = undefined` after every successful read
4. After the discovery loop:
   - if there's no run and `lastReadError` is set, throw `image-run-discovery: image generation dispatched, but GitHub could not be read to find run "<id>" within 120s. Last read error: <err>`
   - if there's no run and no `lastReadError`, throw `image-run-discovery: image generation dispatched but correlated run "<id>" was not found within 120s.`
5. Status loop: one failed status read must not end the wait. Catch it, rethrow `AbortError` and 401/403/404, otherwise continue to the next delay. `deepseekArtifact.ts` `waitForDeepSeekRun` already does this; copy that shape.
6. **Do not change:** `isCorrelatedShellRun` usage, the invocation ID, the timeouts (`IMAGE_DISCOVERY_TIMEOUT_MS`, `IMAGE_MAX_WAIT_MS`), the artifact/mirror code, or anything in `forgeTools.ts`.

Tests to add to `src/lib/imageArtifact.test.ts`. Use `vi.useFakeTimers()` and stub `fetch`, like `src/lib/deepseekArtifact.test.ts` does:
- (a) A discovery read that hangs forever does not end discovery. After advancing 121s, the error contains `could not be read` and `timed out`, and `fetch` was called more than once.
- (b) Three failed reads (`TypeError('Failed to fetch')`), then a list containing the correlated run → resolves to that run. Every list URL contains `per_page=20`.
- (c) Failed reads followed by successful reads that never contain the run → error says `was not found within 120s`, not `could not be read`.
- (d) Discovery returning HTTP 403 → fails immediately with `HTTP 403` (fast-fail kept).
- (e) Status poll: one failed status read followed by `status: 'completed'` → resolves; it is not an error.

Mutation checks. Paste each failing output:
- make the discovery catch rethrow everything → (a)(b)(c) fail
- set the page size back to 100 → (b) fails
- remove the `lastReadError = undefined` reset → (c) fails
- make the status-loop catch rethrow → (e) fails

Branch `fix/image-discovery-hardening`. Run the gate. Push. Report. Do not merge it yourself; Cristian merges.

## Task 3 (blocked, do NOT start): mirror push race
`.github/workflows/deepseek-16b.yml` step "Publish browser-readable result mirror" pushes once, and fails when two runs finish within seconds of each other (run 39188909218). It is a protected path. Only start if Cristian writes **"authorize deepseek-16b.yml mirror retry"**. The approved change is to replace the final `push` line with:
```bash
for attempt in 1 2 3 4 5; do
  git -C /tmp/deepseek-results-worktree push origin HEAD:deepseek-results && exit 0
  git -C /tmp/deepseek-results-worktree pull --rebase origin deepseek-results
  sleep $((attempt * 2))
done
exit 1
```

## When to stop and escalate to Claude
- Anything that touches run correlation, `forgeTools.ts`, Guardian, or a workflow file.
- A failure you can't tie to a specific log line or failing test.
- A fix that would need more than ~50 changed lines, or changes outside the files a task names.
- Two attempts at a fix both failed the gate.
- The live check shows the deployed bundle doesn't match `main`.

When escalating, send: the `RESULT` block from the live check, run IDs, log lines, and what you already ruled out. No theories without data.

## Report template
```
TASK: <1 / 2 / …>
BRANCH + SHA: <branch> @ <full sha> (or "none")
EVIDENCE: <run ids, log lines, failing test names>
CHANGE: <files, one line each>
GATE: tsc=<exit> eslint=<exit> vitest=<passed/skipped, exit> build=<exit> protected=<exit>
MUTATION CHECKS: <mutation → test that failed>
NOT VERIFIED: <what still needs a live run>
ESCALATE: <yes/no + why>
```
