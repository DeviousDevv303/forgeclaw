# MANUS Proposal — Resolve the Saved-Agent Autonomy Gap

**Date:** 2026-09-26
**Repository:** `DeviousDevv303/forgeclaw`
**Current deployed commit:** `57c1528`
**Status:** Proposal only; no implementation changes are made by this document.

## Executive recommendation

ForgeClaw should not receive another independent agent engine. The existing ForgeMind runtime already owns the difficult and safety-critical capabilities: provider routing, tool dispatch, Guardian approval, GitHub reads and writes, commit verification, Actions execution, retry classification, sub-agent calls, and coding-task persistence.

The defect is an **execution-boundary mismatch**:

> `AgentsPanel → callProvider()`
>
> should become:
>
> `AgentsPanel → shared agent execution runtime → provider → tools → Guardian → persistence → verification → UI trace`

The saved `GitHub Coding Specialist` should become a persistent **agent profile and session owner**, not a second chat implementation. The fix is to reuse the current autonomous loop behind a shared runtime API and give every saved agent an explicit capability profile and agent-scoped state.

## Confirmed current problem

The current Agents panel stores an agent definition and transcript, but its send path directly calls `callProvider()` with the saved system prompt and chat history. It does not pass the ForgeMind tool definitions, call `executeTool()`, enter the Guardian gate, update `codingAgentState`, or run commit/verification logic.

The result is misleading product behavior: a saved agent can look like a coding specialist and retain its transcript, but it cannot actually inspect or modify the repository. ForgeMind can do those things, but the two paths are disconnected.

There is a second isolation defect: the coding state currently uses the global key `fc_coding_agent_state`. Even after tools are connected, multiple saved agents would compete for one task record unless state is scoped by `agentId`.

## Target architecture

```text
Saved agent definition
  ├─ agentId, name, system prompt
  ├─ capability profile
  ├─ transcript key: fc_custom_agent_chat:<agentId>
  └─ task key: fc_coding_agent_state:<agentId>
             │
             ▼
      Shared Agent Runtime
  ├─ compact context + provider router
  ├─ attributed tools
  ├─ Guardian/co-sign policy
  ├─ executeTool()
  ├─ retry and failure classification
  ├─ AbortController + run ownership
  ├─ coding task persistence
  └─ verification/activity events
             │
             ▼
       AgentsPanel UI
  ├─ transcript
  ├─ live tool/activity trace
  ├─ Guardian approval cards
  ├─ STOP
  ├─ files/commit/test status
  └─ resumable task banner
```

The runtime must be the only place that decides whether a model response is a final answer or a tool call. The panel should render runtime events and submit user turns; it must not independently call a provider.

## Proposed implementation

### 1. Introduce one shared runtime entry point

Extract or consolidate the existing ForgeMind loop into a reusable module, for example:

```ts
export interface AgentExecutionProfile {
  agentId: string
  label: string
  systemPrompt: string
  capability: 'chat' | 'coding'
  allowedToolNames?: string[]
  stateKey: string
  transcriptKey: string
}

export interface AgentRunCallbacks {
  onToken?: (token: string) => void
  onEvent?: (event: AgentRuntimeEvent) => void
  requestGuardianApproval?: (request: GuardianRequest) => Promise<boolean>
}

export async function runAgentTurn(
  profile: AgentExecutionProfile,
  history: AIMessage[],
  userText: string,
  options: { provider: ProviderId; model: string; apiKey: string; signal: AbortSignal; callbacks: AgentRunCallbacks },
): Promise<AgentTurnResult>
```

The implementation should reuse the existing tool definitions, attribution contract, `executeTool()`, retry decision functions, coding-state recorders, and provider router. The ForgeMind tab and Agents panel should both call this function. The old `managedAgent.ts` sub-agent loop should either call this runtime with a bounded profile or be explicitly kept as a separate internal child-runtime adapter; it should not grow a third behavior path.

### 2. Add an explicit capability profile

