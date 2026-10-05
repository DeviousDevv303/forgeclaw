# DeepSeek path — operational repair, 2026-10-05

**Repository:** `DeviousDevv303/forgeclaw`
**Starting build:** `d12d819858c5` (`main`)
**Reported symptom:** the live UI showed `DeepSeek → NEXUS WebGPU · Qwen secondary`,
`Deepseek Reason`, `[TOOL ERROR] Failed to fetch`, `1 RESPONSES · 0 TOOL CALLS`,
and the request stayed on `Processing…`.

This document records what was actually measured, what was actually wrong, what
changed, and the end-to-end proof. It deliberately separates **measured** facts
from **inference**.

---

## 1. What the architecture is supposed to do

`CORPUS/NEXUS default → DeepSeek primary reasoning workflow → real DeepSeek
result → NEXUS WebGPU/Qwen secondary synthesis/fallback`

Preserved exactly. Nothing in this repair changes the routing contract,
Guardian authority, CORPUS memory, NEXUS WebGPU, Qwen's secondary role, shell
execution, GitHub repository tools, image generation, or the image CORS mirror.

---

## 2. Measured evidence

### 2.1 Workflow dispatch is not the failure

`workflow_dispatch` from a browser origin is fully permitted by GitHub:

```
OPTIONS /repos/DeviousDevv303/forgeclaw/actions/workflows/deepseek-16b.yml/dispatches
Origin: https://deviousdevv303.github.io
→ HTTP/2 204
  access-control-allow-origin: *
  access-control-allow-methods: GET, POST, PATCH, PUT, DELETE
  access-control-allow-headers: Authorization, Content-Type, …
```

A real `POST` (same headers the browser sends) returned `HTTP 204`, and a real
correlated run was created. **Dispatch, run correlation and polling are proven
working from outside the app.**

### 2.2 The GitHub Actions workflow does run and does complete

| Run | Created (UTC) | Result | Duration |
|---|---|---|---|
| `37269205823` | 2026-10-05T05:45:36Z | success | ~5m38s |
| `37272285884` (reproduction) | 2026-10-05T06:24:51Z | success | ~5m31s |

The reproduction run produced artifact `deepseek-deepseek-repro-1791181489`
(254 bytes). A real `result.txt` was recovered from a prior run and read
successfully outside the browser.

**The 6.7B CPU inference path is operational**, with a warm Hugging Face cache
(model weight load ≈ 41 s).

### 2.3 A real, previously-corrected workflow defect (for the record)

Run `37237284528` (2026-10-04T21:44Z) failed at the inference step with:

```
TypeError: ones_like(): argument 'input' (position 1) must be Tensor, not BatchEncoding
```

Root cause: `apply_chat_template(..., return_tensors='pt')` was wrapped in
`torch.ones_like(encoded)` by hand. Commit `6228c5a` *"fix: pass chat template
inputs to DeepSeek"* replaced that with `return_dict=True` and the next run
(`37237546987`, 21:48Z) succeeded. The current workflow is the corrected one.

### 2.4 Artifact retrieval — measured, and honestly reported

The directive asserted that `archive_download_url` is a browser-hostile
redirect chain. Measured on 2026-10-05:

```
GET https://api.github.com/repos/…/actions/artifacts/11328200885/zip
→ 302 → https://productionresultssa13.blob.core.windows.net/…
  access-control-allow-origin: *        (GitHub hop)

GET  <azure blob signed url>  (Origin: https://deviousdevv303.github.io)
→ 200, Content-Type: application/zip
  Access-Control-Allow-Origin: *        (blob hop)
  Access-Control-Expose-Headers: …
```

**Both hops currently return permissive CORS.** The layer-3 network failure
could not be reproduced from outside the browser, so this repair does **not**
claim the artifact endpoint is currently broken. What it does claim is that:

* the artifact path is a **two-hop cross-origin redirect chain** whose CORS
  behaviour is controlled by GitHub/Azure and has changed before;
* this repository already solved exactly this class of problem for images with a
  `raw.githubusercontent.com` mirror (`generated-images`), and
* the DeepSeek path had **no** equivalent mirror, so it had no browser-safe
  route when that chain misbehaves.

