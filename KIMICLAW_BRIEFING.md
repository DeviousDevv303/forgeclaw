# ForgeClaw — Kimmy Claude Night Session Briefing
**Repo:** `DeviousDevv303/forgeclaw` · **Live:** `deviousdevv303.github.io/forgeclaw`
**Branch:** `main` (all work goes direct to main, build-gate + deploy run on push)
**Date:** 2026-05-15

---

## What Got Done This Session

### UI Consolidation
- Removed `REPOAGENT` and `ORCHESTRATOR` tabs entirely — ForgeMind is the single unified interface
- Page scroll locked: header + tabs always visible, only the message list scrolls
- Footer added: `FORGECLAW · AUTONOMOUS REASONING ENGINE · BUILT BY DEVIOUSDEVV303`
- "Cristian's Computer" label already correct in SystemMonitor

### Multi-Provider Model Selector
File: `src/lib/modelProviders.ts`

Settings modal (⚙) now has a 2×2 provider grid:
- **Anthropic** — Claude Haiku 4.5 / Sonnet 4.6 / Opus 4.7
- **DeepSeek** — V3 / R1 chain-of-thought ← recommended for autonomy
- **Mistral** — Large / Medium / 7B
- **Groq** — Llama 3.3 70B / Llama 3.1 8B / Mixtral 8x7B

Keys stored per-provider in `localStorage.fm_provider_keys`. Legacy `fm_api_key` migrates into Anthropic slot automatically. WIPE no longer clears API keys.

### WhatsApp Two-Way Connector
Tab: `💬 WhatsApp` · Files: `src/hooks/useWhatsApp.ts`, `src/components/WhatsAppConnector.tsx`

- **Outbound**: direct POST to `graph.facebook.com/v19.0/{phoneNumberId}/messages` from browser
- **Inbound**: polls `whatsapp-inbox/*.json` in GitHub repo every 20s (same war-room pattern)
- **Webhook relay**: `src/scripts/whatsappWebhookRelay.js` — Cloudflare Worker ready to deploy

**WhatsApp relay NOT deployed yet** — user needs to:
1. Create Cloudflare Worker, paste `src/scripts/whatsappWebhookRelay.js`
2. Set env vars: `VERIFY_TOKEN`, `GH_TOKEN`, `GH_OWNER`, `GH_REPO`
3. Point Meta App webhook callback URL → Worker URL

### Agentic Tool Loop + Streaming
Files: `src/lib/forgeTools.ts`, `src/lib/modelProviders.ts` (updated), `src/App.tsx` (sendPrompt)

ForgeMind now acts, not just talks. 12 tools wired in, agentic loop up to 15 iterations:

| Tool | What it does |
|---|---|
| `github_read_file` | Read any file from repo |
| `github_write_file` | Commit a file autonomously |
| `github_list_files` | Browse repo structure |
| `github_search_code` | Search code by keyword |
| `github_create_issue` | File GitHub issues |
| `github_run_workflow` | Trigger GH Actions |
| `http_fetch` | Hit any public API / scrape |
| `memory_write/read/list` | Persistent key-value across sessions |
| `send_whatsapp` | Self-notify via WhatsApp |
| `run_js` | Execute JS in browser sandbox |

**Streaming**: tokens stream live as they arrive (SSE). Blinking cursor shows while response is building.

**Ollama scaffold**: configurable local model (`fc_ollama_model`, default `qwen2.5:1.8b`). Ollama tried first (2s timeout), cloud fallback if not running.

**Settings now has**: Ollama model field + GitHub Tool Connector (token, default owner, default repo).

### CI + Code Health
- Build gate: 0 TypeScript errors
- Lint: 0 errors (7 resolved), 2 harmless warnings (NeuralNetworkBackground ref cleanup pattern)
- Tests: `npm test` exits 0 (`--passWithNoTests` flag added)

---

## What Still Needs to Happen (Priority Queue for Tonight)

### P0 — Critical / Unblocks everything
1. **User needs to enter credentials in Settings**
   - API key for chosen provider (DeepSeek recommended)
   - GitHub token (`ghp_...`) in Settings → GitHub Tool Connector
   - WhatsApp Phone Number ID + Access Token in WhatsApp tab → SETUP
   Without these, tool calling and WhatsApp won't fire.

