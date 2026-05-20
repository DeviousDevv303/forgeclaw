# ForgeClaw

> **Multi-agent governance shell with autonomous GitHub operations, browser automation, and integrity enforcement.**
>
> **Current runtime:** OpenAI-only (GPT-4o / GPT-4o-mini).  
> **Architecture:** Multi-provider ready — Anthropic, Kimi, Groq, Ollama adapters preserved for future re-enablement.  
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
│   ├── providerRouter.ts        # Single-provider router — OpenAI only at runtime
│   ├── types.ts                 # AIError classification, shared types
│   └── providers/               # Dormant adapter layer (preserved for future)
│       ├── openaiProvider.ts    # ← ACTIVE — GPT-4o, GPT-4o-mini, GPT-4-turbo
│       ├── anthropicProvider.ts # Dormant — Claude adapter ready
│       ├── kimiProvider.ts      # Dormant — Kimi/Moonshot adapter ready
│       ├── groqProvider.ts      # Dormant — Groq/Llama adapter ready
│       ├── ollamaProvider.ts    # Dormant — local model adapter ready
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

### OpenAI (Required — Current Runtime)

1. Click the ⚙ gear icon in the header
2. Enter your OpenAI API key (`sk-...` or `sk-proj-...`) in the settings panel
3. Click **TEST KEY** to verify
4. Key is stored in `localStorage` — persists across sessions

> **Error if missing:** *"OpenAI: no API key — paste one in Settings (sk-... or sk-proj-...)"*

### Future Providers (Dormant)

The following provider adapters are preserved in `src/lib/ai/providers/` for future re-enablement:

| Provider | Adapter File | Status |
|----------|-------------|--------|
| Anthropic | `anthropicProvider.ts` | Dormant |
| Kimi (Moonshot) | `kimiProvider.ts` | Dormant |
| Groq | `groqProvider.ts` | Dormant |
| Ollama (Local) | `ollamaProvider.ts` | Dormant |
| OpenRouter | `openrouterProvider.ts` | Dormant |

To re-enable a provider:
1. Uncomment its selector button in `src/App.tsx` Settings panel
2. Restore its branch in `sendPrompt()` logic
3. Add its API key input field to Settings
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