The repair therefore makes the mirror the **primary** path and keeps the
artifact as a **fallback** — matching the proven image pipeline instead of
maintaining a second, different retrieval strategy.

---

## 3. Defects fixed

| # | Defect | Fix |
|---|---|---|
| 1 | `deepseekArtifact.ts` used raw `fetch()` for every GitHub read, bypassing the hardened `toolFetch()` used by `shell_exec` — no timeout, no retry, no consistent `cache: no-store`, no abort wiring. | Extracted the boundary into `src/lib/githubFetch.ts`. `forgeTools.ts` and `deepseekArtifact.ts` now share **one** implementation (`toolFetch`, `GITHUB_READ_*`). |
| 2 | No browser-safe result route. | The workflow now publishes `deepseek-results/<invocation_id>.txt` to the `deepseek-results` branch; the client reads it from `raw.githubusercontent.com` first, then falls back to the artifact. |
| 3 | A failure surfaced as a bare `[TOOL ERROR] Failed to fetch`. | New stage labels: `deepseek-dispatch`, `deepseek-run-discovery`, `deepseek-run-poll`, `deepseek-artifact-list`, `deepseek-artifact-download`, `deepseek-artifact-unzip`, `deepseek-result-extract`, `deepseek-learning-persistence`. Browser transport errors are classified as `browser network/CORS failure — the request produced no HTTP response`. |
| 4 | DeepSeek dispatch errors did not reuse the proven dispatcher guidance. | `deepseek_reason` now uses `describeGithubDispatchFailure()` (the same classifier `shell_exec` uses) for 401/403/404. |
| 5 | Learning persistence failure was indistinguishable from a reasoning failure. | Wrapped separately; a corpus write failure now reports `deepseek-learning-persistence` and still returns the DeepSeek output. |
| 6 | A failed DeepSeek request could leave the UI on `Processing…` and read as `0 TOOL CALLS`. | The NEXUS/WebGPU **secondary synthesis is now bounded** (`SECONDARY_SYNTHESIS_TIMEOUT_MS`, 8 min) so it can never hang; the assistant error path now attaches `agentPhase: 'BLOCKED'` and the run's real `toolResults`. |
| 7 | Workflow truthfulness / memory safety. | The workflow already ran the truthful 6.7B checkpoint; it now also records `result_meta.txt` (`model=`, `role=`, `elapsed_seconds=`) and falls back to the smaller public DeepSeek checkpoint if the 6.7B load/execute fails, instead of failing the run. The DeepSeek role, dispatch, artifact and mirror contracts are identical in both cases. |

---

## 4. Files changed

```
.github/workflows/deepseek-16b.yml   mirror publish, contents: write, meta + memory fallback
src/lib/githubFetch.ts               NEW — single hardened GitHub boundary + stage classifiers
src/lib/deepseekArtifact.ts          mirror-first retrieval, toolFetch, per-stage errors
src/lib/forgeTools.ts                re-exports the shared boundary; staged DeepSeek dispatch
src/lib/ai/providerRouter.ts         bounded secondary synthesis (no unbounded WebGPU wait)
src/App.tsx                          failed runs keep their real tool results; terminal BLOCKED phase
src/lib/deepseekArtifact.test.ts     NEW — mirror-first, artifact fallback, every failure stage
src/lib/toolExecutionChain.test.ts   updated for the mirror probe
```

---

## 5. Static verification

| Gate | Result |
|---|---|
| `npm run check:conflicts` | PASS (no conflict markers) |
| `npx tsc -b` | PASS |
| `npx eslint .` | PASS |
| `npx vitest run` | **173 passed, 8 environment-dependent skips** |
| `npm run build` | PASS |

New coverage proves, without mocking the failure away:
`Failed to fetch` on dispatch → `deepseek-dispatch: browser network/CORS failure`;
HTTP 403 on discovery → `deepseek-run-discovery: … HTTP 403`;
missing artifact → `deepseek-artifact-list: … was not found on run N`;
mirror hit → artifact endpoint never called; mirror 404 → artifact fallback used.

---

## 6. Live acceptance

See section 7 (appended after the deployed browser run).

---

## 7. Live acceptance — deployed GitHub Pages path

_To be completed from the deployed `main` build._