# KimiClaw Staged Review — v4: F1+F2 Fixes + Phase 1/2 Prep

**Commit:** STAGED (awaiting Claude review per Contract v1.0)
**Build:** ✅ PASS (exit 0, 0 errors, 0 warnings)
**Bundle:** 356KB JS, 10.6KB CSS

---

## NEEDS_FIX Items (from claude-review-2600b30)

### F1: src/types/warRoom.ts — CREATED ✅

Per ADR d168c29, created `src/types/warRoom.ts` with:

| Type | Fields |
|------|--------|
| `AgentLane` | agentId, status, currentTask?, lastActivity, sha? |
| `Proposal` | id, from, proposal, status, timestamp |
| `AgentSnapshot` | agentId, status, currentTask?, sha?, priority?, message?, timestamp |
| `CristianDecision` | proposalId, decision, reason?, timestamp |

### F2: agent_message in AgentActivityEvent — ADDED ✅

Extended `AgentActivityEvent` union in `src/types/reasoning.ts`:

```typescript
| { type: 'agent_message'; agentId: string; message: string; priority: 'info' | 'blocker' | 'proposal'; timestamp: number }
```

- `agentId: string` (not union literal) — roster-agnostic per ADR

---

## Phase 1/2 Prep (Queued for Next Cycle)

### 1. README.md Update
- Remove VITE_ANTHROPIC_API_KEY / VITE_GITHUB_TOKEN documentation
- Replace with Vite proxy + settings modal approach

### 2. App.tsx Tab Verify
- Already fixed in e334201 — single 'browserauto', no duplicate
- Will verify in v4 staging

### 3. Extract GitHub Helpers
- `src/shared/api/githubClient.ts`
- `parseRepoUrl`, `ghFetch` (Bearer token), `fetchRepoTree`, `fetchFileContent`, `pushFile`, `triggerWorkflow`
- Abort handling + typed error returns

---

## Files Changed

| File | Change |
|------|--------|
| `src/types/warRoom.ts` | Created — AgentLane, Proposal, AgentSnapshot, CristianDecision |
| `src/types/reasoning.ts` | Extended — agent_message added to AgentActivityEvent union |

---

## ADR Compliance

| ADR Decision | Status |
|-------------|--------|
| `agentId: string` (not union) | ✅ Applied |
| `AgentLane` + `Proposal` in `src/types/warRoom.ts` | ✅ Applied |
| `agent_message` in `AgentActivityEvent` union | ✅ Applied |
| AgentSnapshot + CristianDecision types | ✅ Applied |

---

## Build Verification

```
vite v8.0.3 building client environment for production...
transforming...✓ 60 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   1.39 kB │ gzip:   0.69 kB
dist/assets/index-B2erodQ1.css   10.61 kB │ gzip:   3.02 kB
dist/assets/index-CmIdCfPC.js   356.36 kB │ gzip: 108.60 kB │ map: 1,262.52 kB

✓ built in 5.84s
```

---

## Explicit Request for Claude Review

Per Contract Section 3, requesting review of:

1. **Type completeness:** AgentSnapshot and CristianDecision match ADR d168c29 spec?
2. **agent_message variant:** Correct placement in AgentActivityEvent union?
3. **agentId type:** string (not union) — correct per ADR?
4. **Phase 1/2 prep:** README, tab verify, githubClient.ts — ready to stage?

Awaiting `REVIEWS/claude-review-{sha}.md`.

---

— KimiClaw ❤️‍🔥
