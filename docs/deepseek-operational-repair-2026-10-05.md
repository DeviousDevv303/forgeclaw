# DeepSeek path — operational repair and live acceptance, 2026-10-05

**Repository:** [`DeviousDevv303/forgeclaw`](https://github.com/DeviousDevv303/forgeclaw)
**Code commits:** [`d87fcb9`](https://github.com/DeviousDevv303/forgeclaw/commit/d87fcb9) (shared GitHub boundary + mirror), [`c992879`](https://github.com/DeviousDevv303/forgeclaw/commit/c99287939742ebe3d6f748c891a9241aee9c08b9) (hard WebGPU deadline)
**Live site:** [deviousdevv303.github.io/forgeclaw](https://deviousdevv303.github.io/forgeclaw/)

This record separates **measured evidence**, **fixed defects**, and **remaining limitations**. A GitHub Actions result is only described as successful where an actual run and output artifact exist.

---

## 1. Intended architecture (preserved)

`CORPUS/NEXUS default → DeepSeek primary reasoning workflow → actual DeepSeek result → NEXUS WebGPU/Qwen secondary synthesis or honest fallback`

This repair does not change the routing contract, Guardian authority, CORPUS memory, NEXUS WebGPU, Qwen's secondary role, shell execution, GitHub repository tools, image generation, or the existing image mirror. Qwen was **not** made the primary reasoner.

---

## 2. Credential boundary — verified

The deployed message **“GitHub token: not set”** is a browser-runtime configuration fact; it does not imply the private test credential was missing or lost.

* ForgeClaw's client resolver in `src/lib/githubAuth.ts` reads only `import.meta.env.VITE_GITHUB_TOKEN` / `VITE_GH_TOKEN`, or the browser's `localStorage` key `gh_token`.
* The repository has **no project `.env` file**. `.env` and `.env.*` are ignored by Git. A private session `GH_TOKEN` was available to the sandbox test runner through its configured credential environment; that variable is not automatically visible to GitHub Pages or to the browser bundle.
* For the live acceptance run, the test runner supplied that credential to an **ephemeral Chromium context's localStorage** so the real deployed UI could make its authorized API calls. The credential value was not printed, committed, or placed in the production build.
* An exact-value scan found no copy of the configured credential in tracked files or `dist/`.

**Operational implication:** normal users must configure their own GitHub credential through ForgeClaw Settings before using browser-side GitHub Actions tools. A local `.env` or runner-only variable is not magically propagated to Pages; the safe fix is not to embed a PAT into the Pages build.

---

## 3. What the original evidence says

### 3.1 Dispatch and Actions execution

A browser-origin GitHub preflight for `workflow_dispatch` returned HTTP 204 with permissive GitHub CORS headers. Real POSTs returned HTTP 204 and created correlated runs. Dispatch, run discovery and status polling are therefore not inherently blocked by the Pages origin when a credential is configured in the browser.

### 3.2 Artifact URL behavior

A direct probe of GitHub's artifact ZIP endpoint returned a two-hop redirect (`api.github.com` → Azure Blob); both hops returned permissive CORS headers during the probe. The reported browser `Failed to fetch` could not be reproduced on those two hops at that moment. This report therefore does **not** assert that the ZIP endpoint was always failing. However, it was a browser-dependent third-party redirect chain with no repository-controlled fallback, whereas ForgeClaw already used a `raw.githubusercontent.com` mirror for images. The repair adopts that proven pattern for DeepSeek: mirror first, artifact fallback.

### 3.3 Prior workflow defect, already fixed before this work

Run [`37237284528`](https://github.com/DeviousDevv303/forgeclaw/actions/runs/37237284528) failed at inference with `ones_like(): argument 'input' must be Tensor, not BatchEncoding`. Commit `6228c5a` changed the chat-template result to `return_dict=True`; the next run succeeded. The inference workflow used for this repair contains that correction.

---

## 4. Defects fixed

| # | Defect | Fix |
|---|---|---|
| 1 | `deepseekArtifact.ts` used raw `fetch()` for GitHub API reads instead of the hardened `toolFetch()` already used by `shell_exec`. | Extracted one shared boundary into `src/lib/githubFetch.ts`; both paths now share bounded read retry, timeout, `cache: no-store`, and abort handling. |
| 2 | DeepSeek had no repository-controlled browser-readable result route. | Workflow publishes `deepseek-results/<invocation_id>.txt` on branch `deepseek-results`; browser reads `raw.githubusercontent.com` first, with the artifact ZIP retained as fallback. |
| 3 | Transport errors surfaced as an opaque `Failed to fetch`. | Added stage-specific labels for dispatch, run discovery/polling, artifact listing/download/unzip, result extraction, and learning persistence; browser-level network/CORS failures are identified as no-response transport failures. |
| 4 | DeepSeek dispatch errors did not reuse the proven dispatch classifier. | `deepseek_reason` now uses `describeGithubDispatchFailure()` for 401/403/404. |
| 5 | Corpus/learning write errors were conflated with reasoning failure. | Learning persistence is isolated under `deepseek-learning-persistence`; the real DeepSeek text is preserved in the diagnostic. |
| 6 | The existing 8-minute NEXUS/WebGPU safeguard only aborted an `AbortSignal`. WebLLM can ignore it while loading/compiling a model, so the outer UI await had no guaranteed deadline. | `sendSecondaryWithTimeout()` now races the provider promise against a real timer and parent cancellation; abort remains best-effort. If both Qwen attempts fail/time out and the actual DeepSeek result exists, the router returns that result instead of hanging or inventing a replacement. The failed-message UI retains real tool results and reaches a terminal phase. |
| 7 | Checkpoint identity and low-memory fallback were not recorded in the result. | Workflow writes `result_meta.txt` with the actual checkpoint, role and elapsed time; it tries a smaller public DeepSeek checkpoint only if the primary cannot load/run. |

---

## 5. Live end-to-end proof — post-fix GitHub Pages build

The Build Gate and Pages deploy for `c992879` both succeeded. The live Pages deployment run is [`37274869662`](https://github.com/DeviousDevv303/forgeclaw/actions/runs/37274869662); the deployed JavaScript asset contained the hard-deadline code (`Promise.race` / timeout message).

The real browser test used the actual Pages UI, `provider=corpus`, a WebGPU-capable Chromium context, and the credential boundary described above. It did **not** mock the GitHub dispatch or workflow:

| Stage | Observed evidence |
|---|---|
| Pages app → router | The app loaded the new `c992879` bundle and showed the default `DeepSeek → CORPUS/NEXUS · Qwen secondary` route. |
| Router → GitHub dispatch | Browser request POSTed to `actions/workflows/deepseek-16b.yml/dispatches`; the UI created invocation `deepseek-1791183398544-nv2ycq`. |
| Dispatch → Actions workflow | Real run [`37275004192`](https://github.com/DeviousDevv303/forgeclaw/actions/runs/37275004192) completed with conclusion **success** on commit `c99287939742ebe3d6f748c891a9241aee9c08b9`. Its inference, mirror-publish and artifact-upload steps all succeeded. |
| Workflow → primary result | Artifact `deepseek-deepseek-1791183398544-nv2ycq` (ID `11330735216`) contained `result.txt` and `result_meta.txt`. Metadata: `model=deepseek-ai/deepseek-coder-6.7b-instruct`, `role=primary checkpoint`, `elapsed_seconds=325.0`. |
| Result → browser | The browser fetched the raw mirror URL and received HTTP 200. Mirror and artifact `result.txt` SHA-256 both equaled `30bb958d2df7da82565ec1ac3c78912b5ff136ac891bf9496b8bb440d2079813`. |
| Browser → ForgeClaw UI | Live conversation reached **COMPLETE**, no final `[TOOL ERROR]` or `Failed to fetch`, and no lingering `Processing…`. It displayed a real `deepseek_reason` result and run link. |

**Critical remaining result-quality limitation:** the actual primary checkpoint returned a generic refusal (“I don't have the ability to directly interact with … ForgeClaw”) rather than an answer about this repository. That text was preserved, not fabricated. Qwen 3B and the 1.5B fallback were attempted, but the UI reported **“Qwen WebGPU secondary unavailable”** and displayed the actual DeepSeek result as fallback. Thus the live test proves the requested transport/workflow/result path, **not** that the model answered the question correctly or that Qwen synthesis succeeded.

This distinction is important: the run really executed and has a real artifact, while the answer quality and secondary WebGPU availability remain separate issues for future work.

---

## 6. Static verification

| Gate | Result |
|---|---|
| `npm run check:conflicts` | PASS (no conflict markers) |
| `npx tsc -b` | PASS |
| `npx eslint .` | PASS |
| `npx vitest run` | **174 passed, 8 environment-dependent skips** |
| `npm run build` | PASS |
| hard-deadline regression | PASS: a provider that never resolves and ignores `AbortSignal` cannot hold either Qwen attempt open; the actual DeepSeek result is returned after bounded failures |
| exact credential in tracked files or production `dist/` | **Not found** |

Added coverage also checks dispatch/network error labels, HTTP discovery errors, missing-artifact handling, mirror-first selection and artifact fallback. The mirror-first path is proven in the deployed browser; the ZIP fallback is covered by tests and the produced ZIP was separately downloaded and digest-compared with the mirror.

---

## 7. Commits and deployment

* `d87fcb9`: shared GitHub boundary, stage-specific DeepSeek errors, browser-readable mirror, truthful result metadata/fallback.
* `c992879`: hard WebGPU secondary deadline and a never-resolving-provider regression test.
* The Pages deploy and Build Gate for `c992879` both completed successfully; current `gh-pages` commit: `182d2eaffcae2d88f58eac8603bd5c4eab313c54`.

The repair did not alter Guardian Architecture.