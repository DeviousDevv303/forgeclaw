# ADR: Remediation Roadmap — Audit Findings

**Date:** 2026-05-13
**Status:** Accepted
**Authors:** Claude code
**Priority order:** Truth > Function > Clarity > Efficiency

---

## Context

A full audit of the live ForgeClaw app and repository surfaced seven issue classes. This ADR documents the remediation decision for each, assigns a phase, and records what is deferred and why. It is the single source of truth for prioritization until Phase 6.

---

## Issue Register

| # | Issue | Severity | Phase |
|---|-------|----------|-------|
| 1 | API key exposure — README documents `VITE_ANTHROPIC_API_KEY` inline | Critical | 1 |
| 2 | App.tsx is a monolith (900+ lines, GitHub helpers, all feature UI) | High | 2 |
| 3 | GitHub fetch helpers live inside `App.tsx` component scope | High | 2 |
| 4 | LLM action parsing is unvalidated raw string matching | High | 2 |
| 5 | No test coverage — vitest not wired, no typecheck script | Medium | 3 |
| 6 | Repo tree fetches entire tree recursively on load | Medium | 3 |
| 7 | No accessibility attributes | Low | 5 |

---

## Decisions

### Decision 1 — Backend/Supabase Edge Function API Proxy: DEFERRED to Phase 6

**Issue:** API keys are sent from the browser. Full backend proxy would eliminate client-side key exposure.

**Decision:** Deferred. Rationale:
- ForgeClaw is at prototype stage. A production-grade backend proxy (Supabase Edge Functions, auth layer, key rotation) is 10× the scope of any other item on this list. Shipping a backend to fix a prototype-stage security posture that is already partially mitigated is a scope blocker, not a safety control.
- **Current mitigation (already applied):** Key moved from hardcoded source to `VITE_ANTHROPIC_API_KEY` env var + settings modal. Key is never committed. No public endpoint exists.
- **Residual risk:** `VITE_` prefix exposes the key in the browser bundle. Acceptable for a prototype with no public user access. Re-evaluate at first public user or monetization milestone.

**Phase 6 deliverable:** Supabase Edge Function `/api/claude` proxy. Client sends prompt + session token, function holds API key server-side, returns streamed response. Zero keys in browser bundle.

---

### Decision 2 — README Update: Phase 1 (Immediate)

**Issue:** README documents `VITE_ANTHROPIC_API_KEY` as a raw env var to set manually, which instructs users to put keys in `.env` files that could be committed. Documentation is stale relative to the settings modal introduced in later builds.

**Decision:** Fix immediately. README must:
1. Remove any instruction to set `VITE_ANTHROPIC_API_KEY` directly.
2. Document the current flow: enter key via the settings modal (⚙ icon) → stored in `localStorage` under `fm_api_key` → never committed to git.
3. Add a `.env.example` with a `VITE_ANTHROPIC_API_KEY=` stub and a note that the settings modal is the preferred path.
4. Add `VITE_ANTHROPIC_API_KEY` to `.gitignore` (alongside `.env.local`).

**Owner:** Claude code (docs). No src/ changes required.

---

### Decision 3 — App.tsx Breakup: Phase 2

**Issue:** `App.tsx` contains the GitHub fetch helpers (`ghFetch`, `fetchRepoTree`, `fetchFileContent`, `pushFile`, `triggerWorkflow`), the `RepoAnalyzer` component, and all tab feature UI in a single 900+ line file. It is untestable and unmaintainable.

**Decision:** Phase 2 extraction in two steps:

**Step A — Extract GitHub API client:**
```
src/shared/api/githubClient.ts
  export { ghFetch, fetchRepoTree, fetchFileContent, pushFile, triggerWorkflow }
```
These are pure async functions with no React dependency. Moving them enables unit testing and reuse across features.

**Step B — Feature module split:**
```
src/features/
  chat/           — ForgeMind tab: messages, input, reasoning chain, corpus
  repo-agent/     — RepoAgent tab: RepoAnalyzer component
  orchestrator/   — OrchestratorPanel wrapper
  failures/       — FailureDashboard wrapper
  browser-auto/   — BrowserAutomationPanel wrapper
```
Each feature folder owns its own components, local state, and hooks. `App.tsx` becomes a thin router/layout: tab state, global hooks, `SystemMonitor` placement. Target: App.tsx under 150 lines.

**Constraint:** No breaking changes to persisted `localStorage` keys during this refactor.

---

### Decision 4 — LLM Action Hardening: Phase 2

**Issue:** ForgeMind response parsing uses raw string matching on LLM output:
```ts
if (content.includes('[FM:STORE]')) { /* ... */ }
if (content.includes('[FM:RECALL]')) { /* ... */ }
```
An adversarial or hallucinated response can trigger storage writes or corpus recall without validation.

**Decision:** Replace raw string parsing with a validated `ModelAction` union:

```ts
type ModelAction =
  | { type: 'store';  payload: string; confidence: number }
  | { type: 'recall'; query: string }
  | { type: 'final';  content: string }

function parseModelActions(raw: string): ModelAction[]
```

