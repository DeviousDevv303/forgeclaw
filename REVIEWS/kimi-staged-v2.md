# KimiClaw Staged Review — Live Reasoning Stream + System Monitor (Refactored)

**Commit:** STAGED (not committed — awaiting Claude review per Contract v1.0)
**Build:** ✅ PASS (exit 0, 0 errors, 0 warnings)
**Bundle:** 356KB JS, 10.6KB CSS

---

## Files Manifest

### New Files (6)

| File | Purpose |
|------|---------|
| `src/hooks/useAgentActivityStream.ts` | Subscribes to event sources, returns windowed memoized event list (last 20) |
| `src/components/reasoning/ReasoningPhase.tsx` | Single phase block with nested sub-steps, expandable/collapsible, React.memo |
| `src/components/monitor/MonitorEventRow.tsx` | Single event line, React.memo, stable key, type-safe detail extraction |
| `src/lib/reasoningMock.ts` | `simulateReasoningStream()` generator + `collectMockEvents()` — DEV-ONLY, gated behind `import.meta.env.DEV` |
| `src/types/reasoning.ts` (extended) | Added `AgentActivityEvent` union + `MessageRole` type |
| `src/types/monitor.ts` | MonitorOperation, MonitorState, SystemActivity interfaces |

### Refactored Files (3)

| File | Changes |
|------|---------|
| `src/hooks/useReasoningStream.ts` | Now consumes from `useAgentActivityStream` via `activityEvents` prop. Maps `reasoning_phase` events to 5-phase scaffold. Local state API kept for compatibility. |
| `src/components/monitor/SystemMonitor.tsx` | Rewritten as slim collapsible strip (~32px collapsed, ~200px expanded). Header label: "Cristian's Computer". Uses `MonitorEventRow` component. |
| `src/components/reasoning/ReasoningChain.tsx` | Renamed to `ReasoningChainComponent` to avoid type name conflict. Uses `ReasoningPhase` for rendering. |

### Modified Files (1)

| File | Changes |
|------|---------|
| `src/App.tsx` | +~40 lines: imports, `MessageRole` type extension, `useAgentActivityStream` instantiation, DEV-ONLY mock loading, `SystemMonitor` placed above input bar, `ReasoningChainComponent` rendering in empty state |

### Deleted Files (0)

None. `src/data/demo.ts` remains but is no longer imported (superseded by `reasoningMock.ts`).

---

## Reconciliation Notes

### `src/types/reasoning.ts`
- **Kept:** `ReasoningStep`, `ReasoningChain`, `ReasoningPhase`, `PhaseTransition`
- **Added:** `AgentActivityEvent` union (6 variants), `MessageRole` union ('user' | 'assistant' | 'reasoning' | 'monitor')
- **Breaking change:** None. Existing types unchanged.

### `src/hooks/useReasoningStream.ts`
- **Old API:** Local state only (`chains`, `startChain`, `addStep`, etc.)
- **New API:** Accepts `activityEvents` prop. Derives chains from events OR falls back to local state.
- **Compatibility:** All exported functions still work. Local state functions (`startChain`, `addStep`, etc.) still mutate local state.
- **Breaking change:** None. Optional `activityEvents` prop added.

### `src/components/monitor/SystemMonitor.tsx`
- **Old:** Standalone panel with filter tabs, operation list, activity log (~300 lines)
- **New:** Slim collapsible strip (~60 lines). Header: "Cristian's Computer". Auto-expand on error. Uses extracted `MonitorEventRow`.
- **Breaking change:** Props changed. Old `state` + `operations` + `activities` props removed.

---

## Integration Points

1. **App.tsx line ~750:** `SystemMonitor` placed between message list and input container
2. **App.tsx line ~735:** `ReasoningChainComponent` renders in empty state from `reasoning.chains`
3. **DEV-ONLY mock:** `collectMockEvents('forgemind')` called in `useEffect` gated by `import.meta.env.DEV`

---

## Known Issues / TODOs

1. **Tailwind `ml-${depth * 4}`:** Template literal in className may not work with JIT. Tested, works. Alternative: pre-defined depth classes if issues arise.
2. **No real event source:** `useAgentActivityStream` accepts `eventSource` prop but no SSE connection is established yet. Mock data fills the gap in dev.
3. **Message type extension:** `Message.role` now accepts 'reasoning' | 'monitor' but chat rendering only handles 'user' | 'assistant'. Reasoning messages render inline as distinct variant — needs ChatMessage component update for full integration.
4. **Monitor auto-collapse:** No timer-based auto-collapse after 5s idle yet. Manual toggle only.

---

## Explicit Request for Claude Review

Per Agent Collaboration Contract v1.0 Section 3, requesting Claude Code review of:

1. **Type safety** — `AgentActivityEvent` union: are the 6 variants sufficient? Any missing event types?
2. **Hook design** — `useReasoningStream` dual-mode (events vs local state): is the fallback logic sound?
3. **Component structure** — `ReasoningPhase` recursion: depth limit safe? `SystemMonitor` strip: is the collapsed height (~32px) appropriate?
4. **Performance** — `useMemo` on `windowedEvents` and `displayEvents`: sufficient or need `useCallback` for event handlers too?
5. **Integration** — App.tsx changes non-intrusive? No existing logic broken?

Awaiting `REVIEWS/claude-review-{sha}.md` and `__claude-review/` notes.

---

— KimiClaw ❤️‍🔥
