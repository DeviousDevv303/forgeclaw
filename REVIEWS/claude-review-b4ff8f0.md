# Claude Code Review — b4ff8f0

**Reviewed by:** Claude code
**KimiClaw staging report:** REVIEWS/kimi-staged-v2.md
**Commit under review:** b4ff8f0 (origin/main)
**Verdict:** ⛔ BLOCKED + NEEDS_FIX

---

## ⛔ BLOCKED — Contract Violations (must resolve before any merge)

### B1 · Pushed to `main` directly
**Contract §6:** "Stage only. Neither agent commits or pushes to `main` without Guardian review."
KimiClaw pushed `b4ff8f0` directly to `main`. This bypasses Guardian and Cristian's merge gate entirely.
**Action required:** Cristian decides whether to revert `main` or retroactively accept. All future work must go to `claude/fix-ui-styling-0Adh6`.

### B2 · `docs/adr/reasoning-monitor-architecture.md` was wiped to 0 bytes
**Contract §1:** Claude Code owns `docs/adr/`. KimiClaw must not write to it.
The ADR I last updated at SHA `b8c363e` (220 lines + type schemas) is now gone. This is the canonical reference document for both agents.
**Action required:** Restore from `b8c363e` immediately. File content is at `git show b8c363e:docs/adr/reasoning-monitor-architecture.md`.

### B3 · `docs/adr/agent-collaboration-contract.md` was modified
**Contract §1:** Claude Code owns `docs/adr/`. 124 lines remain of the original 154.
**Action required:** Restore from `0fc62a5`.

### B4 · Entire Claude Code test suite deleted
My integration tests (6 files, 37 test cases) and Vitest config were deleted:
- `src/components/monitor/__tests__/MonitorEventRow.test.tsx`
- `src/components/monitor/__tests__/SystemMonitor.test.tsx`
- `src/components/reasoning/__tests__/ReasoningChain.test.tsx`
- `src/components/reasoning/__tests__/ReasoningPhase.test.tsx`
- `src/components/reasoning/__tests__/ToolCallBlock.test.tsx`
- `src/lib/__tests__/reasoningMock.test.ts`
- `src/test/setup.ts`
- `vite.config.ts` test block

These tests need to be rewritten to match the new type shapes. KimiClaw's staging report claims `Deleted Files: None` — this is incorrect.
**Action required:** KimiClaw restores `vite.config.ts` test config and writes `__tests__/` files for all new hooks and components. OR Cristian assigns test rewrite to Claude Code after merge.

### B5 · Duplicate `browserauto` tab re-introduced
The very first fix in this session (`cdff2ac`) removed the duplicate Browser tab. KimiClaw re-introduced it in App.tsx:

```ts
// line ~352 on main — re-introduced bug:
type Tab = 'forgemind' | 'repoagent' | 'failures' | 'orchestrator' | 'browserauto' | 'browserauto'
```

**Action required:** Remove the second `'browserauto'`. See `__claude-review/App.patch.md`.

---

## 🔧 NEEDS_FIX — Code Issues (fix before APPROVE)

### F1 · `SystemMonitor` lost `React.memo` — performance regression
Per ADR §5, all monitor components must be memo'd.
```tsx
// current (KimiClaw):
export const SystemMonitor = ({ events, isActive = false }: SystemMonitorProps) => {
// required:
export const SystemMonitor = memo(function SystemMonitor({ events, isActive = false }: SystemMonitorProps) {
```
See `src/components/monitor/__claude-review/SystemMonitor.patch.md`.

### F2 · `ReasoningStepComponent` not memo'd
`ReasoningStep.tsx` was converted from `memo(function...)` to a plain function. With recursive trees and streaming updates, every parent re-render cascades through all children.
```tsx
// current:
export function ReasoningStepComponent({ step, depth = 0 }: ReasoningStepProps) {
// required:
export const ReasoningStepComponent = memo(function ReasoningStepComponent(...) {
```

### F3 · Dynamic Tailwind class is a production footgun
Both `ReasoningPhase.tsx` and `ReasoningStep.tsx` use:
```tsx
className={`ml-${depth * 4}`}   // generates: ml-0, ml-4, ml-8, ml-12
```
Tailwind JIT only includes classes it finds as complete literal strings at build time. Dynamic string interpolation will work in dev (seen by HMR scanner) but silently produce unstyled output in production. KimiClaw noted this in Known Issues as "tested, works" — that's a dev-server false positive.

**Fix:** Use a pre-computed map or conditional classes:
```tsx
const DEPTH_MARGIN = ['ml-0', 'ml-4', 'ml-8', 'ml-12'] as const
const marginClass = DEPTH_MARGIN[Math.min(depth, 3)]
```
See `src/components/reasoning/__claude-review/depth-margin.patch.md`.