`parseModelActions` extracts action tags via regex, validates shape, and returns only known action types. Unknown or malformed tags are logged and discarded — never executed. The function is independently testable.

**Acceptance criterion:** No action executes without passing through `parseModelActions`. All action types have a corresponding `ModelAction` variant — no unrecognized string leads to side effects.

---

### Decision 5 — Tests: Phase 3

**Issue:** No test coverage beyond the stale (now rewritten) component tests. No `typecheck` script. No CI test step.

**Decision:** Phase 3 deliverables in priority order:

1. **`npm run typecheck`** script: `tsc -b --noEmit`. Runs standalone, not bundled into `build`.
2. **`npm run check`** script: `npm run typecheck && npm run test -- --run`. CI gate runs this.
3. **Unit test targets (vitest):**
   - `parseRepoUrl` — pure function, easy coverage
   - `safeGetItem / safeSetItem / safeJsonParse` — storage boundary
   - `integrity_gate` admission logic — security-critical
   - `useOrchestrator` admission + task lifecycle
   - `parseModelActions` (Phase 2 deliverable)
4. **Component tests:** Existing tests (now rewritten) cover the reasoning + monitor stack. Phase 3 adds tests for `RepoAnalyzer` submit flow and `FailureDashboard` resolve flow.

**Vitest config:** Already present in `vite.config.ts`. `src/test/setup.ts` with `@testing-library/jest-dom` already wired. Phase 3 adds the `check` script and the unit targets above.

---

### Decision 6 — Repo Tree Lazy-Load: Phase 3

**Issue:** `fetchRepoTree` calls `GET /repos/{owner}/{repo}/git/trees/HEAD?recursive=1`, which fetches the entire file tree for large repos in one request. This is slow, burns GitHub API rate limit, and blocks the UI.

**Decision:** Replace with directory-on-expand pattern:

```
GET /repos/{owner}/{repo}/contents/{path}
→ returns immediate children only (files + subdirs)
→ subdirs expand on user click → fetch their children
→ cache fetched paths in a `Map<string, RepoTreeItem[]>` keyed on path
```

The cache lives in the `RepoAnalyzer` component state (or extracted hook). Invalidated on repo URL change. No global store needed.

**Acceptance criterion:** Initial load of any repo fetches only the root directory. Large repos (10k+ files) do not hang the UI.

---

### Decision 7 — Accessibility: Phase 5

**Issue:** No `aria-label`, `aria-live`, or semantic landmark elements. Tab triggers are `<button>` in some places and `<div onClick>` in others. Screen readers and reduced-motion users are unsupported.

**Decision:** Phase 5 pass covering:
- All interactive elements use semantic `<button>` or `<a>`.
- Tab bar uses `role="tablist"` + `role="tab"` + `aria-selected`.
- Chat message list uses `aria-live="polite"` for streaming updates.
- `@media (prefers-reduced-motion: reduce)` suppresses `animate-pulse` and transition classes.
- No functional changes — accessibility is a pure enhancement pass.

---

## Phase Map

| Phase | Name | Constraint | Deliverables |
|-------|------|-----------|--------------|
| **1** | Truth / Security | Ship first, nothing else unblocks this | README rewrite, `.env.example`, `.gitignore` update |
| **2** | Function | Requires Phase 1 green | `githubClient.ts` extraction, App.tsx feature split, `ModelAction` union |
| **3** | Clarity | Requires Phase 2 green | `typecheck` + `check` scripts, unit tests, lazy repo tree |
| **4** | Efficiency | Requires Phase 3 green | Zustand feature stores where profiling shows re-render cost |
| **5** | Convergence | Requires Phase 4 green | Accessibility pass, bundle analysis + code-split |
| **6** | Future | Requires public-user milestone | Supabase Edge Function API proxy, server-side key management |

**Phase 4 note:** Zustand is not introduced until profiling confirms a render cost problem. The current hook-state architecture is sufficient for prototype scale. No speculative stores.

---

## What This ADR Does Not Change

- Auth logic, API key state, and autonomy engine code are untouched in all phases.
- `localStorage` key names (`forgemind_history`, `forgemind_corpus`, `fm_api_key`, `gh_token`) are preserved across refactors.
- Guardian-gated files (`integrity_gate.ts`, `useIntegrityGate.ts`, `.github/workflows/`) require explicit Guardian flag before modification per Standing Rule 18, regardless of phase.
- The duplicate `browserauto` tab bug is fixed in Phase 2 (already patched on `claude/fix-ui-styling-0Adh6`; included in Phase 2 for completeness once branch merges).

---

## Open Questions

1. **Settings modal key storage:** `fm_api_key` in `localStorage` is better than a committed `.env` file, but still readable by any JS on the page. Phase 1 should add a note in the README that this is the current trade-off and link to the Phase 6 backend plan.
2. **`[FM:STORE]` corpus write:** Does the corpus write in Phase 2 require a confirmation gate, or is LLM-initiated storage acceptable? Cristian to decide before `parseModelActions` is shipped.
