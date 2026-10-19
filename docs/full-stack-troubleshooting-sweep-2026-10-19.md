# ForgeClaw Full-Stack Troubleshooting Sweep

**Date:** 2026-10-19  
**Baseline:** `main` at `2f523c3` (`fix(github): report code-search auth failures clearly (#154)`)  
**Working branch:** `fix/full-stack-troubleshooting-sweep`

## Verified telemetry

The GitHub Actions API was queried for the latest 20 runs of each workflow. This is the available sample for the requested 30-day review; the repository currently exposes fewer than 30 recent runs for these workflows.

| Workflow | Sample | Success | Failure | Cancelled | Interpretation |
| --- | ---: | ---: | ---: | ---: | --- |
| `shell-exec.yml` | 20 | 16 | 4 | 0 | The workflow dispatch path is functioning. Failed runs are command/workflow outcomes and should remain visible rather than being reported as successful execution. |
| `deepseek-16b.yml` | 20 | 16 | 1 | 3 | The workflow is operational. Cancelled runs are consistent with operator STOP/cancellation and are not treated as model failures. |

The four recent shell failures were not sufficient, by run-list metadata alone, to attribute a single root cause such as authentication or network transport. Step logs are required for per-class counts; no fabricated class counts are recorded here.

## Source/runtime checks

- `src/lib/ai/providerRouter.ts` has no dangling `nexusWebGpuProvider` import and maps `nexus` to `corpusProvider`.
- The CORPUS/DeepSeek route remains the default reasoning path.
- `@mlc-ai/web-llm` remains in `package.json` as required by the protected NEXUS WebGPU implementation. `package.json` was not modified.
- NEXUS/CORPUS learning and observability code was not modified.
- `shell-exec.yml` intentionally uses `permissions: contents: read` and `persist-credentials: false`; it does not perform repository pushes. Adding write permission would expand authority without fixing the observed command failures, so this was recorded as not applicable rather than applied.
- The workflow already uses `actions/checkout@v4`; no full-history operation was found in the shell command contract, so `fetch-depth: 0` was not added speculatively.

## Fixes applied on this branch

1. Added an explicit `RATE_LIMIT` failure class in `src/lib/agentCore.ts`.
2. Classified GitHub rate-limit messages before generic 401/403 authentication handling.
3. Added rate-limit retry guidance and telemetry discarded paths for exponential backoff and alternate endpoints.
4. Updated the DeepSeek workflow to use `temperature=0.6` and `top_p=0.9` for both GGUF and transformers generation.
5. Added a fallback from an empty primary DeepSeek response to `deepseek-ai/deepseek-coder-1.3b-instruct`, with honest metadata explaining why the fallback was used.
6. Added regression coverage for the new failure class and DeepSeek empty-output behavior.

## Explicitly not applied

- `package.json` was not modified.
- No direct push to `main` was performed.
- No NEXUS learning, CORPUS admission, Guardian, or observability code was deleted or bypassed.
- No tree-search fallback was adopted: the existing proposal only matches file names, not code contents, and would therefore misrepresent `github_search_code` semantics. A server-side search proxy remains the correct follow-up if browser transport failures persist.

## Verification plan

The branch must pass the focused Vitest suite, the embedded DeepSeek Python workflow tests, TypeScript build, and lint before opening a pull request. The final PR should include the resulting commit SHA and CI run links.