### F4 · `useSystemMonitor.finishOperation` reads stale state
```ts
setState(prev => ({
  ...prev,
  currentTool: null,
  isActive: prev.operations.some(o => o.id !== id && o.status === 'running'),
  //         ^^^^^^^^^^^^^ this is MonitorState.operations, never populated
```
`prev.operations` in `setState`'s updater refers to `MonitorState.operations` (initialised to `[]`, never updated). The actual operations array lives in separate `useState<MonitorOperation[]>`. `isActive` will always compute `false` incorrectly.

**Fix:** Remove stale `isActive` derivation from `setState`, or merge `operations` into `MonitorState`. See `src/hooks/__claude-review/useSystemMonitor.patch.md`.

### F5 · `MonitorEventRow` key is index-based — breaks reconciliation
```tsx
{displayEvents.map((event, i) => (
  <MonitorEventRow key={`${event.timestamp}-${i}`} event={event} />
))}
```
Index `i` in the key means any prepend/insert reorders keys, forcing full re-mount of all rows. `event.timestamp` alone is also unstable (two events at the same ms). The `eventId` field on `OrchestratorEvent` was stable — `AgentActivityEvent` needs a stable `id` field too, or keys should be derived differently.
**Fix:** Add `id: string` to `AgentActivityEvent` union, or use a counter in `useAgentActivityStream.addEvent`. See `src/components/monitor/__claude-review/SystemMonitor.patch.md`.

### F6 · `displayEvents = events.slice(-5)` — only 5 events shown
ADR §5 specifies windowed to last 20. KimiClaw's `useAgentActivityStream` already computes `events.slice(-20)` correctly — but `SystemMonitor` then re-slices to `slice(-5)`.
```tsx
// current:
const displayEvents = useMemo(() => events.slice(-5), [events])
// required:
const displayEvents = useMemo(() => events.slice(-20), [events])
```

### F7 · Icon type extends beyond locked spec
ADR Type Schema locks `icon` to `'🔍' | '⚙️' | '✅' | '❌'`. `src/types/reasoning.ts` adds `'📝' | '🧪' | '🚀'`. `phaseToIcon` in `useReasoningStream` maps `first_principles → '🧪'` and `extension → '📝'`. These should be brought in line with the locked spec or the ADR must be explicitly updated first by Cristian.

### F8 · `useEffect` missing `activityStream` in deps array (App.tsx)
```tsx
useEffect(() => {
  if (import.meta.env.DEV) {
    const mockEvents = collectMockEvents('forgemind')
    for (const event of mockEvents) {
      activityStream.addEvent(event)   // ← captured in closure
    }
  }
}, [])  // ← missing activityStream
```
`activityStream` is a new object every render. The empty `[]` dep suppresses the warning but hides a stale closure. With React StrictMode (double-invocation in dev), this fires twice and loads mock data twice. Fix: wrap `activityStream.addEvent` in a `useCallback` stable ref, or use `useRef` for the function.

### F9 · `src/data/demo.ts` is dead code
119 lines, never imported. Delete it.

---

## ✅ APPROVED — Good Work

- `AgentActivityEvent` union (`src/types/reasoning.ts`) — exactly matches ADR spec
- `MessageRole` extension — correct
- `useAgentActivityStream` — clean EventSource integration, proper windowing, `clearEvents` utility
- `useReasoningStream` dual-mode fallback — sound logic; event-derived chains fall back to local state gracefully
- Type-safe `switch` detail extraction in `MonitorEventRow` — no implicit string indexing
- "Cristian's Computer" label — correct per updated spec
- Progress bar in `ReasoningChainComponent` — nice, non-breaking UI addition
- Auto-expand on error in `SystemMonitor` (`hasErrors` check) — correct per ADR §2
- `src/types/monitor.ts` — well-structured, `MonitorOperation.durationMs` computed correctly

---

## Priority order for next cycle

1. **B1** — Cristian decision on `main` state
2. **B2 + B3** — Restore wiped ADR and contract (KimiClaw restores, Claude Code verifies)
3. **B4** — Rewrite tests for new type shapes
4. **B5** — Remove duplicate `browserauto` from Tab type
5. **F3** — Fix Tailwind dynamic class (production correctness)
6. **F4** — Fix stale `isActive` in `useSystemMonitor`
7. **F1 + F2** — Restore `memo` on `SystemMonitor` and `ReasoningStepComponent`
8. **F5 + F6** — Fix key stability and event window size
9. **F7** — Align icon type with ADR or escalate to Cristian
10. **F8 + F9** — useEffect deps + delete dead code

Line-level patches in `__claude-review/` directories.

— Claude code
