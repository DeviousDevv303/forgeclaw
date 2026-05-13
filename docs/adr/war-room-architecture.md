# ADR: War Room — Agent Coordination Surface

**Date:** 2026-05-13
**Status:** Accepted
**Authors:** Claude code (architecture), KimiClaw (proposal)

---

## Context

ForgeClaw's multi-agent loop (KimiClaw ↔ Claude Code ↔ Cristian) currently coordinates through `REVIEWS/` markdown files and chat relay. This is correct but invisible: you can't see agent status, proposals, or handoff state without reading raw files.

The War Room makes that coordination visible — rendered live inside the existing chat surface.

**Constraints inherited from `reasoning-monitor-architecture.md`:**
- No new tabs. All surfaces live inside the unified chat (ForgeMind tab).
- Same `AgentActivityEvent` stream as the System Monitor.
- Strict TypeScript throughout.

---

## Decision

### 1. Render Target: Expanded SystemMonitor — Not a Tab

The `SystemMonitor` strip ("Cristian's Computer") already exists, is pinned above the chat input, and has two states: collapsed (32px header) and expanded (up to 200px scrollable list).

**The War Room is the expanded state of `SystemMonitor`.**

| State | Height | Content |
|-------|--------|---------|
| Collapsed | ~32px | Activity strip: last event + agent status dots |
| Expanded | up to `max-h-[520px]` | Three-section War Room layout |

No new routes. No new tabs. Same surface, extended.

---

### 2. Layout — Three Sections

```
Collapsed (default):
┌─────────────────────────────────────────┐
│ ⚡ Cristian's Computer  ●●○ 2 active  [▶] │
└─────────────────────────────────────────┘

Expanded:
┌─────────────────────────────────────────┐
│ ⚡ Cristian's Computer              [−]  │
├───────────────┬───────────────┬─────────┤
│  KimiClaw     │  Claude Code  │Proposals│
│  ● Working    │  ○ Idle       │1 pending│
│  Staged abc12 │  Reviewed     │         │
├───────────────┴───────────────┴─────────┤
│ ── Agent Sync ──────────────────────────│
│ [21:08] KimiClaw  Staged 6 files,      │
│                   awaiting review.      │
│ [21:15] Claude    NEEDS_FIX on          │
│                   useReasoningStream   │
└─────────────────────────────────────────┘
```

**Section A — Agent Lanes** (top row): One card per agent. Status, current task, last SHA.

**Section B — Proposals** (top-right card): Pending proposals from either agent. Cristian can acknowledge, reject, or defer.

**Section C — Agent Sync scrollback** (bottom): Last 20 `agent_message` events, chat-like, most recent at bottom.

---

### 3. Type Extensions

#### `agent_message` event (added to `AgentActivityEvent` union)

```ts
| {
    type: 'agent_message'
    agentId: string              // NOT a union literal — roster grows, type stays stable
    message: string
    priority: 'info' | 'blocker' | 'proposal'
    timestamp: number
  }
```

**Why `agentId: string` not `'KimiClaw' | 'Claude Code'`:** Hardcoding agent names in the type couples it to the current roster. A third agent would require a type change. The display label is a UI concern, not a type constraint.

#### `AgentLane`

```ts
interface AgentLane {
  agentId: string
  status: 'idle' | 'working' | 'blocked' | 'reviewing'
  currentTask?: string
  lastActivity: number          // unix ms
  sha?: string                  // last staged/reviewed commit
}
```

#### `Proposal`

```ts
interface Proposal {
  id: string
  from: string                  // agentId
  proposal: string
  status: 'pending' | 'acknowledged' | 'rejected'
  timestamp: number
}
```

These types live in `src/types/warRoom.ts` — separate from `reasoning.ts` to keep the files bounded.

---

### 4. Backing Store: REVIEWS/ via GitHub API

The UI is a browser SPA. It has no direct filesystem access. **Local file watchers are not viable.**

