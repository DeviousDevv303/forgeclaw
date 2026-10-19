# Muse — Task 4: bound the image result download (from Claude)

The runbook rules still apply (`docs/agents/MUSE_RUNBOOK.md`). Two points from #133 that are now **required**:
- **No self-merge.** Push the branch, report, and stop. Cristian merges after review.
- **Paste the actual output**, not a summary, for: the full `npx vitest run` totals line and every mutation check. "5/5 pass" from one file is not the gate.

Base: current `origin/main` (`009bb4d` or later). Branch: `fix/image-download-timeouts`.

## Problem (verified in source on main `009bb4d`)
`downloadImagePng()` in `src/lib/imageArtifact.ts` (about lines 220–275) runs after the image run has **succeeded**. It still uses three raw `fetch` calls, with no timeout and no retry:

| # | Call | Current behavior on a dead connection |
|---|---|---|
| 1 | Mirror PNG: `fetch(imageMirrorUrl(...))` (raw.githubusercontent.com) | Hangs forever. Its `try/catch` only catches throws, and a hung promise never throws. |
| 2 | Artifact list: `fetch(.../actions/runs/${runId}/artifacts?per_page=100)` | Hangs forever |
| 3 | ZIP download: `fetch(artifact.archive_download_url, ...)` | Hangs forever |

Result: the image was generated, but the chat sits on "Processing…" indefinitely. That's the same class of stall Cristian hit with DeepSeek.

## Template: copy this, don't invent
`src/lib/deepseekArtifact.ts` already does exactly this for DeepSeek results:
- `readDeepSeekMirror()` uses `toolFetch({ ...ctx, timeoutMs: MIRROR_TIMEOUT_MS }, …)` (20 s) and treats any failure as "no mirror", falling back to the artifact.
- The artifact list and ZIP download use `githubStage('<stage>', () => toolFetch({ ...ctx, timeoutMs: … }, …))` and `describeGithubHttpFailure(...)` for non-OK responses.

## Exact changes (only `src/lib/imageArtifact.ts` and its test file)
1. Add constants next to the others:
   ```ts
   const IMAGE_MIRROR_TIMEOUT_MS = 20_000
   const IMAGE_ARTIFACT_LIST_TIMEOUT_MS = 30_000
   const IMAGE_ARTIFACT_DOWNLOAD_TIMEOUT_MS = 60_000
   ```
2. **Mirror (call 1):** replace `fetch(...)` with `toolFetch({ ...ctx, timeoutMs: IMAGE_MIRROR_TIMEOUT_MS }, imageMirrorUrl(owner, repo, invocationId), { cache: 'no-store' })`. Keep the surrounding `try/catch` and its fall-through to the artifact path. A timed-out mirror must fall back, not fail.
3. **Artifact list (call 2):** replace it with
   `githubStage('image-artifact-list GET /actions/runs/{run_id}/artifacts', () => toolFetch({ ...ctx, timeoutMs: IMAGE_ARTIFACT_LIST_TIMEOUT_MS }, <same URL>, { headers: ghHeaders(ctx), cache: 'no-store' }))`.
   On `!ok`, throw `describeGithubHttpFailure('image-artifact-list GET /actions/runs/{run_id}/artifacts', res.status, res.statusText)` in place of `GitHub artifact list ${status}`.
4. **ZIP download (call 3):** replace it with
   `githubStage('image-artifact-download', () => toolFetch({ ...ctx, timeoutMs: IMAGE_ARTIFACT_DOWNLOAD_TIMEOUT_MS }, artifact.archive_download_url, { headers: ghHeaders(ctx), redirect: 'follow' }))`.
   **Keep the existing non-OK error text exactly as it is** (it explains the Azure redirect/CORS case).
5. Pass `ctx`, not `ctx.signal`. `toolFetch` takes the abort signal from `ctx` itself, so STOP still works.
6. **Do not touch:** `waitForImageRun`, run correlation, the invocation ID, `forgeTools.ts`, `blobToDataUrl`, PNG parsing, or the `generated_*.png` matching.

## Tests to add (`src/lib/imageArtifact.test.ts`, new `describe('image result download', …)`)
Use `vi.useFakeTimers()` and the `settle()` helper already in that file. A "hung" fetch looks like this:
```ts
(_input, init) => new Promise<Response>((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))
```
- **(a) Mirror hangs → falls back.** The mirror URL hangs and the artifact list returns `{ artifacts: [] }`. Advance 25 s. Expect a rejection containing `Artifact "generated-image-<id>" was not found on run 7`, which proves it moved past the mirror instead of hanging.
- **(b) Artifact list hangs → bounded failure.** The mirror returns 404 and the artifact list hangs. Advance 120 s. Expect a rejection containing `image-artifact-list` and `timed out`.
- **(c) ZIP download hangs → bounded failure.** The mirror returns 404, the list returns one matching, unexpired artifact, and the download hangs. Advance 200 s. Expect a rejection containing `image-artifact-download` and `timed out`.
- **(d) Happy path unchanged.** The mirror returns a small valid PNG blob. Expect `dataUrl` to start with `data:image/png;base64,`, and no `api.github.com` URL to be fetched at all.

## Mutation checks (paste each failing output)
| Mutation | Must fail |
|---|---|
| Put back the raw `fetch` for the mirror | (a) |
| Put back the raw `fetch` for the artifact list | (b) |
| Put back the raw `fetch` for the ZIP download | (c) |
| Make the mirror `catch` rethrow instead of falling through | (a) |

Each test must fail *because of the mutation*. If one passes under its mutation, the test is wrong: fix the test, not the expectation.

## Gate (all must exit 0; paste the lines)
```
npx tsc -b
npx eslint src
npx vitest run                      # paste the "Test Files" and "Tests" lines
npm run build
git diff --check
git diff --no-renames -z --name-only origin/main | python3 .github/scripts/check-protected.py .github/protected-paths.txt
```

## Report back (template)
```
TASK: 4 image download timeouts
BRANCH + SHA: fix/image-download-timeouts @ <full sha>
CHANGE: <files, one line each>
GATE: tsc=<exit> eslint=<exit> vitest="<Test Files line> / <Tests line>" exit=<exit> build=<exit> diff-check=<exit> protected=<exit>
MUTATION CHECKS: <mutation → test that failed, pasted>
NOT VERIFIED: no live image generation run
ESCALATE: <yes/no + why>
```
Stop after pushing. Do not merge. Do not open a second PR for the same change.

---

# Muse — standing task: live check after every merge
After each merge to `main`, once Pages finishes deploying, run `bash docs/agents/forgeclaw-livecheck.sh 12` from the repo root and paste the whole output to Cristian.
- `RESULT: PASS` → nothing else needed.
- `ATTENTION NEEDED` → follow the table in `docs/agents/MUSE_RUNBOOK.md`, Task 1. Do not fix anything outside the runbook's rules.
