# ADR: Live Reasoning Stream & System Monitor Architecture

**Date:** 2026-05-13
**Updated:** 2026-05-13
**Status:** Accepted
**Authors:** Claude code

---

## Context

ForgeClaw required two new surfaces in the unified chat (ForgeMind tab):

1. **Live reasoning stream** — a visible, collapsible rendering of the 5-phase cognitive scaffold (Assumptions → Heuristics → First Principles → Extension → Convergence), with nested sub-steps and tool call blocks, inspired by streaming chain-of-thought UIs.
2. **System Monitor** — a condensed, always-visible panel showing real-time agent activity, pinned above the chat input bar.

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

---

### 2. Placement

#### SystemMonitor

- Rendered as a slim collapsible strip **pinned directly above the chat input bar** inside the sticky bottom container of the ForgeMind tab.
- **Collapsed height:** `~32px` (header row only — event count + toggle chevron).
- **Expanded height:** `~200px` (scrollable event list, `max-height: 200px; overflow-y: auto`).
- **Auto-expand:** triggers when a new `AgentActivityEvent` arrives with `type === 'agent_status'` and `status === 'working'`, or `type === 'error'`.
- **Auto-collapse:** triggers 5 s after the last event if no new events arrive (idle timeout via `useEffect` + `clearTimeout` cleanup).
- User-initiated collapse/expand always wins over auto-behaviour until the next auto-trigger.

#### ReasoningChain

- Rendered **inline inside the unified chat message flow** as a first-class message variant — `role === 'reasoning'` — not above an assistant bubble.
- When the message stream receives a `reasoning` role message, `<ReasoningChain>` is rendered directly in place of the standard bubble.
- Collapses to a compact summary row (`status === 'complete'`). Expands and streams live during `status === 'streaming'`.

---

### 3. Data Model

#### MessageRole extension

```ts
type MessageRole = 'user' | 'assistant' | 'reasoning' | 'monitor'
```

| Role | Rendered as | Notes |
|---|---|---|
| `user` | Orange right-aligned bubble | Existing |
| `assistant` | Dark left-aligned bubble | Existing |
| `reasoning` | `<ReasoningChain>` inline | New — live execution trace |
| `monitor` | Reserved | Future inline monitor snapshots |

#### Message interface addition

```ts
interface Message {
  // ... existing fields unchanged ...
  reasoning?: ReasoningData   // new — rich execution trace
  // phases?: Record<string,string> — legacy, untouched
}
```

`Message.phases` is retained as-is for backward compatibility. Existing persisted messages are unaffected.

#### Data source

`SystemMonitor` consumes `AgentActivityEvent[]` (see Type Schema below), not raw `OrchestratorEvent[]`. The orchestrator adapter maps `OrchestratorEvent` → `AgentActivityEvent` at the boundary.

`reasoningMock.ts` is **DEV-only**, gated behind `import.meta.env.DEV`. It throws at runtime in production. It must never be the default data source.

---

### 4. Attribution

- Signature line appended to every commit message body and PR description. Last line of body only.
- Format: `— {agentName}`
- KimiClaw: `— KimiClaw ❤️‍🔥`
- Claude Code: `— Claude code`
- **No GPG signing.** Attribution is human-readable provenance, not cryptographic. GPG adds key management overhead (rotation, CI secrets, agent passphrase handling) that solves no current problem at this scale.

---

### 5. Performance

- `ReasoningChain` is `React.memo`'d with a **custom comparator**: re-renders only when `messageId` or `reasoning.version` changes. Streaming updates increment `version` on the single active message; stable `msg.id` keys prevent sibling messages from re-rendering.
- `ReasoningPhase` and `ReasoningStep` are `React.memo`'d on default props equality.
- `MonitorEventRow` is `React.memo`'d on default props equality with `now` as a stable snapshot (not `Date.now()` inline).
- `SystemMonitor` computes `windowed` via `useMemo` keyed on the `events` reference.