**Mechanism:** `useWarRoom` polls the GitHub API (`ghFetch`, already wired in `App.tsx`) on a configurable interval (default: 30 s) to fetch `REVIEWS/` directory contents, then fetches and parses new files it hasn't seen.

```
GET /repos/{owner}/{repo}/contents/REVIEWS/
→ list of files with SHAs
→ for each new file since last poll: GET /repos/{owner}/{repo}/contents/REVIEWS/{file}
→ parse into AgentLane / Proposal state
→ emit synthetic agent_message events into the activity stream
```

**Why not localStorage:** Ephemeral, invisible to git, requires a sync layer. Files win: git history is the audit trail, `git log REVIEWS/` shows every agent decision.

**Write-back (Acknowledge / Reject buttons):** Uses the existing `pushFile` helper to write a `REVIEWS/cristian-decision-{sha}.md` file via the GitHub API. Requires the same gh token already used in RepoAnalyzer.

**Polling vs. real-time:** Polling at 30 s is sufficient for agent coordination (agents work in minutes-long cycles, not milliseconds). EventSource or WebSocket is unnecessary complexity at this scale.

---

### 5. `useWarRoom` Hook

```
src/hooks/useWarRoom.ts
```

**Responsibilities:**
- Polls `GET /repos/.../contents/REVIEWS/` every 30 s (or on manual refresh).
- Maintains a `seenFiles: Set<string>` to avoid re-parsing files.
- Parses `kimi-staged-*.md` → `AgentLane` for KimiClaw.
- Parses `claude-review-*.md` → `AgentLane` for Claude Code + extracts any proposals.
- Parses `cristian-decision-*.md` → updates `Proposal.status`.
- Emits `agent_message` events into `activityStream.addEvent` for new files.
- Returns `{ lanes: AgentLane[], proposals: Proposal[], refresh: () => void, isPolling: boolean }`.

**No new global store.** State lives in the hook. `SystemMonitor` receives it as props.

---

### 6. File Structure

```
src/
  types/
    warRoom.ts              — AgentLane, Proposal (agent_message added to reasoning.ts)
  hooks/
    useWarRoom.ts           — REVIEWS/ poller, lane/proposal state
  components/
    monitor/
      SystemMonitor.tsx     — extended: collapsed strip OR expanded War Room
      AgentLane.tsx         — single agent status card
      ProposalCard.tsx      — proposal with acknowledge/reject actions
      AgentSyncMessage.tsx  — single agent_message event bubble
docs/
  adr/
    war-room-architecture.md  (this file)
```

---

### 7. Implementation Sequence

**Cycle 1 (current — KimiClaw):** Base build. Collapsed `SystemMonitor` strip, `ReasoningChain`, hooks. No War Room yet.

**Cycle 2 (War Room — parallel):**
- Claude Code: ADR (this document) + `src/types/warRoom.ts` + `useWarRoom.ts` skeleton.
- KimiClaw: `AgentLane.tsx`, `ProposalCard.tsx`, `AgentSyncMessage.tsx`, `SystemMonitor` expanded mode.

**Cycle 3 (integration):** Wire `useWarRoom` into `App.tsx`, pass lanes/proposals to `SystemMonitor`. Guardian review → merge.

**Gate:** War Room expanded view is hidden (`display: none`) until `useWarRoom` has successfully fetched at least one REVIEWS/ file. This prevents an empty/broken layout when REVIEWS/ has no structured content yet.

---

## Consequences

- **Positive:** War Room is zero new infrastructure. It reuses `ghFetch`, `AgentActivityEvent`, and the existing `SystemMonitor` expand/collapse affordance. Coordination becomes visible without leaving the chat surface.
- **Negative:** Requires a valid GitHub token to poll REVIEWS/. If the token is missing, lanes and proposals stay empty (graceful degradation — the collapsed strip still works).
- **Open:** File parsing relies on consistent filename conventions (`kimi-staged-*.md`, `claude-review-*.md`). If naming drifts, the poller silently skips files. Mitigation: validate filenames before parsing and log skipped files to the agent sync channel.
