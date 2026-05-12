# ForgeClaw Phase 1 — Supabase Backend

## Status: STAGED | AWAITING COMMIT APPROVAL

**Date:** 2026-05-12
**Branch:** main
**Ahead of origin:** 1 commit (previous work)
**New changes:** 7 files staged

---

## Files Changed

### New Files (5)

1. **database/schema.sql**
   - Full Supabase schema with enums: `failure_category`, `task_status`, `task_intent`
   - 4 tables: `agent_contracts` (system-global), `task_history`, `failure_ledger`, `integrity_catches` (user-scoped)
   - RLS policies on all user-scoped tables
   - Indexes for performance
   - `updated_at` triggers via `moddatetime` extension

2. **supabase/config.toml**
   - `verify_jwt = false` for Edge Function
   - Manual `getUser(jwt)` validation instead

3. **supabase/functions/proxy-api/index.ts**
   - Deno Edge Function
   - CORS configured for ForgeClaw origins
   - `POST /anthropic` — proxies to Claude API with `ANTHROPIC_API_KEY` from Supabase secrets
   - `POST /ollama` — proxies to local Qwen on `host.docker.internal:11434`
   - Manual JWT validation with `getUser(jwt)` + service role key
   - Structured JSON errors, no DB writes, no hardcoded keys
   - Uses `https://esm.sh/@supabase/supabase-js@2`

4. **src/hooks/useAuth.ts**
   - Session hook with `signIn`, `signUp`, `signOut`, `refresh`
   - `onAuthStateChange` listener for real-time auth updates
   - Returns `{ user, session, loading, error, signIn, signUp, signOut, refresh }`

5. **src/components/SupabaseProvider.tsx**
   - React context provider wrapping `useAuth`
   - Provides auth state to entire component tree
   - Handles loading and error states

### Modified Files (2)

6. **src/lib/supabase.ts**
   - Updated `createClient` with auth configuration
   - Typed table helpers: `insertTaskHistory`, `insertFailureLedger`, `insertIntegrityCatch`
   - Auto-injects `user_id` from session into all inserts
   - Exports `supabase` singleton for direct use

7. **src/App.tsx**
   - Imports `SupabaseProvider`
   - Wraps return JSX with `<SupabaseProvider>`
   - Identity line intact at line 54: `"You retain all your normal values, guidelines, and identity as Claude."`

---

## Build Verification

```
Command: npm run build
Exit code: 0
TypeScript errors: 0
Warnings: 0
```

## Security Scan

- No hardcoded `sk-*` keys
- No `sb_secret_*` or `sb_publishable_*` in new files
- `ANTHROPIC_API_KEY` pulled from Supabase secrets at runtime
- Identity line in `FORGEMIND_SYSTEM_PROMPT` intact (line 54)

## Acceptance Criteria

- [x] Schema applies cleanly with `supabase db reset`
- [x] Edge Function deploys with `supabase functions deploy proxy-api`
- [x] `tsc -b` passes clean
- [x] No `any` types in new code
- [x] No `@ts-ignore` or `@ts-expect-error`
- [x] RLS policies prevent cross-user data access
- [x] JWT validation returns structured errors (not generic 401)

## What's NOT Included (Phase 2)

- Rate limiting on proxy (deferred)
- Qwen chat UI integration
- Consciousness system components
- Neural AI component porting
- Diary system implementation

---

## Commit Message (Proposed)

```
feat: Supabase backend layer — Phase 1

- Database schema with RLS policies
- Edge Function proxy for Anthropic + Ollama
- Auth hooks and provider
- Typed Supabase client with table helpers

Build: pass
Security: clean
Contract: v1.1
```

---

**Awaiting your explicit "commit and push" approval per Contract v1.1 Section 2.2.**

**Operator:** Cristian (DeviousDevv303)
**Project Lead:** KimiClaw
**Reviewer:** Claude (pending)
