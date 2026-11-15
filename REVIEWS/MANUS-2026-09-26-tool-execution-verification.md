# MANUS Verification Trail — Tool Execution and Coding-Agent Persistence

**Date:** 2026-09-26
**Acting agent:** MANUS (autonomous orchestrator) via ForgeClaw Coding Specialist
**Repository:** `DeviousDevv303/forgeclaw`
**Branch inspected:** `main`
**Base HEAD inspected before this change:** `1f35568c0347972f77cd14cb1e4f32e58456d276`

## Objective

Restore and verify the lean runtime path:

> NEXUS → tool dispatcher → real tool → tool result → NEXUS → concise response

Also retain the assigned coding task, repository, branch, HEAD, progress, files, verification, errors and blockers across a normal browser/page restart.

## Changes made

- `src/lib/tools/index.ts` now derives its exported registries from the executable `src/lib/forgeTools.ts`; the previous duplicate registry was dead code and could drift from the dispatcher.
- `src/lib/forgeTools.ts` now uses the shared GitHub PAT resolver and contains live `github_repo_state`, `github_verify_commit` and `coding_task_update` tools.
- GitHub writes now build an attributed commit message naming `MANUS`, the acting coding agent, what changed and why; the result includes the actual commit SHA and URL.
- `src/lib/codingAgentState.ts` now persists resumable task state, activity, tool results, tests and verification evidence.
- `src/lib/codingAgentRuntime.ts` is the runtime owner for canonical identity, compact request context, request metrics, live repository HEAD reads, progress recording and verification.
- `src/components/CodingAgentStatePanel.tsx` surfaces persisted state and resume status without exposing reasoning traces.
- `src/App.tsx` now passes only a compact runtime envelope to the model, records real tool results and renders the resume/state UI. It does not preload HEAD, repository contents or the full persisted task state into every request.
- `src/lib/canonicalIdentity.ts` is the single source for the application and repository identity consumed by the runtime, tool context and frontend system identity.
- `src/lib/ai/providerRouter.test.ts` proves the router forwards system context, conversation history, tools and tool results without a latest-message-only bypass.
- NEXUS/WebGPU remains the browser-local inference path; no Termux, local inference server or WebGPU engine source was modified.
- Existing tests that incorrectly required a local local inference server/WebGPU runtime now skip when that runtime is unavailable; the runtime itself is not mocked or replaced.

## Verification evidence

### Static validation

- `npx tsc -b` — passed.
- `npm run build` — passed; Vite emitted `dist/`.
- `npx eslint .` — passed.
- `npm test -- --run` — **32 passed, 7 skipped**. Skips are the two local inference server-dependent tests and five live-GitHub tests when live mode is not enabled; no failures.

### Offline dispatcher and persistence integration

`src/lib/toolExecutionChain.test.ts` passed:

- canonical executable tool registry has no duplicate names;
- `run_js` returns a real tool result;
- tool exceptions return `[TOOL ERROR]` and do not crash the loop;
- memory write/read survives a simulated reload;
- GitHub writes fail closed when no token is configured;
- attribution includes `MANUS`, `WHY`, the coding-agent identity and non-generic content;
- a GitHub write result records the returned commit SHA in persisted state;
- unfinished state restores, completed state does not replay;
- dispatcher task updates persist completed/pending steps, verification and blockers.

### Live GitHub acceptance

Executed with the configured GitHub connector/PAT against `DeviousDevv303/forgeclaw`:

```text
FORGECLAW_E2E_GITHUB=1 ... npx vitest run src/lib/toolExecutionChain.test.ts

23 passed, 0 failed
```

The live tests proved:

1. GitHub authentication through the dispatcher.
2. Repository listing through the dispatcher.
3. Current branch and 40-character HEAD returned by `github_repo_state`.
4. `package.json` read from the live repository.
5. Existing commit verification returns the real SHA and changed-file list.
6. A missing commit returns `VERIFICATION FAILED` rather than a false success.

### Lean-context acceptance

- The compact runtime envelope contains canonical identity and the instruction to call a GitHub read tool, but no `HEAD:` value or repository dump.
- The measured envelope is under 500 characters before tool results.
- `REQUEST METRICS (EST.)` records system/context tokens, user tokens, tool-definition tokens, tool-result tokens, total estimated request tokens, model calls and tool calls outside the prompt.
- The acceptance phrase `Go check the ForgeClaw repo and give me some feedback on the repo.` is classified as a repository task and routes to the GitHub tool requirement.

## Scope boundaries

No reasoning traces, chain-of-thought display, manifest execution UX or verbose execution narration were restored. No Termux, local inference server, local inference server or Browser WebGPU inference engine was modified, restarted or replaced.

## Remaining acceptance limitation

This sandbox can prove the frontend compile/build and the dispatcher/API/persistence legs. It cannot drive the actual browser WebGPU model or a user's browser UI session from Node, so the NEXUS model-generation leg remains an environment-dependent manual/browser verification. The code path is wired through `App.tsx` and covered by the manual-tool bridge tests.
