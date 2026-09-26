# MANUS — Live Execution, Persistent Agents, Isolation and STOP Audit

**Date:** 2026-09-26
**Acting agent:** MANUS via ForgeClaw Coding Specialist
**Repository:** `DeviousDevv303/forgeclaw`
**Purpose:** Pre-implementation audit required by the runtime consolidation directive.

## Current architecture

### Agent lifecycle

- `src/components/AgentsPanel.tsx` owns custom-agent definitions in `fc_custom_agents`.
- Definitions persist, but selected-agent chat is component-local state only.
- The only lifecycle action is `launchAgent`, which sets `activeAgent`, clears chat, and creates a new transient transcript.
- Saved agents therefore require `LAUNCH CHAT` and do not retain agent-scoped conversation state across reloads.
- `App.tsx` separately owns the ForgeMind conversation and the persistent coding-agent task state in `fc_coding_agent_state`.
- These are two competing user-facing execution paths: custom agents use `callProvider` directly, while ForgeMind uses `sendViaRouter` plus the real tool dispatcher.

### Chat/session and message ownership

- ForgeMind uses one global `messages` state and one `forgemind_history` localStorage key.
- `sessionId` is generated once per App mount for shell audit, not for transcript ownership.
- Custom-agent chat uses one local `chatMessages` array, replaced on launch and not keyed by agent ID.
- No agent-scoped transcript, active-run ID, or AbortController exists.

### NEXUS and tool loop

- ForgeMind constructs `AIMessage[]` in `App.tsx` and calls `sendViaRouter`.
- Native providers receive system prompt, history and tools through `providerRouter.ts`.
- NEXUS Browser WebGPU uses manual tool mode: schema injection, fenced tool-call parsing, dispatcher execution, then assistant tool-call plus tool-result messages are appended.
- Real GitHub operations execute through `executeTool` and the GitHub API.

### Reasoning, traces and activity

- `App.tsx` parses model `PLAN`, `STATUS`, `VERIFICATION`, `NEXT_ACTION` and thinking tags.
- It stores `thinking`, `trace`, `plan`, `agentPhase` and `reasoning` on assistant messages.
- It also builds an execution chain from tool calls and emits ForgeOps/activity events.
- The system prompt still requires verbose `OBJECTIVE`, `CONSTRAINTS`, `PLAN`, `EXECUTION`, `VERIFICATION`, `STATUS` and `NEXT_ACTION` sections.
- Activity and Guardian events are separate UI/runtime channels, but model narration is still parsed and stored.

### Cancellation

- There is no generation STOP control for model/tool execution.
- Provider requests have no `AbortSignal` in `AIRequest`.
- Streaming placeholders remain active until success/error; no stale-run guard exists.
- Voice STOP is unrelated to model-run cancellation.

## Root cause of the exact last-message error

The ForgeMind tool loop correctly models the conceptual sequence `user → assistant(tool call) → tool(result)`. However, the NEXUS Browser WebGPU adapter currently serializes every message as either `user` or `assistant`:

```ts
...bounded.messages.map(message => ({
  role: message.role as 'user' | 'assistant',
  content: message.content,
}))
```

A real `tool` result is therefore sent to WebLLM as an `assistant` message. On the next NEXUS request, the last message is `assistant`, which violates the WebLLM conversation contract and produces:

> `[ERROR]: Last message should be from either user or tool.`

The root fix is provider-boundary adaptation: preserve the canonical runtime message sequence, but serialize NEXUS tool results as a user-side tool-result continuation. Do not append synthetic user messages to the shared runtime transcript.

A second protocol hazard is the soft-review checkpoint in `App.tsx`, which appends an artificial user message during the model loop. It is not required for tool execution and must be removed from the provider conversation path.

## Implementation boundary

- Reuse `App.tsx` ForgeMind orchestration and `providerRouter.ts`; do not create a second runtime.
- Keep Guardian, real dispatcher/GitHub tools and NEXUS WebGPU intact.
- Add agent-scoped persistence and run ownership to the existing agent panel/runtime.
- Add AbortController support through the existing request/provider interfaces.
- Keep operational status in activity/UI state; remove artificial execution narration from model context.
- Browser/GitHub Pages acceptance is required separately from Node tests. If WebGPU cannot initialize in the available browser, report that as blocked rather than PASS.

**Contract:** v1.1, override by Cristian
**Co-authored-by:** Cristian <towerslutz@gmail.com>
