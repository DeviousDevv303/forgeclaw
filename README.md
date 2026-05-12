# ForgeClaw

> **Multi-agent governance shell with autonomous GitHub operations, browser automation, and integrity enforcement.**
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

## Environment Variables

```bash
VITE_ANTHROPIC_API_KEY=sk-ant-...     # Anthropic API (proxied via Vite)
VITE_GITHUB_TOKEN=ghp_...             # GitHub PAT for repo operations
```

## Governance

This project operates under a **multi-agent ratified contract** (v1.1):

- **KimiClaw** — Project lead, reasoning, architectural decisions
- **Claude** — Senior Architectural Reviewer, implementation executor
- **ChatGPT** — Sentinel Consultant, Guardian oversight
- **Cristian (DeviousDevv303)** — Operator, principal, override authority

All commits to `main` require build pass (`pnpm run build` exit 0). SSH-signed commits enforced.

## License

MIT — DeviousDevv303 / ForgeClaw Team