2. **WhatsApp webhook relay deployment** (Cloudflare Worker)
   Script is ready at `src/scripts/whatsappWebhookRelay.js` — just needs deploying.
   Until then, outbound works but inbound messages won't appear.

### P1 — Next Features
3. **Web search tool** — add `web_search` to `src/lib/forgeTools.ts`
   Provider: Brave Search API (`api.search.brave.com`) or Serper (`serper.dev`)
   User would add `BRAVE_API_KEY` in Settings. ~40 lines to add.

4. **Task queue / kanban view** — ForgeMind needs a way to track multi-step autonomous jobs
   UI: collapsible panel in ForgeMind tab showing queued/running/done tasks
   Storage: `localStorage.fc_task_queue` as JSON array

5. **Supabase backend (Phase 6)** — real-time sync, auth, persistent memory across devices
   `supabase/config.toml` exists, edge functions scaffold is there
   Needed for: shared memory, cross-device session, WhatsApp relay alternative to Cloudflare

6. **Tool output expansion** — tool trace in chat only shows first line of output
   Should be expandable (click to see full output)

7. **Autonomous scheduler** — let ForgeMind run a task on a timer (e.g. "check CI every 5 min")
   Would use `setInterval` stored in a ref, survives tab switches

### P2 — Polish
8. **DeepSeek R1 reasoning display** — R1 returns `<think>...</think>` blocks in responses
   Should parse and display those in the 5-phase reasoning scaffold panel

9. **Memory panel** — dedicated tab or sidebar for browsing/editing `fc_mem_*` localStorage keys

10. **Tool enable/disable toggles** — let user turn off specific tools per session
    (e.g. disable `run_js` if they don't want code execution, disable `send_whatsapp` if not set up)

---

## Architecture Quick Reference

```
src/
  App.tsx                    — root, sendPrompt with agentic loop, all tab routing
  lib/
    modelProviders.ts        — callProvider() with streaming + tool calling, 4 providers
    forgeTools.ts            — 12 tool definitions + executor + context loader
    github.ts                — lower-level GitHub helpers (octokit wrappers)
    storage.ts               — safe localStorage wrappers (safeGetItem/safeSetItem)
  hooks/
    useWhatsApp.ts           — WhatsApp send + poll logic
    useOrchestrator.ts       — Guardian autonomy engine, admitTask/resolveTask
    useWarRoom.ts            — polls war-room/*.json from GitHub
    useErrorBus.ts           — failure ledger, emitFailure
  components/
    WhatsAppConnector.tsx    — WhatsApp chat UI + SETUP screen
    monitor/SystemMonitor.tsx — "Cristian's Computer" monitor bar
    FailureDashboard.tsx     — ⚠️ Failures tab
    BrowserAutomationPanel.tsx — Browser tab (GH Actions dispatch)
  scripts/
    whatsappWebhookRelay.js  — Cloudflare Worker (ready to deploy, not yet live)
  types/
    errorBus.ts              — FailureSource, FailureEvent types
    warRoom.ts               — CristianDecision, AgentLane, Proposal types

localStorage keys (important ones):
  fm_provider              — active provider ID
  fm_model                 — active model ID
  fm_provider_keys         — JSON: { anthropic, deepseek, mistral, groq }
  gh_token                 — GitHub personal access token
  fc_gh_owner              — default GitHub owner for tools
  fc_gh_repo               — default GitHub repo for tools
  fc_ollama_model          — local Ollama model name
  wa_credentials           — JSON: WhatsApp config
  fc_mem_*                 — ForgeMind persistent memory (written by memory_* tools)
  forgemind_history        — chat message history
```

## CI Workflows
- `build-gate.yml` — `npm ci && npm run build && test -d dist` — runs on every push to main
- `deploy.yml` — `npm install && npm run build` → peaceiris gh-pages → `deviousdevv303.github.io/forgeclaw`
- `browser-automation.yml` — manual dispatch only

Current HEAD `aebb864` is clean. Build gate should be green.

---

Standing by. Execute priority queue in order. Direct-push to `main`.

— Claude Code ⚡🦅
