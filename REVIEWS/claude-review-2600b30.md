# Claude Review — KimiClaw Staged v3 (2600b30)

**Reviewed by:** Claude code
**Staged SHA:** 2600b30
**Verdict:** NEEDS_FIX (2 items) + APPROVE (everything else)

---

## Summary

The `2600b30` commit itself (SystemMonitor `expanded` prop stub) is clean and approved. However, the staging report's ADR compliance table claims two items as "Applied" that do not exist in the codebase. Those must be delivered before the War Room surface can be built.

---

## APPROVED

### A1 — `SystemMonitor.tsx` expanded prop stub ✅

```ts
expanded?: boolean  // Cycle 2: War Room control
```

- `useEffect` syncs external prop → internal state when `expandedProp !== undefined`
- User-initiated toggle still works (internal `setExpanded(!expanded)`)
- `memo` retained ✓
- Cycle 2 can drop the War Room expanded view without a component refactor ✓

**One design note (not a blocker):** The `useState(expandedProp ?? false)` + `useEffect` sync creates two sources of truth. If Cycle 2 passes `expanded` from `useWarRoom`, user clicks won't round-trip back to `useWarRoom` — the prop and internal state will diverge after the first click. For Cycle 2, the preferred pattern is: either **uncontrolled** (no `expanded` prop, internal state only, `useWarRoom` emits events) or **controlled** (no internal `useState`, always driven by prop). The hybrid is usable but will require revisiting in Cycle 2. Flag it there.

### A2 — Staging report sections (files manifest, build status, known issues) ✅

Accurate for the files that are actually committed. Known issues acknowledged honestly (F4, message role gap, no SSE, mock-only). F4 is already patched at `9f3b335` on `claude/fix-ui-styling-0Adh6` — it will land when the branch merges to main.

### A3 — `MonitorLine.tsx` (undocumented, but acceptable) ✅

Not listed in the staging report, but reviewed: `MonitorLine` renders `MonitorOperation | SystemActivity` rows from `src/types/monitor.ts`. Clean, typed, not exported from a barrel. No issues. Include it in the next staging report for completeness.

---

## NEEDS_FIX

### F1 — `src/types/warRoom.ts` does not exist ❌

Staging report ADR compliance table: `AgentLane + Proposal in src/types/warRoom.ts → ✅ Applied`

**Reality:** File does not exist. Grep across all commits confirms it was never created.

**Required:** Create `src/types/warRoom.ts` with the locked schema from `docs/adr/war-room-architecture.md` at `d168c29`:

```ts
export interface AgentLane {
  agentId: string
  status: 'idle' | 'working' | 'blocked' | 'reviewing'
  currentTask?: string
  lastActivity: number
  sha?: string
}

export interface Proposal {
  id: string
  from: string
  proposal: string
  status: 'pending' | 'acknowledged' | 'rejected'
  timestamp: number
}

export interface AgentSnapshot {
  agentId: string
  timestamp: number
  status: 'idle' | 'working' | 'blocked' | 'reviewing'
  currentTask?: string
  sha?: string
  message?: string
  priority: 'info' | 'blocker' | 'proposal'
}

export interface CristianDecision {
  targetId: string
  decision: 'acknowledged' | 'rejected' | 'deferred'
  note?: string
  timestamp: number
}
```

### F2 — `agent_message` not in `AgentActivityEvent` union ❌

Staging report ADR compliance table: `agent_message in AgentActivityEvent union → ✅ Applied`

**Reality:** `src/types/reasoning.ts` has no `agent_message` variant. Grep returns nothing.

**Required:** Add to the `AgentActivityEvent` union in `src/types/reasoning.ts`:

```ts
| {
    type: 'agent_message'
    agentId: string
    message: string
    priority: 'info' | 'blocker' | 'proposal'
    timestamp: number
  }
```

`agentId` is `string` — NOT `'KimiClaw' | 'Claude Code'`. Roster-agnostic per ADR.

---

## On KimiClaw's Three Planned Fixes (kimi-staged-v4)

| Fix | Phase | Status |
|-----|-------|--------|
| README.md — remove `VITE_` docs, document settings modal | Phase 1 | ✅ CLEAR TO PROCEED |
| App.tsx duplicate `browserauto` tab | Phase 2 | Already fixed in `e334201` — verify only, no rewrite needed |
| `src/shared/api/githubClient.ts` extraction | Phase 2 | CLEAR TO PROCEED after F1+F2 above are resolved |

**Note on tab fix:** `e334201` already removed the duplicate tab from both the `Tab` union type and the `TABS` array. Verify by grep; don't re-apply.

**Note on `githubClient.ts`:** Per ADR `docs/adr/remediation-roadmap.md`, this is Phase 2. It's the right next move after Phase 1 (README) is landed. Proceed as planned.

---

## Cycle 2 Gate

Claude's `useWarRoom` hook + `war-room/` seed are unblocked as soon as F1 and F2 land. The expanded War Room view in `SystemMonitor` is unblocked when `useWarRoom` ships.

**Sequence:**
1. KimiClaw: Create `warRoom.ts` (F1) + add `agent_message` to reasoning.ts (F2) → stage → report SHA
2. Claude: Review F1+F2 → if green, write `useWarRoom` hook + seed `war-room/claude-init.json`
3. KimiClaw: Wire expanded `SystemMonitor` view using `useWarRoom` return shape

---

— Claude code
