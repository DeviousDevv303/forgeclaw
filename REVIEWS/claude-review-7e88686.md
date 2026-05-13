# Claude Review — KimiClaw Staged v4 (7e88686)

**Reviewed by:** Claude code
**Staged SHA:** 7e88686
**Verdict:** APPROVED with notes (2 field divergences in `CristianDecision` — not Cycle 2 gate)

---

## Summary

Both NEEDS_FIX items from `claude-review-2600b30.md` are now delivered. F1 (`warRoom.ts`) and F2 (`agent_message`) are in the codebase. The main contract is met. Two minor field renames in `CristianDecision` diverge from the locked ADR — they do not block Cycle 2, but must be reconciled before Phase 3 tests land.

---

## APPROVED

### F2 — `agent_message` in `AgentActivityEvent` ✅

```ts
| { type: 'agent_message'; agentId: string; message: string; priority: 'info' | 'blocker' | 'proposal'; timestamp: number }
```

Exact match to ADR spec at `d168c29`. `agentId: string` (not a literal union) ✓. Priority type correct ✓. `timestamp: number` ✓.

### F1 — `AgentLane` ✅

```ts
export interface AgentLane {
  agentId: string
  status: 'idle' | 'working' | 'blocked' | 'reviewing'
  currentTask?: string
  lastActivity: number
  sha?: string
}
```

Exact match. Inline comments (`// unix ms`, `// last staged/reviewed commit`) are additive, not divergent.

### F1 — `Proposal` ✅

```ts
export interface Proposal {
  id: string
  from: string
  proposal: string
  status: 'pending' | 'acknowledged' | 'rejected'
  timestamp: number
}
```

Exact match.

### F1 — `AgentSnapshot` (with note) ✅

`status: AgentLane['status']` — DRY alias for the same union. Acceptable.

**Note (not a blocker):** `priority?` is optional in KimiClaw's version; ADR spec has it required. The optional form is a safe superset — `useWarRoom` will guard for `priority ?? 'info'` when deriving proposals. Resolve to required before Phase 3 if possible.

---

## NEEDS_FIX (Phase 3 gate, not Cycle 2 gate)

### `CristianDecision` — two field renames ⚠️

**KimiClaw's version:**
```ts
export interface CristianDecision {
  proposalId: string
  decision: 'acknowledged' | 'rejected' | 'deferred'
  reason?: string
  timestamp: number
}
```

**ADR canonical (`d168c29`):**
```ts
interface CristianDecision {
  targetId: string    // filename (without .json) of snapshot being responded to
  decision: 'acknowledged' | 'rejected' | 'deferred'
  note?: string
  timestamp: number
}
```

| Field | ADR | KimiClaw | Impact |
|-------|-----|----------|--------|
| `targetId` → `proposalId` | filename reference | implies Proposal.id | semantic mismatch |
| `note` → `reason` | — | — | cosmetic |

`targetId` per ADR is the backing filename (`claude-1715643000000` without `.json`) — it's a file pointer, not a Proposal ID. Renaming to `proposalId` implies it references `Proposal.id`, which is a different concept. When `useWarRoom` reads `cristian-decision-*.json` and tries to match `targetId` to a snapshot file, the field name matters.

**Resolution:** KimiClaw should rename `proposalId → targetId` and `reason → note` in `warRoom.ts` before Phase 3. For Cycle 2, I'll implement `useWarRoom` using the ADR field names (`targetId`, `note`) so my code is consistent with the ADR — KimiClaw's fix will bring the type file back into alignment.

---

## Phase 1 / Phase 2 Gate

| Work Item | Status |
|-----------|--------|
| README — remove `VITE_` docs, document settings modal | ✅ CLEAR TO PROCEED |
| App.tsx duplicate `browserauto` tab | ✅ Already fixed at `e334201` — verify only |
| `src/shared/api/githubClient.ts` extraction | ✅ CLEAR TO PROCEED (after Phase 1) |

---

## Cycle 2 Gate — OPEN

Both type files now exist. `useWarRoom` is unblocked.

**Sequence:**
1. Claude: write `src/hooks/useWarRoom.ts` (ADR field names: `targetId`, `note`) + seed `war-room/claude-init.json`
2. KimiClaw: build `AgentLane.tsx`, `ProposalCard.tsx`, `AgentSyncMessage.tsx`, `SystemMonitor` expanded mode
3. Wire `useWarRoom` into `App.tsx`, pass `lanes`/`proposals` to `SystemMonitor`

---

— Claude code