Do not grant every saved agent every tool merely because its prompt says “coding specialist.” Store a capability profile with the agent definition:

| Profile | Tools | Guardian behavior |
|---|---|---|
| `chat` | No tools | No approval required |
| `coding-readonly` | Repository state, file read/search, commit read/verify | No write approval; verification visible |
| `coding` | Read tools plus file write, branch/commit and Actions tools | Co-sign for writes, pushes, destructive or external actions |

For the existing `GitHub Coding Specialist`, migrate it to `coding` only after showing a one-time capability notice. The runtime, not the system prompt, is the authority that filters tools.

NEXUS/WebGPU remains local and tool-disabled. If a saved coding agent uses NEXUS, the UI must explain that it can reason locally but cannot perform repository operations until a tool-capable provider is selected. This avoids silently presenting a coding agent with capabilities its provider cannot execute.

### 3. Scope persistent coding state by agent

Replace the single coding state key with an agent-scoped key:

```ts
fc_coding_agent_state:<agentId>
```

Keep the current global `fc_coding_agent_state` as a migration source for the default ForgeMind profile only. Add `loadCodingAgentState(agentId)`, `saveCodingAgentState(agentId, partial)`, `restoreCodingAgentState(agentId)` and `clearCodingAgentState(agentId)`.

Every persisted state record must carry `agentId`, `agentLabel`, owner/repository identity, branch, HEAD, task, tool results, verification, tests, errors, blockers and continuation notes. On every tool result, verify that the active run's `agentId` matches the state record before writing it. This prevents cross-agent contamination when users switch tabs or open two sessions.

### 4. Move AgentsPanel to runtime callbacks

Remove the direct `callProvider()` import from `AgentsPanel`. The panel should receive an execution callback from the application/runtime layer:

```ts
<AgentsPanel
  agents={...}
  activeProvider={activeProvider}
  activeModel={normalizedActiveModel}
  apiKey={currentApiKey}
  onRunTurn={runSavedAgentTurn}
/>
```

`runSavedAgentTurn` should:

1. Create a run ID and `AbortController`.
2. Load the agent-scoped transcript and coding state.
3. Build compact context without injecting the full state blob on every request.
4. Call the shared runtime with the agent's capability profile.
5. Stream tokens and structured activity events to the panel.
6. Route tool calls through Guardian and `executeTool()`.
7. Persist each tool result, verification result and transcript update.
8. Mark the task `complete`, `blocked` or `in_progress` with a continuation note.
9. Clear ownership only when the matching run finishes or is stopped.

The panel retains its useful UI responsibilities—agent list, editor, transcript, STOP button—but no longer owns orchestration policy.

### 5. Make the runtime observable before changing behavior

Add a trace ID to every saved-agent run and record a compact event sequence:

```text
run_started
provider_request
provider_response
tool_call_detected
guardian_requested / guardian_approved / guardian_rejected
tool_started
tool_finished
tool_failed
retry_decision
state_saved
verification_started
verification_finished
run_completed / run_blocked / run_aborted / run_failed
```

Expose this in the activity panel and persist only bounded summaries. This makes it possible to distinguish these failure classes quickly:

| Symptom | Likely boundary | First diagnostic |
|---|---|---|
| Agent answers but never calls a tool | Panel/provider request | Assert tool definitions reached the router |
| Tool call appears but no side effect | Dispatcher/context | Log tool name, input schema and `executeTool()` result |
| Side effect occurs but state is empty | Persistence scope | Assert state key includes active `agentId` |
| Wrong agent resumes another task | Session ownership | Compare run/profile/state agent IDs |
| STOP leaves a running activity item | Cancellation | Assert matching run ID clears streaming/tool state |
| NEXUS reports unavailable tools | Provider capability | Assert `supportsTools=false` is shown as a limitation |
| Commit is not visible remotely | Verification | Require `github_verify_commit` after write/push |

## Troubleshooting and resolution sequence

### Phase 0 — Reproduce with read-only evidence

Use a disposable saved agent with `coding-readonly` capability and send:

