# DeepSeek Artifact-to-UI Repair

**Date:** 2026-10-04  
**Scope:** DeepSeek-16B GitHub Actions workflow, ForgeClaw tool dispatcher, browser UI

## User-facing question

> Can ForgeClaw use the repository-owned DeepSeek reasoning workflow and make the completed answer appear in the chat UI, with browser WebGPU remaining the local fallback?

## Root cause

The `deepseek-16b.yml` workflow already wrote `result.txt` into a short-lived GitHub Actions artifact. ForgeClaw dispatched that workflow, but `executeTool()` returned immediately with a message saying the artifact would be available later. The direct `/deepseek` UI path rendered that dispatch message as the final assistant response, so the actual model answer never reached the browser.

## Repair

- Added `src/lib/deepseekArtifact.ts`, patterned after the existing image artifact bridge.
- Correlates the exact workflow run by `invocation_id`, workflow-dispatch event, `main` branch, and dispatch timestamp.
- Polls the run until completion, fails closed on timeout or a non-success conclusion, and preserves the GitHub run URL.
- Downloads the matching `deepseek-${invocation_id}` artifact, extracts `result.txt`, and rejects empty/malformed artifacts.
- Changed the DeepSeek tool path to wait for and return the verified result. NEXUS learning now records the actual returned result instead of a pending placeholder.
- Extended the end-to-end dispatcher test to prove dispatch, run correlation, artifact download, extraction, and UI-consumable result text.

## Runtime behavior

The direct UI path already renders the returned `executeTool()` output. After this repair, `/deepseek <question>` displays the completed DeepSeek answer and run link in the assistant message. Ordinary requests continue using the existing local llama.cpp → browser WebGPU routing behavior, and image generation continues using its existing artifact/mirror bridge.

## Validation

- `npm run lint`
- `npx tsc -b`
- `npx vitest run src/lib/toolExecutionChain.test.ts src/lib/deepseekCommand.test.ts`
- `npm run build`
- `npm run test:run`
- `git diff --check`

The browser still needs a GitHub token with Actions read/write permission to dispatch and read workflow artifacts. No credentials are written to the repository.
