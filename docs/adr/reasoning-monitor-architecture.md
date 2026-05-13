# ADR: Live Reasoning Stream & System Monitor Architecture

**Date:** 2026-05-13
**Status:** Accepted
**Authors:** Claude code

---

## Context

ForgeClaw required two new surfaces in the unified chat (ForgeMind tab):

1. **Live reasoning stream** — a visible, collapsible rendering of the 5-phase cognitive scaffold (Assumptions → Heuristics → First Principles → Extension → Convergence), with nested sub-steps and tool call blocks, inspired by streaming chain-of-thought UIs.
2. **System Monitor** — a condensed, always-visible panel showing real-time orchestrator activity, pinned above the chat input bar.

Constraints:
- Must live within the existing chat surface; no new tabs.
- Strict TypeScript throughout (`strict: true`, `noUnusedLocals`, `noUnusedParameters`).
- No mutation of auth, API key, or autonomy engine code.
- No breaking changes to persisted `localStorage` message history.

---

## Decisions

### 1. State Management: No new store

**Options considered:** React Context, Zustand, local hook state.

**Decision:** Neither. The existing state surfaces are sufficient.

- **Reasoning data** lives on the `Message` object as a new optional field `reasoning?: ReasoningData`. This is per-message data — it belongs with the message, not in a global store. Lifting it to Zustand or Context would gain nothing today and introduce a GC problem (stale reasoning state for old messages).
- **Monitor data** is already owned by `useOrchestrator`, which functions as a hook-shaped store. Promoting it to Zustand is busywork: it doesn't enable multi-mount, doesn't improve perf at current scale, and adds a migration surface.

**Adopt Zustand** only when SystemMonitor needs to mount in multiple parallel subtrees, or when profiling reveals render cost from the hook.

### 2. Reasoning field: New `reasoning` field alongside existing `phases`

**Options considered:** Extend `Message.phases` in place, or add a new `Message.reasoning` field.

**Decision:** New `reasoning?: ReasoningData` field.

`phases` (type `Record<string, string>`) and `reasoning` (type `ReasoningData` with nested phases, steps, tool calls, and streaming status) are different data shapes representing different concerns:
- `phases` = high-level cognitive scaffold text, batch-rendered, already parsed from model output.
- `reasoning` = live execution trace with per-step status, timestamps, and tool invocations.

Conflating them into one field would create a union type with two incompatible shapes, breaking existing messages persisted in `localStorage` and requiring a migration script. The new field has zero migration cost.

`phases` is retained as-is for backward compatibility and continues to render via the existing toggle UI.

### 3. SystemMonitor: Reuses `useOrchestrator` event bus

**Decision:** `SystemMonitor` receives `events: OrchestratorEvent[]` from the existing `useOrchestrator` hook in `App`, passed as a prop. It renders a windowed slice (`events.slice(0, 20)`) memoized via `useMemo`.

**Rejected alternative:** A parallel monitor with its own internal event stream. That would create two sources of truth for orchestrator activity and diverge from the canonical event bus that Guardian rules emit to.

**ADR principle:** All agent activity surfaces consume from the canonical orchestrator event bus. Mock generators are development utilities only.

### 4. Component integration point

**ReasoningChain** renders as an inline block *above* the message bubble for each assistant message that has `msg.reasoning` set. It is collapsible (collapses by default when `status === 'complete'`, expands when `status === 'streaming'`). It replaces no existing UI — the `phases` toggle remains for backward-compatible messages.

**SystemMonitor** renders as a slim strip inside the sticky bottom bar of the ForgeMind tab, above the input row. It is always visible during chat (when events exist), collapsible by the user. This placement keeps agent activity visible without disrupting the reading flow.

### 5. Performance

- `ReasoningChain` is `React.memo`'d with a custom comparator: re-renders only when `messageId` or `reasoning.version` changes. This contains streaming updates to one message without re-rendering sibling messages.
- `ReasoningPhase` and `ReasoningStep` are `React.memo`'d on default props equality.
- `MonitorEventRow` is `React.memo`'d on default props equality.
- `SystemMonitor` computes `windowed` via `useMemo` keyed on the `events` reference.

### 6. Mock data

`src/lib/reasoningMock.ts` exports `buildMockReasoning(): ReasoningData`, which constructs a complete 5-phase scaffold with nested steps and tool calls. It throws at runtime if called outside `import.meta.env.DEV`. It is invoked only via the DEV-only **DEMO** button in the header, which is absent from production builds.

---

## File structure

```
src/
  components/
    reasoning/
      types.ts              — ReasoningData, ReasoningPhase, ReasoningStep, ToolCall, PHASE_NAMES, PHASE_ICONS
      ReasoningChain.tsx    — container (memo'd on id + version)
      ReasoningPhase.tsx    — single phase block, expand/collapse
      ReasoningStep.tsx     — nested step with streaming cursor
      ToolCallBlock.tsx     — tool invocation card with args/result expansion
    monitor/
      MonitorEventRow.tsx   — single event row (memo'd)
      SystemMonitor.tsx     — windowed strip, pinned above input
  lib/
    reasoningMock.ts        — DEV-only 5-phase mock generator
docs/
  adr/
    reasoning-monitor-architecture.md  (this file)
```

---

## Consequences

- **Positive:** Zero breaking changes to existing message history. `phases` backward-compat preserved. No new global state surface. Architecture ready for real streaming: wire `ReasoningData` mutations into the Claude API response parser when the token-streaming backend is ready.
- **Negative:** `Message` interface grows a new optional field. If `reasoning` is included in `localStorage` serialization for large sessions, message history size increases. Mitigation: strip `reasoning` before persisting (future optimization, not required now).
- **Open question:** Whether `phases` should be deprecated and fully replaced by `reasoning` once all messages are produced by a streaming-aware backend. Until then, both coexist.
