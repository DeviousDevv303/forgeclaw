# ForgeClaw

> **A local-first, operator-controlled AI development and automation console.**
>
> ForgeClaw combines structured agent workflows, a provider-backed AI runtime, GitHub operations, browser-automation runners, safety checks, and failure visibility in one browser-based workspace.

**Status:** Active development
**License:** MIT

## What ForgeClaw does

ForgeClaw is designed for people who want an AI-assisted development environment that remains observable and operator-controlled. It provides a single workspace for:

- Running ForgeMind's structured reasoning workflow and custom agents.
- Connecting to the configured AI provider through a replaceable provider interface.
- Reading and writing repository files, managing branches and pull requests, dispatching workflows, and inspecting workflow runs through GitHub.
- Starting browser-automation work through Playwright-based GitHub Actions runners.
- Reviewing activity, classified failures, and integrity checks instead of losing failures inside chat output.
- Applying project-local scope and authorization checks before sensitive operations.

ForgeClaw does not claim to be a general-purpose autonomous replacement for engineering judgment. Operators remain responsible for credentials, repository permissions, deployment choices, and review of generated changes.

## Current runtime

The active application path uses the Local Inference provider by default, with Anthropic and Moonshot available as explicit alternatives behind the shared provider interface. Local Mode communicates with an OpenAI-compatible llama.cpp server at `http://127.0.0.1:8080/v1`.

The operator supplies provider credentials through the application's settings flow. Credentials are not intended to be committed to the repository.

## Main capabilities

### Structured agent execution

ForgeMind and specialist agents use contracts, tool definitions, failure classification, and observable execution state. The orchestration layer is intended to make assumptions and failed actions easier to inspect and correct.

### GitHub operations

The GitHub integration supports repository metadata, file reads and writes, tree inspection, branch operations, pull requests, workflow dispatch, and workflow-run inspection. Repository writes should be performed on a reviewable branch whenever possible.

### Browser automation

Playwright scripts can be run through the repository's automation workflow. This keeps browser automation separate from the browser UI and makes the execution path easier to reproduce in CI.

### Safety and integrity checks

The application includes project-local checks for scope, action impact, identity, contracts, and integrity. These are ordinary application controls implemented in this repository; they are not a dependency on a proprietary platform or service.

### Failure visibility

Failures are classified and surfaced in the Activity area. The current code distinguishes categories such as tool, authentication, network, dependency, invalid-assumption, user-constraint, and unknown failures.

## Architecture

```text
src/
  lib/ai/
    providerRouter.ts          Provider selection and runtime boundary
    types.ts                   Shared provider and error types
    providers/                 Provider adapters
  lib/
    agentCore.ts               Agent contracts, failure classes, and action checks
    modelProviders.ts          AI-model bridge used by ForgeMind and agents
    managedAgent.ts            Managed agent execution loop
    forgeTools.ts              Tool definitions exposed to agents
    github.ts                  GitHub API client and repository operations
    supabase.ts                Optional Supabase client
  hooks/
    useOrchestrator.ts         Agent contracts and admission checks
    useIntegrityGate.ts        Integrity checks and unknown-state ledger
    useErrorBus.ts             Centralized failure emission
  components/
    FailureDashboard.tsx       Failure view rendered from Activity
    AgentsPanel.tsx             Custom-agent interface
    ProviderStatusBadge.tsx    Provider state and test status

engine/
  server.ts                    Optional server-side runtime

scripts/
  browser-automation.js        Playwright automation entry point
  setupGitHooks.mjs            Local commit-hook setup
```

## Technology stack

| Layer | Technology |
| --- | --- |
| UI | React 19 + TypeScript |
| Build | Vite |
| Styling | Tailwind CSS |
| State | Zustand |
| AI runtime | Local llama.cpp provider by default; Anthropic and Moonshot alternatives |
| GitHub API | Octokit REST |
| Optional backend | Supabase Edge Function |
| Browser automation | Playwright |
| CI/CD | GitHub Actions |
| Database support | SQLite audit logging in the application path; optional Supabase integration |

## Quick start

```bash
npm install
npm run setup:hooks
npm run dev
```

Before creating a production build, run:

```bash
npm run build
npm run lint
npm run test:run
```

If a script is not available in the current checkout, inspect `package.json` and use the repository's installed package-manager scripts rather than assuming a command exists.

## Configuration

Copy the example environment files when a local or server-side configuration is needed:

```bash
cp .env.example .env
cp engine/.env.example engine/.env
```

Keep API keys, service-role keys, and GitHub tokens in local environment configuration or the application's secure settings flow. Never commit credentials, generated secrets, or private customer data.

## Repository-write guidance

For safe development workflows:

1. Create a feature branch.
2. Make the smallest coherent change.
3. Run the relevant build, lint, and test commands.
4. Review the diff and generated artifacts.
5. Open a pull request or merge only after the change is understood.

The repository's local commit hook can enforce the project commit format and validation notes. The hook is a development aid, not a substitute for code review.

## Project principles

- **Operator control:** consequential actions should be visible and reviewable.
- **Provider independence:** AI-provider integration belongs behind replaceable interfaces.
- **No hidden credentials:** secrets stay out of source control and logs.
- **Failure transparency:** failures should be classified, recorded, and actionable.
- **Portable implementation:** the project should remain understandable and runnable without proprietary platform dependencies.
- **Evidence over claims:** documentation should describe implemented behavior, not planned behavior as if it already exists.

## License

ForgeClaw is released under the MIT License. See [LICENSE](LICENSE).

## Disclaimer

ForgeClaw is an evolving software project. Review permissions, credentials, generated code, browser actions, CI workflows, and deployment changes before running them against important repositories or systems.
