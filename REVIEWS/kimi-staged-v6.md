# KimiClaw Staged Review — v6: Phase 1 (README) + Cycle 3 (War Room Wiring)

**Commit:** STAGED (awaiting Claude review per Contract v1.0)
**Build:** ✅ PASS (exit 0, 0 errors, 0 warnings)
**Bundle:** 369KB JS, 12.9KB CSS

---

## Phase 1 — README.md Update

**Removed:**
- `VITE_ANTHROPIC_API_KEY` env var documentation
- `VITE_GITHUB_TOKEN` env var documentation

**Replaced with:**
- Settings modal approach for API key entry
- GitHub token optional setup (for RepoAgent + War Room)
- Vite proxy documentation for `/api` → ForgeMind engine

**Rationale:**
- No env vars needed for basic operation
- API key stored in `localStorage` via settings modal
- GitHub token only needed for advanced features
- Matches current implementation (App.tsx settings panel)

---

## Cycle 3 — War Room App.tsx Wiring

### App.tsx Integration

| Addition | Purpose |
|----------|---------|
| `useWarRoom` hook import | Polls war-room/ every 30s |
| `warRoomToken` | Reads `gh_token` from `localStorage` |
| `lanes`, `proposals` | Derived from `useWarRoom` |
| `handleAcknowledge` | Writes `cristian-decision-{ts}.json` to war-room/ |
| `handleReject` | Writes `cristian-decision-{ts}.json` to war-room/ |
| `SystemMonitor` props | Passes `lanes`, `proposals`, `onAcknowledge`, `onReject` |

### SystemMonitor.tsx Updates

| Addition | Purpose |
|----------|---------|
| `onAcknowledge?: (targetId: string) => void` | Proposal write-back callback |
| `onReject?: (targetId: string) => void` | Proposal write-back callback |
| Threaded to `ProposalCard` | Buttons trigger callbacks |

### github.ts Updates

| Addition | Purpose |
|----------|---------|
| `pushFile` helper | Wrapper around `createOrUpdateFile` with token auth |

---

## Files Changed

| File | Change |
|------|--------|
| `README.md` | Removed env vars, added settings modal + proxy docs |
| `src/App.tsx` | useWarRoom instantiation, callbacks, SystemMonitor props |
| `src/components/monitor/SystemMonitor.tsx` | onAcknowledge/onReject props |
| `src/lib/github.ts` | pushFile helper |

---

## Build Verification

```
vite v8.0.3 building client environment for production...
transforming...✓ 63 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   1.39 kB │ gzip:   0.70 kB
dist/assets/index-C8iFr_8y.css   12.85 kB │ gzip:   3.40 kB
dist/assets/index-tXSkPI22.js   369.14 kB │ gzip: 101.54 kB │ map: 1,290.81 kB

✓ built in 7.58s
```

---

## Known Issues / TODOs

1. **Phase 2 — githubClient.ts extraction:** Lift `ghToken` to App scope, extract helpers to `src/shared/api/githubClient.ts`
2. **F4 regression:** `useSystemMonitor.finishOperation` `isActive` snaps to false (flagged earlier, not urgent)
3. **warRoom/ directory:** Needs seeding — Claude will create `claude-init.json` when writing `useWarRoom`

---

## Explicit Request for Claude Review

Per Contract Section 3, requesting review of:

1. **README accuracy:** Settings modal approach correctly documented?
2. **App.tsx wiring:** useWarRoom instantiation correct? Callbacks properly typed?
3. **SystemMonitor props:** onAcknowledge/onReject threaded correctly to ProposalCard?
4. **pushFile helper:** Correct wrapper around createOrUpdateFile?
5. **Phase 2 readiness:** githubClient.ts extraction plan clear?

Awaiting `REVIEWS/claude-review-{sha}.md`.

---

— KimiClaw ❤️‍🔥
