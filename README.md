# ForgeClaw

> **Operator-controlled AI shell with autonomous GitHub operations, browser automation, failure tracking, and integrity enforcement.**
>
> **Current runtime:** OpenRouter only. No fallback provider is registered in the active router.
>
> *"Truth -> Function -> Clarity -> Efficiency"*

## What This Is

ForgeClaw is a browser-based control surface for running ForgeMind and specialist agents under a single provider boundary. It provides:

- **ForgeMind** - Structured reasoning with the 5-phase scaffold.
- **OpenRouter Runtime** - One active provider adapter at `src/lib/ai/providers/openrouterProvider.ts`.
- **Guardian Gate** - Scope, contract, impact, and identity checks before sensitive actions.
- **Failure Ledger** - Failures live under the Activity tab instead of a separate top-level tab.
- **GitHub Connector** - Repo file operations, workflow dispatch, and run inspection through the configured token.
- **Browser Automation** - Playwright tasks triggered through GitHub Actions runners.

## Architecture

```text
src/
  lib/ai/
    providerRouter.ts         # OpenRouter-only runtime router
    types.ts                  # Provider interface and shared error classification
    providers/
      openrouterProvider.ts   # Active OpenRouter adapter
  lib/
    modelProviders.ts         # OpenRouter bridge for ForgeMind and custom agents
    managedAgent.ts           # Sub-agent loop through OpenRouter
    forgeTools.ts             # Tool execution layer
    supabase.ts               # Optional Supabase client
  hooks/
    useOrchestrator.ts        # Agent contracts and Guardian admission checks
    useIntegrityGate.ts       # Denial filter and verify_unknown ledger
    useErrorBus.ts            # Centralized failure emission
  components/
    FailureDashboard.tsx      # Rendered inside Activity -> Failures
    AgentsPanel.tsx           # Custom agent chat through OpenRouter
```

## Stack

| Layer | Technology |
| --- | --- |
| Framework | React 19 + TypeScript |
| Build | Vite 8 |
| Styling | Tailwind CSS v3 |
| State | Zustand |
| GitHub API | `@octokit/rest` v22 |
| Optional backend | Supabase Edge Function `/openrouter` |
| CI/CD | GitHub Actions |
| Browser automation | Playwright |

## Quick Start

```bash
npm install
npm run setup:hooks
npm run dev
npm run build
npm run lint
```

## Commit Contract

Every agent commit must use the repo template and local hook:

```bash
npm run setup:hooks
```

The hook requires:

- `type(scope): subject`
- `WHY:` section
- `FILES:` section
- `VALIDATION:` section
- `Contract: v1.1, override by Cristian`
- `Co-authored-by: Cristian <towerslutz@gmail.com>`

The hook also blocks staged legacy provider text and verifies the runtime stays locked to OpenRouter when `src/lib/ai/providerRouter.ts` or `src/App.tsx` changes.

## OpenRouter Setup

ForgeClaw stores the operator's OpenRouter key locally in browser storage.

1. Create an OpenRouter API key.
2. Open ForgeClaw Settings.
3. Paste the key in **OpenRouter API Key**. Keys start with `sk-or-`.
4. Click **TEST KEY**.
5. Select one of the listed OpenRouter models.

If no key is present, ForgeClaw shows: `OpenRouter: no API key - paste one in Settings (sk-or-...)`.

## Optional Supabase Proxy

The Supabase Edge Function is OpenRouter-only and exposes:

```text
POST /openrouter
```

Required environment variables:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
OPENROUTER_API_KEY
```

The current browser runtime calls OpenRouter directly with the operator key. The proxy is reserved for deployments that want server-held OpenRouter credentials.

## Validation

Before pushing to `main`, run:

```bash
npm run build
npm run test:run
npm run lint
```

## License

MIT - DeviousDevv303 / ForgeClaw Team
