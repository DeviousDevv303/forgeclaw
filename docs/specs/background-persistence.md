# Background Command Persistence Spec

## Goal
User gives a command, leaves the app, it runs autonomously via GitHub Actions. On return, results are waiting.

## Current State
- DeepSeek runs persist via `forgeclaw_active_deepseek_run` in localStorage (#147)
- `shell_exec` and other Actions-backed tools do NOT persist — results lost if app closes
- Resume logic exists for DeepSeek only, triggered on mount and `visibilitychange`

## Scope

### 1. Generalized Command Queue
Create `src/lib/backgroundCommands.ts`:

```typescript
interface BackgroundCommand {
  id: string;                    // unique command ID
  toolName: string;               // 'shell_exec' | 'deepseek_reason' | etc.
  input: Record<string, unknown>; // tool input
  invocationId: string;          // GitHub Actions invocation ID
  dispatchedAt: number;          // timestamp
  messageId: string;             // chat message to update on completion
  status: 'pending' | 'polling' | 'complete' | 'failed';
}
```

Functions:
- `saveBackgroundCommand(cmd: BackgroundCommand): void` — persist to localStorage key `forgeclaw_background_commands` (array, max 20)
- `loadBackgroundCommands(): BackgroundCommand[]`
- `removeBackgroundCommand(id: string): void`
- `updateBackgroundCommand(id: string, updates: Partial<BackgroundCommand>): void`

### 2. Dispatch Integration
In `src/lib/forgeTools.ts`, for Actions-backed tools (`shell_exec`, `deepseek_reason`, `github_run_workflow`):
- After successful dispatch (invocation ID obtained), call `saveBackgroundCommand()`
- Include the chat message ID so results can be routed back

### 3. Resume Logic
In `src/App.tsx`:
- On mount AND on `visibilitychange` (visible), call `resumeBackgroundCommands()`
- For each command with status `pending`/`polling` and age < 30 min:
  - Resume polling via existing `waitForDeepSeekResult` or shell exec polling
  - On completion: update the chat message, mark `complete`, remove from queue
  - On failure: update the chat message with error, mark `failed`, remove from queue
  - On timeout (>30 min): mark `failed`, remove from queue
- Reuse the existing DeepSeek resume pattern from #147 — generalize it, don't duplicate

### 4. UI Indicators
- Activity tab: show "Background" badge on commands that were resumed after app return
- Optional: browser notification when a background command completes (if permission granted)

### 5. Migration
- Keep existing `forgeclaw_active_deepseek_run` logic working
- New commands use the generalized queue
- Eventually migrate DeepSeek to the generalized queue (not required for v1)

## Out of Scope
- Commands that don't use GitHub Actions (local-only tools)
- Push notifications (requires service worker — future)
- Command chaining/dependencies (future)

## Acceptance Criteria
1. User runs `shell_exec`, closes app, reopens after 2 min → result appears in chat
2. User runs DeepSeek, closes app, reopens → existing #147 behavior preserved
3. Commands older than 30 min are cleaned up, not resumed
4. No duplicate polling when app is already open
5. Full test suite passes, TypeScript compiles, ESLint clean

## Files to Modify
- NEW: `src/lib/backgroundCommands.ts` (+ test file)
- `src/lib/forgeTools.ts` — dispatch integration for `shell_exec`, `github_run_workflow`
- `src/App.tsx` — resume logic on mount/visibilitychange, UI badge

## Files to NOT Touch
- `src/lib/guardianGate.ts`
- `src/lib/deepseekArtifact.ts` (existing DeepSeek logic stays)
- `.github/workflows/*`
- `tests/foundation/`

## Definition of Done
Pushed branch with fetchable SHA, full gate green (tsc, eslint, vitest, build), PR open.
