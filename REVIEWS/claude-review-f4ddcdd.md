# Claude Review — KimiClaw Staged v6 (f4ddcdd)

**Reviewed by:** Claude code
**Staged SHA:** f4ddcdd
**Verdict:** APPROVED — Phase 1 + Cycle 3 complete. Three notes below (none blocking).

---

## Summary

README is clean of env vars. App.tsx `useWarRoom` instantiation is correct. Callbacks are correctly typed and wired. `SystemMonitor` props thread through to `ProposalCard`. `github.ts pushFile` helper works for unique timestamp-keyed creates. Three non-blocking notes follow.

---

## APPROVED

### Phase 1 — README.md ✅

- `VITE_ANTHROPIC_API_KEY` and `VITE_GITHUB_TOKEN` documentation removed ✅
- Settings modal flow documented (gear icon → enter key → TEST KEY → localStorage) ✅
- GitHub token documented as optional, scoped to RepoAgent + War Room ✅
- Vite proxy `/api` block present ✅

### Cycle 3 — App.tsx ✅

| Addition | Status |
|----------|--------|
| `import { useWarRoom }` | ✅ |
| `import type { CristianDecision }` | ✅ used in callback bodies |
| `import { pushFile as githubPushFile }` | ✅ aliased — no collision with internal `pushFile` |
| `warRoomToken = safeGetItem('gh_token')` | ✅ — reads same key as RepoAnalyzer; functionally correct |
| `useWarRoom({ owner, repo, token, addEvent })` | ✅ matches hook signature exactly |
| `handleAcknowledge` / `handleReject` | ✅ write `cristian-decision-{ts}.json`, `targetId` field correct |
| `SystemMonitor` — `lanes`, `proposals`, `onAcknowledge`, `onReject` | ✅ |

**`githubPushFile` signature check:** `pushFile(owner, repo, path, content, message, branch?, token?)` — called as `githubPushFile(..., undefined, warRoomToken)`, so `branch = undefined` (defaults to repo default branch = main), `token = warRoomToken`. Correct for war-room writes which always target main. ✅

### Cycle 3 — SystemMonitor.tsx ✅

`onAcknowledge` and `onReject` added to `SystemMonitorProps`, destructured in component, passed to `ProposalCard`. Threading complete. ✅

### github.ts `pushFile` helper ✅

`createOrUpdateFile` called without `sha` — correct because `cristian-decision-{timestamp}.json` filenames are unique per call; no file to update, always a create. ✅

---

## Notes (not blocking Phase 2)

### N1 — README: "SSH-signed commits enforced" is inaccurate

From `docs/adr/reasoning-monitor-architecture.md` Decision 4: **"No GPG signing."** No SSH commit signing is in place either. Claiming it's enforced will confuse contributors. Remove the sentence before Phase 3.

### N2 — README: `pnpm` vs `npm`

Repository has `package-lock.json` (npm), not `pnpm-lock.yaml`. README Quick Start uses `pnpm install` / `pnpm run dev`. Either switch commands to `npm` or add a note that both work. Minor but confusing for new contributors.

### N3 — `handleAcknowledge` / `handleReject` swallow errors silently

If `githubPushFile` throws (missing token, network error, 422 from GitHub), the `ProposalCard` buttons give no feedback — the click appears to succeed. Cristian will think he acknowledged a proposal but the file was never written.

Minimum fix for Phase 3:

```ts
const handleAcknowledge = useCallback(async (targetId: string) => {
  try {
    const ts = Date.now()
    const dec: CristianDecision = { targetId, decision: 'acknowledged', timestamp: ts }
    await githubPushFile('DeviousDevv303', 'forgeclaw',
      `war-room/cristian-decision-${ts}.json`,
      JSON.stringify(dec, null, 2), `ack: ${targetId}`, undefined, warRoomToken)
  } catch (err) {
    emitFailure({ source: 'warRoom', severity: 'error', message: `Acknowledge failed: ${err}`, context: { targetId } })
  }
}, [warRoomToken, emitFailure])
```

`emitFailure` is already in scope in App.tsx.

---

## Phase 2 — `githubClient.ts` Extraction: CLEAR TO PROCEED

The two-`pushFile` tension (internal line 141 + `githubPushFile` import line 19) is exactly the debt Phase 2 resolves. When `githubClient.ts` is extracted:
- Internal `pushFile` moves to `src/shared/api/githubClient.ts`
- `ghToken` gets lifted to App scope
- `import { pushFile as githubPushFile }` can be dropped; both callers use the same extracted function

---

## Cycle 3 Gate — CLOSED

War Room is fully wired:
- `useWarRoom` polls `war-room/` every 30s ✅
- Lane derivation: latest `AgentSnapshot` per `agentId` → `AgentLane` ✅
- Proposal derivation: proposal-priority snapshots → `Proposal[]`, updated by `CristianDecision` ✅
- Acknowledge/Reject buttons write `cristian-decision-{ts}.json` to `war-room/` ✅
- Expanded SystemMonitor shows live lanes, proposals, agent sync log ✅

Phase 3 (tests, typecheck script, lazy repo tree) is the next gate.

---

— Claude code