> Inspect the configured repository, report the current branch and HEAD, and list the first three relevant files. Do not modify anything.

Capture the trace. A resolved read-only path must show a provider request with tools, a real `github_repo_state`/read operation, a tool result, persisted activity, and a final response that cites the observed repository state. A text-only answer is a failed acceptance, even if it sounds correct.

### Phase 1 — Connect the existing runtime

Implement the shared runtime entry point and route both ForgeMind and saved agents through it. Do not initially add new tools or new providers. Use the existing `ATTRIBUTED_TOOLS`, `executeTool()`, Guardian logic and retry policy.

Acceptance gate: the saved Coding Specialist completes the read-only test above and its transcript, activity, and agent-scoped state survive a reload.

### Phase 2 — Enable controlled writes

Give the Coding Specialist the `coding` capability. Test a reversible change in a dedicated branch or test file. The expected path is:

```text
request → repository inspection → proposed write → Guardian approval
→ github_write_file → commit attribution → github_verify_commit
→ Actions/build verification → persisted completion state
```

No write should occur without the configured Guardian policy. If the user rejects approval, the task must become `blocked` with a continuation note rather than disappearing or retrying indefinitely.

### Phase 3 — Test interruption, resume and isolation

Run a long operation, press STOP, reload, and resume. Then create a second saved agent and verify that its transcript and coding state are independent. Test provider switching while idle and while a run is active; the active run must retain its provider/model snapshot and must not be silently redirected.

### Phase 4 — Hosted acceptance

Deploy to GitHub Pages and verify:

- `OPEN CHAT` still restores the selected agent.
- A tool-capable provider shows the coding capability and performs a read-only tool call.
- NEXUS clearly reports local reasoning/tool limitations.
- Guardian approval, STOP, activity trace and task state are visible.
- No UI claims autonomous coding when the provider or token configuration cannot support it.
- The hosted source and GitHub Actions build contain the same runtime contract as local development.

## Definition of done

The issue is resolved only when all of these are true:

1. The saved Coding Specialist uses the same tool loop as ForgeMind.
2. `AgentsPanel` no longer calls `callProvider()` directly.
3. A saved agent can perform a verified read-only repository task.
4. A controlled write reaches the real dispatcher and requires the correct Guardian approval.
5. Commit attribution and remote commit verification are recorded.
6. Coding state is scoped by `agentId` and survives reload/resume.
7. Two agents cannot overwrite each other's transcripts or task state.
8. STOP aborts the matching run and leaves no stale streaming/tool activity.
9. Provider limitations are enforced by runtime capability, not by prompt wording.
10. Local tests, build, GitHub Actions and hosted browser acceptance all pass.

## Risks and safeguards

**Risk: duplicate orchestration loops.** Mitigation: one shared `runAgentTurn`; ForgeMind and AgentsPanel become callers, not separate implementations.

**Risk: accidental write authority.** Mitigation: capability profiles, server/tool-side filtering, Guardian checks and explicit write acceptance tests.

**Risk: state corruption during concurrent runs.** Mitigation: run ownership, agent ID checks, per-agent storage keys and last-write protection.

**Risk: provider mismatch.** Mitigation: test `supportsTools` before starting a coding run and display a blocked explanation for local providers without tools.

**Risk: migration breaks existing users.** Mitigation: preserve existing transcript keys, migrate the global coding state only to the default ForgeMind profile, and version the agent schema.

## Recommended execution order

1. Add agent capability and agent-scoped state schema.
2. Extract the shared runtime loop with trace callbacks.
3. Route ForgeMind through the extracted runtime without behavior changes.
4. Route AgentsPanel through the same runtime and delete its direct provider call.
5. Add read-only, Guardian-write, resume/isolation and STOP acceptance tests.
6. Run local verification, deploy, perform hosted acceptance, and append the evidence to the MANUS review trail.

This sequence solves the architectural discrepancy with the smallest safe change: it connects the saved-agent interface to machinery that already works instead of creating another autonomous system.
