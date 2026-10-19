# ForgeClaw

> **An operator-controlled AI development and automation console with DeepSeek + CORPUS as its default reasoning stack.**
>
> ForgeClaw combines structured agent workflows, a provider-backed AI runtime, GitHub operations, browser-automation runners, safety checks, and failure visibility in one browser-based workspace.

**Status:** Active development
**License:** Proprietary source-available (see LICENSE)

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

The default provider is **DeepSeek on GitHub Actions** (`DEFAULT_PROVIDER = 'deepseek'`, no API key needed; a GitHub token is). The repository's `deepseek-16b.yml` workflow runs `deepseek-ai/deepseek-llm-7b-chat` on a CPU-only runner: normally a 4-bit GGUF (`TheBloke/deepseek-llm-7B-chat-GGUF`, Q4_K_M) through llama.cpp, with the full float16 model through transformers as a slow fallback, and `deepseek-ai/deepseek-coder-1.3b-instruct` only if the primary cannot run. The "16B" in the name is legacy: no 16B model runs. With the GGUF engine a short answer took about 2 minutes on 3 runs (before it, 10–17 minutes); long answers take longer at roughly 2 tokens/s. The chat shows elapsed time while it runs. Moonshot/Kimi, Anthropic and local llama.cpp are explicit provider choices.

**Default flow (as implemented):** `User → (greetings answered instantly) → CORPUS context → DeepSeek workflow → (optional ForgeTools execution → real results → DeepSeek continuation) → response`. Side effects stay in ForgeTools behind its Guardian checks.

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

## Capability status

Verified 2026-10-19 against the code and each workflow's last 30 GitHub runs. "Works" means it ran successfully end to end recently, not just that code exists.

| Capability | Tool / workflow | Status |
| --- | --- | --- |
| Reasoning (default chat) | `deepseek_reason` / `deepseek-16b.yml` | Works (24 of last 30 succeeded; the rest were cancelled by STOP). 10–17 min per answer on the old engine; about 2 min for a short answer on the GGUF engine (3 runs, not yet verified from `main`). |
| Web search | `web_search` / `ddg_search.yml` (or Brave with a key) | Works (15 of 15). |
| Image generation | `generate_image` / `generate-image.yml` | Works (28 of 30). |
| Shell commands | `shell_exec` / `shell-exec.yml` | Works. Runs report the command's own exit code, so a failing command shows as a failed run. |
| GitHub repo read/write, issues, runs, logs | `github_*` tools | Works with a GitHub token. |
| Image analysis | `analyze_image` / `image-analyze.yml` | **Was broken 2026-10-19:** the workflow failed at import (`AutoModelForVision2Seq` was removed from `transformers`). Workflow fixed (Qwen2-VL via `.github/scripts/analyze_image.py`); not yet run live from `main`. The tool still only dispatches; showing the result in the chat needs `executeTool()` work. |
| Code review | `review_code` / `code-review.yml` | **Was broken 2026-10-19:** loaded CodeLlama-7B in float32 (~28 GB) on a 16 GB runner and was killed. Workflow fixed (DeepSeek-Coder-6.7B Q4_K_M GGUF via `.github/scripts/review_code.py`); not yet run live from `main`. The tool still only dispatches; showing the result in the chat needs `executeTool()` work. |
| Browser automation | `browser-automation.yml` | **Was broken 2026-10-19:** `scripts/browser-automation.js` used `require` in an ES-module package, and Playwright was not a dependency. Fixed (`scripts/browser-automation.cjs` + pinned Playwright); not yet run live from `main`. Not exposed as a chat tool. |
| Self-sculpt / shell repair | `sculpt_self`, `shell_patch` | Mixed: recent runs mostly fail at their validation steps; under review. |
| Gmail, Calendar, WhatsApp | `gmail_*`, `calendar_*`, `send_whatsapp` | Need your own OAuth/API credentials in Settings; not verified here. |
| `http_fetch`, `run_js` | browser-side | Work within browser limits (`http_fetch` is subject to the target site's CORS policy). |

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

engine/
  server.ts                    Optional server-side runtime

scripts/
  browser-automation.cjs       Playwright automation entry point
  setupGitHooks.mjs            Local commit-hook setup
```

## Technology stack

| Layer | Technology |
| --- | --- |
| UI | React 19 + TypeScript |
| Build | Vite |
| Styling | Tailwind CSS |
| State | Zustand |
| AI runtime | DeepSeek workflow + CORPUS context; optional llama.cpp and Anthropic adapters |
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

## Founder’s Principle, Motive, and completion standard

ForgeClaw’s foundational governance distinguishes evolving capability from immutable authority: **Founder’s principles → Codex Anima / Guardian foundation → ForgeClaw / NEXUS behavior**. The canonical wording, scope, and relationship to CORPUS are maintained in [Founder’s Principle, Motive, and Completion Standard](docs/founder-principles.md). This is foundational governance, not ordinary runtime configuration, and is also presented read-only in the product Settings surface.

## License

ForgeClaw is source-available, not open source. It is released under the **ForgeClaw Proprietary Source-Available License**: you may view and study the code, self-host one private non-commercial instance, keep a private fork for experimentation, and submit pull requests. Commercial use, hosted deployment for others, redistribution, and rebranding are not permitted without a separate written agreement. [LICENSE](LICENSE) is the authoritative text.

## Disclaimer

ForgeClaw is an evolving software project. Review permissions, credentials, generated code, browser actions, CI workflows, and deployment changes before running them against important repositories or systems.
