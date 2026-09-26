# Runtime Integrity Mission — Pre-flight

**Date:** 2026-09-26  
**Baseline HEAD:** `a3d43416ed9b88247b2ca9f32d52fdcdef64f905`  
**Branch:** `main`  
**Working tree:** clean before this audit document.

## Baseline findings

The deployed runtime has one real ForgeMind tool loop in `App.tsx`: provider router → model → tool calls → an App-local Guardian check → `executeTool()` → tool result continuation. `executeTool()` is also called by `managedAgent.ts`, `codingAgentRuntime.ts`, tests, and future callers.

The critical integrity defect is that Guardian enforcement was not inside the authoritative dispatcher. `App.tsx` called `requiresCoSign()` before `executeTool()`, but `managedAgent.ts`, `codingAgentRuntime.ts`, tests, and any future caller could call `executeTool()` directly. `managedAgent.ts` could therefore execute protected tools without the App Guardian callback. The default `tier1Active` state is `false`, which intentionally means fully autonomous execution; the policy existed, but its enforcement boundary was caller-owned.

The custom Agents panel imported `callProvider()` directly and did not use `FORGE_TOOLS`, `executeTool()`, Guardian, or coding-task persistence. Its transcript was agent-keyed, but coding state remained global under `fc_coding_agent_state`.

STOP protected the visible App run with an `AbortController` and run-ID checks, but the dispatcher did not receive a signal or run identity. Managed sub-agent calls did not receive cancellation or Guardian context. Late tool results could therefore reach persistence or UI-side consumers after a parent run was stopped.

## Five-phase/Cognitive OS result

History shows the original five-phase artifact in `src/lib/reasoningMock.ts` (`assumptions`, `heuristics`, `first_principles`, `extension`, `convergence`) was explicitly marked **DEV-ONLY** and simulated events; it was not a genuine execution engine. Commit `fc60069` intentionally replaced the old Syncognitive Lattice UI with `LiveExecution`.

The real historical execution design is recoverable in `agentCore.ts`: `INTERPRET`, `PLAN`, `EXECUTE`, `VERIFY`, `ADAPT`, followed by iteration and completion/blocking. The current App prompt and parser retain this as `INTERPRET`, `UNDERSTAND`, `EXECUTE`, `VERIFY`, `ADAPT`, `ITERATE`, while the LiveExecution panel consumes real ForgeOps events. I did not restore the DEV-ONLY simulated Cognitive OS as if it were real reasoning. The implementation preserves and makes the real execution phases observable through runtime events and persisted task state.

## Provider paths

The current source retains Browser WebGPU/NEXUS and local inference/Ollama-compatible paths. NEXUS uses the tested provider-boundary message adapter and manual tool parsing; local inference uses the OpenAI-compatible endpoint and native/manual tool paths. Neither was removed while fixing agent/runtime integrity.

## Planned correction boundary

1. Move Guardian policy evaluation into `executeTool()` through explicit project-owned `ToolContext` policy/callback data.
2. Propagate agent ID, run ID, abort signal and Guardian context through managed sub-agents.
3. Scope coding state by agent ID while preserving migration compatibility for the default ForgeMind state.
4. Route saved Agents through the existing tool-capable managed runtime rather than direct provider calls.
5. Add negative, isolation, cancellation and persistence tests, then inspect the actual diff and run the full verification matrix.

No Manus runtime dependency or opaque authority mechanism will be introduced.

## Implemented correction

- `executeTool()` now owns the Guardian boundary. In Tier 1 it refuses protected tools without the project-owned approval callback, requests approval through the App callback, rechecks cancellation, and only then enters the side-effect switch. App-level duplicate gating was removed.
- `ToolContext` now carries `agentId`, `runId`, `AbortSignal`, Tier 1 policy state and the approval callback. `managedAgent.ts` propagates cancellation and uses the same dispatcher context, so sub-agents cannot silently bypass the boundary.
- All dispatcher network requests use a shared cancellation wrapper. Aborted runs are rejected before tool execution and late tool results are rejected before UI, corpus or durable-state mutation. A remote operation already accepted by an external API remains externally observable; ForgeClaw does not misrepresent it as undone.
- Coding state is agent-scoped (`fc_coding_agent_state:<agentId>`), while the existing ForgeMind key remains migration-compatible. Dispatcher persistence calls use the active agent identity.
- Saved agents now run through the existing managed runtime and real `FORGE_TOOLS` dispatcher, with agent-scoped transcripts, run IDs, AbortController cancellation and the same provider paths. Direct saved-agent provider execution was removed.
- `LiveExecution` is now mounted in ForgeMind and receives real objective, plan, execute, verification, retry/adaptation, tool, checkpoint and terminal events. The old DEV-ONLY simulated five-phase stream was not restored as fake reasoning.
- Persisted state records both `sessionId` and `activeRunId`; agent-scoped keys prevent one saved agent from reading another agent’s task history. ForgeMind retains the legacy default key for safe migration.

## Verification

| Check | Result | Evidence |
|---|---|---|
| TypeScript | PASS | `npx tsc -b` |
| ESLint | PASS | `npx eslint .` |
| Production build | PASS | `npm run build` |
| Focused regressions | PASS | 32 passed, 5 environment-dependent skips |
| Full regression | PASS | 41 passed, 7 environment-dependent skips |
| Dispatcher integrity | PASS | Guardian bypass negative test, approved-write test, agent-state isolation test |
| GitHub push | PASS | Commit `f739b401abdc89e04c1291c0d4eed4409563940c` on `main` |
| Pages deployment | PASS | GitHub Actions run `36269363822` |

The build reports only the existing large WebGPU/vendor chunk and stale Browserslist-data warnings; neither is a correctness failure.

## Sovereignty constraint

The correction uses only ForgeClaw source, browser APIs, the project-owned dispatcher, the existing Guardian policy and explicit local persistence. No proprietary Manus code, opaque service dependency, hidden blockade, or vendor-owned execution layer was introduced.
