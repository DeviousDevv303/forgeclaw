# ForgeClaw OpenAI-Only Revert — Implementation Report

**Date:** 2026-05-20  
**Requested by:** Kimi  
**Scope:** Revert ForgeClaw to single AI provider (OpenAI) — UI disabled, architecture preserved for future re-addition.

---

## Files Changed

| File | Change |
|------|--------|
| `src/App.tsx` | Removed provider switching UI, hardcoded OpenAI-only behavior, removed dead provider branches, cleaned unused state |
| `src/lib/ai/providerRouter.ts` | Updated no-key error message to exact user-specified string |
| `src/lib/modelProviders.ts` | No changes — `DEFAULT_PROVIDER` already `'openai'` |

---

## What Was Done

### App.tsx — 9 edits
1. **Import cleanup** — removed unused `PROVIDERS`, `modelSupportsTools` imports
2. **Provider state** — changed `activeProvider` to `useState<ProviderId>('openai')` with no setter exposed
3. **Removed `failedProviders` state** — no multi-provider failover needed
4. **Removed provider selector grid** — replaced with static "OpenAI / GPT models only" display
5. **Removed Ollama indicator from model selector** — model dropdown shows only OpenAI models
6. **API key messages** — all now hardcoded to "OpenAI" instead of dynamic provider name
7. **Removed Kimi Code URL override UI** — commented out, non-OpenAI
8. **Removed OpenRouter custom model ID UI** — commented out, non-OpenAI
9. **Removed dead code in `sendPrompt`**:
   - Ollama local path block (lines 578–596)
   - Anthropic multi-part message format block (lines 733–745)
   - `failedProviders` success cleanup
   - `modelSupportsTools` → hardcoded `true` (OpenAI models all support tools)
10. **Removed unused Ollama discovery state** — `ollamaModels`, `fetchOllamaModels`, `ollamaOnline` (moved to `connected: false` in connectors panel)
11. **Dependency array** — removed `activeProvider` from `sendPrompt` deps (constant)
12. **Error banner** — hardcoded to "OpenAI: no API key — paste one in Settings (sk-... or sk-proj-...)"
13. **Status indicator** — simplified to OpenAI-only (no Ollama local branch)
14. **Reasoning chain label** — hardcoded "Agentic execution via OpenAI"

### providerRouter.ts — 1 edit
- Changed no-key error from `${ACTIVE_PROVIDER.label} API key not configured...` to exact string: **"OpenAI: no API key — paste one in Settings (sk-... or sk-proj-...)"**

---

## Remaining Provider References

These are **internal library code** that preserves future adapter structure. They do not affect current OpenAI-only behavior.

| File | Reference | Status |
|------|-----------|--------|
| `src/lib/modelProviders.ts` | Full provider registry (`anthropic`, `groq`, `kimi`, `ollama`, etc.) | **Kept intact** — future adapter structure |
| `src/lib/managedAgent.ts` | `provider === 'anthropic'` branch + Anthropic API headers | **Kept** — managed agent runner preserves provider-specific routing |
| `src/hooks/useWarRoom.ts` | Regex `/^(kimiclaw\|claude)-\d+$/` for agent name matching | **Kept** — non-functional, just name matching |
| `src/lib/ai/providers/` | All provider adapter files (`anthropicProvider.ts`, `groqProvider.ts`, `kimiProvider.ts`, etc.) | **Kept intact** — future adapter structure |

---

## Build Status

```
> tsc -b && vite build
vite v8.0.3 building client environment for production...
✓ 87 modules transformed.
dist/index.html                   1.23 kB │ gzip:   0.60 kB
dist/assets/index-C8SDCh2K.css   13.15 kB │ gzip:   3.48 kB
dist/assets/index-Cg2KOgGg.js   489.42 kB │ gzip: 135.79 kB │ map: 1,640.80 kB
✓ built in 1.67s
```

**Result:** ✅ PASS — zero TypeScript errors, clean production build.

---

## Security Check

- No real API keys are exposed in source
- `apiKey` state is stored in `localStorage` only (user's own browser)
- Production build (`dist/`) contains no key literals
- Key input uses `type="password"` with show/hide toggle

---

## Summary

ForgeClaw is now **OpenAI-only** in the UI and routing. The provider adapter architecture under `src/lib/ai/providers/` and `src/lib/modelProviders.ts` remains intact — adding Anthropic/Kimi/Groq back later requires only:
1. Re-enabling the provider selector grid in Settings
2. Restoring `PROVIDER_ORDER` and `DEFAULT_MODEL` imports
3. Adding back the provider-specific branches in `sendPrompt`

**No adapter files were deleted.**
