# ForgeClaw

> **Multi-agent governance shell with autonomous GitHub operations, browser automation, and integrity enforcement.**
>
> **Current runtime:** Ollama (local) primary, Claude (Anthropic) cloud fallback.  
> **Architecture:** Multi-provider ready — Kimi, Groq, OpenRouter adapters preserved for future activation.  
>
> *"Truth → Function → Clarity → Efficiency"*

---

## What This Is

ForgeClaw is a browser-based control surface for orchestrating multiple AI agents under a unified governance framework. It provides:

- **ForgeMind** — A structured reasoning engine with 5-phase scaffold (Assumptions → Heuristics → First Principles → Extension → Convergence)
- **Guardian Gate** — Autonomous authority evaluation: every task is checked against agent contracts, identity, scope, escalation thresholds, and impact classification before admission
- **Integrity Enforcement** — Denial-pattern detection with `verify_unknown` memory search and contradiction catching (behavioral targets; structural gate pending)
- **GitHub Autonomous Connector** — Full CRUD on repos, files, branches, PRs, workflow dispatch, and artifact extraction via `@octokit/rest`
- **Browser Automation** — Playwright-driven screenshot, scrape, test, and audit tasks triggered from the frontend and executed via GitHub Actions CI runners
- **Neural Network Background** — Canvas-based generative visualization with tab-specific palettes, reduced-motion support, and page visibility optimization

## Architecture

```
src/
├── lib/ai/
│   ├── providerRouter.ts        # Multi-provider router — Ollama primary, Claude cloud fallback
│   ├── types.ts                 # AIError classification, shared types
│   └── providers/               # Active + dormant adapter layer
│       ├── claudeProvider.ts    # ACTIVE — Claude Sonnet/Opus/Haiku (sk-ant-... keys)
│       ├── ollamaProvider.ts    # ACTIVE — Local models on :11434 (no key needed)
│       ├── kimiProvider.ts      # Dormant — Kimi/Moonshot adapter ready
│       ├── groqProvider.ts      # Dormant — Groq/Llama adapter ready
│       └── openrouterProvider.ts# Dormant — multi-model gateway ready
├── core/
│   └── autonomyEngine.ts          # Guardian evaluation kernel (6-rule trace)
├── components/
│   ├── NeuralNetworkBackground.tsx # Generative canvas visualization
│   ├── OrchestratorPanel.tsx       # Task queue, events, contract browser
│   ├── BrowserAutomationPanel.tsx  # Playwright CI trigger + artifact viewer
│   ├── FailureDashboard.tsx        # Error bus + integrity ledger viewer
│   └── FileUploadButton.tsx        # Corpus ingestion
├── hooks/
│   ├── useOrchestrator.ts         # Task admission + agent contract registry
│   ├── useIntegrityGate.ts        # Denial filter + verify_unknown + ledger
│   ├── useBrowserAutomation.ts    # GitHub Actions workflow dispatch + polling
│   └── useErrorBus.ts             # Centralized failure emission
├── lib/
│   ├── github.ts                  # Full GitHub REST wrapper with Guardian gate
│   ├── modelProviders.ts          # Provider registry (all types preserved)
│   └── supabase.ts                # Client init (reserved for future backend)
├── types/
│   ├── autonomy.ts                # GuardianDecision, GuardianTrace, GuardianContext
│   ├── orchestrator.ts            # TaskSpec, AgentContract, AuthorityScope
│   ├── integrityGate.ts           # FailureEvent, VerifyUnknownResult
│   └── errorBus.ts                # EmitFailureOptions, ErrorSeverity
└── scripts/
    ├── ciIdentityScanner.ts       # CI gate: identity line preservation check
    └── browser-automation.js      # Playwright runner for GitHub Actions
```

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 19 + TypeScript |
| Build | Vite 8 |
| Styling | Tailwind CSS v3 |
| State | Zustand |
| GitHub API | `@octokit/rest` v22 |
| Backend (reserved) | Supabase |
| CI/CD | GitHub Actions |
| Browser Automation | Playwright |

## Quick Start

```bash
# Prerequisites: Node.js 22+, pnpm
pnpm install
pnpm run dev      # Vite dev server on :5173
pnpm run build    # TypeScript + Vite build
pnpm run lint     # ESLint
```

## API Key Setup

ForgeClaw uses a **settings modal** for API key entry (no env vars required):

### Ollama (Local — Primary, No Key Needed)

1. Install Ollama: https://ollama.com
2. Pull a model: `ollama pull qwen2.5:1.8b` (or any model you prefer)
3. Start Ollama: `ollama serve` (runs on `localhost:11434`)
4. ForgeClaw auto-detects Ollama — no key entry needed
5. Select "Ollama" in the Settings panel model dropdown

> **Error if missing:** *"Ollama not running. Start it with: ollama serve"*

### Claude (Anthropic — Cloud Fallback)

1. Get a Claude API key from https://console.anthropic.com/ (`sk-ant-...` format)
2. Click the ⚙ gear icon in the header
3. Enter your Claude API key in the settings panel
4. Click **TEST KEY** to verify
5. Key is stored in `localStorage` — persists across sessions
6. Select "Claude" in the Settings panel model dropdown

> **Error if missing:** *"Claude: no API key — paste one in Settings (sk-ant-...)"*

### Future Providers (Dormant)

The following provider adapters are preserved in `src/lib/ai/providers/` for future activation:

| Provider | Adapter File | Status | Key Format |
|----------|-------------|--------|-----------|
| Kimi (Moonshot) | `kimiProvider.ts` | Dormant | `sk-...` (Kimi API) |
| Groq | `groqProvider.ts` | Dormant | `gsk-...` (Groq API) |
| OpenRouter | `openrouterProvider.ts` | Dormant | `sk-or-...` (OpenRouter) |

To activate a provider:
1. Wire its adapter into `providerRouter.ts`
2. Add its key validation to `isConfigured()`
3. Add its model selector to the Settings panel
4. Update `DEFAULT_PROVIDER` in `src/lib/modelProviders.ts` if changing default

### GitHub Token (Optional)

For repo operations (RepoAgent tab, War Room):
1. Generate a GitHub Personal Access Token with `repo` scope
2. Enter it in the settings modal under "GitHub Token"
3. Used for: file push, workflow trigger, War Room polling

### Vite Proxy (Development)

The dev server proxies `/api` to the ForgeMind engine:
```typescript
// vite.config.ts
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:3001',
      changeOrigin: true,
    },
  },
}
```

## Governance

This project operates under a **multi-agent ratified contract** (v1.1):

- **KimiClaw** — Project lead, reasoning, architectural decisions
- **Claude** — Senior Architectural Reviewer, implementation executor
- **ChatGPT** — Sentinel Consultant, Guardian oversight
- **Cristian (DeviousDevv303)** — Operator, principal, override authority

All commits to `main` require build pass (`npm run build` exit 0).

## License

MIT — DeviousDevv303 / ForgeClaw Team