**Windowed slice direction:** `useOrchestrator` **prepends** events (`setEvents(prev => [event, ...prev])`), so index 0 is always the most recent event. The correct windowed slice is `events.slice(0, 20)`, which yields the 20 most recent events. `events.slice(-20)` would yield the 20 *oldest* — this is a spec error in the original brief and is corrected here.

---

### 6. Mock data

`src/lib/reasoningMock.ts` exports `buildMockReasoning(): ReasoningData`, which constructs a complete 5-phase scaffold with nested steps and tool calls. It throws at runtime if called outside `import.meta.env.DEV`. It is invoked only via the DEV-only **DEMO** button in the header, which is absent from production builds.

---

## Type Schema

### `AgentActivityEvent`

Discriminated union consumed by `SystemMonitor`. Replaces raw `OrchestratorEvent` at the UI boundary. An adapter maps `OrchestratorEvent → AgentActivityEvent` so the monitor surface is decoupled from internal orchestrator types.

```ts
type AgentActivityEvent =
  | {
      type: 'tool_call'
      agentId: string
      tool: string
      args: unknown
      timestamp: number
      durationMs?: number
    }
  | {
      type: 'file_read' | 'file_write'
      agentId: string
      path: string
      timestamp: number
    }
  | {
      type: 'reasoning_phase'
      agentId: string
      phase: 'assumptions' | 'heuristics' | 'first_principles' | 'extension' | 'convergence'
      body: string
      timestamp: number
    }
  | {
      type: 'agent_status'
      agentId: string
      status: 'idle' | 'working' | 'error'
      timestamp: number
    }
  | {
      type: 'error'
      agentId: string
      message: string
      timestamp: number
    }
```

### `ReasoningStep`

Recursive tree node. Replaces the flat `ReasoningStep` in `src/components/reasoning/types.ts` (KimiClaw owns the implementation update).

```ts
type ReasoningStep = {
  id: string
  icon: '🔍' | '⚙️' | '✅' | '❌'
  label: string
  status: 'active' | 'done' | 'error'
  timestamp: number
  durationMs?: number
  children?: ReasoningStep[]
  body?: string
}
```

Icon semantics:
| Icon | Meaning |
|---|---|
| 🔍 | Observation / lookup |
| ⚙️ | Tool call / computation |
| ✅ | Step complete |
| ❌ | Step failed / error |

---

## File structure

```
src/
  components/
    reasoning/
      types.ts              — ReasoningData, ReasoningPhase, ReasoningStep (recursive), ToolCall, PHASE_NAMES, PHASE_ICONS
      ReasoningChain.tsx    — container (memo'd on id + version); renders as role='reasoning' message
      ReasoningPhase.tsx    — single phase block, expand/collapse
      ReasoningStep.tsx     — recursive step node with streaming cursor
      ToolCallBlock.tsx     — tool invocation card with args/result expansion
    monitor/
      MonitorEventRow.tsx   — single AgentActivityEvent row (memo'd)
      SystemMonitor.tsx     — windowed strip (slice(0,20)), pinned above input, auto-expand/collapse
  lib/
    reasoningMock.ts        — DEV-only 5-phase mock generator (throws in prod)
docs/
  adr/
    agent-collaboration-contract.md
    reasoning-monitor-architecture.md  (this file)
```

---

## Consequences

- **Positive:** Zero breaking changes to existing message history. `phases` backward-compat preserved. No new global state surface. `MessageRole` extension is additive — old messages without a role field gracefully fall back to existing render paths. Architecture ready for real streaming: wire `ReasoningData` mutations into the Claude API response parser when the token-streaming backend is ready.
- **Negative:** `Message` interface grows a new optional field and `MessageRole` grows two new variants. If `reasoning` is serialised to `localStorage` for large sessions, history size increases. Mitigation: strip `reasoning` before persisting (future optimisation, not required now).
- **Open question:** Whether `phases` should be deprecated and fully replaced by `reasoning` once all messages are produced by a streaming-aware backend. Until then, both coexist.
- **Implementation note for KimiClaw:** `src/components/reasoning/types.ts` needs to be updated to the recursive `ReasoningStep` shape defined above. The existing flat shape is superseded.
