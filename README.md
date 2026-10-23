# ForgeClaw

> **An operator-controlled AI development and automation console. Its own model runs free on GitHub Actions; Kimi and Claude plug in as hosted reasoners.**
>
> ForgeClaw combines structured agent workflows, a provider-backed AI runtime, GitHub operations, browser-automation runners, safety checks, and failure visibility in one browser-based workspace.

**Status:** Active development
**License:** Proprietary source-available (see LICENSE)

## What ForgeClaw does

ForgeClaw is designed for people who want an AI-assisted development environment that remains observable and operator-controlled. It provides a single workspace for:

- Running ForgeMind's structured reasoning workflow and custom agents.
- Connecting to the configured AI provider through a replaceable provider interface.
- Reading and writing repository files, managing branches and pull requests, dispatching workflows, and inspecting workflow runs through GitHub.
- Building and deploying websites to GitHub Pages, including sites that need a build step.
- Researching questions against the live web, with numbered, cited sources.
- Looking at pictures you attach.
- Proposing changes to its own code (self-sculpt), always as a reviewable pull request behind an owner-only key.
- Learning from every run in NEXUS, the recursive-learning page, with nothing admitted without the owner's signed approval.
- Starting browser-automation work through Playwright-based GitHub Actions runners.
- Reviewing activity, classified failures, and integrity checks instead of losing failures inside chat output.
- Applying project-local scope and authorization checks before sensitive operations.

ForgeClaw does not claim to be a general-purpose autonomous replacement for engineering judgment. Operators remain responsible for credentials, repository permissions, deployment choices, and review of generated changes.

## Current runtime

**Providers** (chosen in Settings):

| Provider | Models | Runs where | Needs |
| --- | --- | --- | --- |
| **DeepSeek 16B** (default; legacy name) | **Qwen/Qwen3-8B**, 4-bit GGUF (Q4_K_M), 8K context, via llama.cpp (`llama-cpp-python` 0.3.36); labelled `deepseek-coder-1.3b` fallback only if it cannot run | `deepseek-16b.yml` on a free CPU runner; opt-in GPU runner | A GitHub token |
| Moonshot · Kimi | Kimi K2.6, K2.7 Code (+ Highspeed), K3 | Moonshot API | A Moonshot key |
| Anthropic · Claude | Claude Haiku / Sonnet / Opus 5.5 | Anthropic API | An Anthropic key |
| Local | llama.cpp server you run | Your machine | — |

Qwen3-8B was chosen by benchmark on the runner's 4 CPU threads (2026-10-20). The old `deepseek-llm-7b-chat` got a two-step time question wrong and looped on HTML; Qwen3-8B answered correctly and completely at 3.3–4.1 tokens/s. A short answer took 43 s with the model cached (run 39439006131). Long answers take minutes; the chat shows elapsed time.

**How a turn runs:**
- **Claude and Kimi** are tool-calling reasoners. They read the repository, run shell commands, research, build and deploy sites, and propose self-sculpt changes through ForgeTools, quoting real tool results.
- **DeepSeek (Qwen)** has no tool loop of its own. The router runs fixed chains for it: picture → analysis; research question → sources → answer; website → generate → repo → publish → verify; "improve <file>" → read → rewrite → pull request.
- Every model is told today's date. Questions about recent events go through live web research first.
- Every side effect goes through ForgeTools and Guardian.

The operator supplies credentials through Settings. They stay in the browser and are never committed to the repository.

## Main capabilities

### Structured agent execution

ForgeMind and specialist agents use contracts, tool definitions, failure classification, and observable execution state. The orchestration layer is intended to make assumptions and failed actions easier to inspect and correct.

### GitHub operations

The GitHub integration supports repository metadata, file reads and writes, tree inspection, branch operations, pull requests, workflow dispatch, and workflow-run inspection. Repository writes should be performed on a reviewable branch whenever possible.

### Websites to GitHub Pages

`github_create_repo` → `github_publish_site` (all files in one commit, `.nojekyll`, Pages enabled) → `github_pages_status` (waits for the build). Sites that need a build step (npm, Vite, React) go through `site-build.yml`: a read-only build job, plus a separate mirror job that runs no model code. Publishing refuses `main`/`master`, `.github/`, and the ForgeClaw repository itself, and a truncated build listing publishes nothing.

### Live web research

`deep_research` runs `deep-research.yml`: up to 6 searches, a server-side fetch of each page, main-text extraction, and numbered evidence. Answers cite `[n]` and say so when nothing usable was found, instead of answering from memory.

### Pictures

Claude and Kimi receive the attached picture directly. With DeepSeek, the picture is analyzed on Actions by Qwen2-VL-2B (`image-analyze.yml`). The picture is removed from the `vision-inputs` branch tip after analysis; it stays in that branch's history until the branch is deleted. Free mode says it can't read pictures yet.

### Self-sculpt

`sculpt_self` (whole file) and `shell_patch` (diff) open a pull request on their own branch, never a direct change. Both are locked behind a **self-sculpt key** only the owner knows. The key is stored as a PBKDF2 hash in the owner's browser, and each unlock lasts 2 hours. `/sculpt <file> <change>` and `/patch` work with any provider, or with none.

### NEXUS recursive learning

The NEXUS page ("My Logic Is Undeniable") counts outcomes, tracks per-tool reliability and recurring failure lessons, and feeds those lessons back into prompts as labelled evidence. Every run, including failures and Guardian blocks, becomes an unapproved candidate. Knowledge converges on its own when a record passes the evidence gate on the owner's five phases (Assumptions, Heuristics, First Principles, Extension, Convergence) and is marked AUTO-ADDED (`nexus-convergence`); failed or blocked runs, visitors' input, and evidence-free answers never converge. The signed-admission path exists in code but has no trusted key in the app, so it is not the live route. NEXUS also mines the owner's own rules of thumb from what he types (approved ones are given to every model) and learns his visual taste from his 🔥 👍 👎 on pictures, measured in the browser with nothing to set up. The NEXUS tab is owner-only.

### Free mode for visitors

A visitor with no GitHub token uses ForgeClaw's own model through the owner's relay (`relay/`, a Cloudflare Worker). Visitors never see the owner's keys, tools, NEXUS or chats. The relay can only run the model and research workflows. It enforces allowed origins, per-IP limits and a concurrency cap. Visitor conversations are stored for the owner to import into NEXUS. The relay also accepts error reports at `POST /v1/errors` (secret-stripped, stored, and emailed to the owner when Resend is configured) — the app's automatic error-report send was removed (2026-10-21), so nothing in the current app posts them.

### Browser automation

Playwright scripts can be run through the repository's automation workflow. This keeps browser automation separate from the browser UI and makes the execution path easier to reproduce in CI.

### Safety and integrity checks

The application includes project-local checks for scope, action impact, identity, contracts, and integrity. Guardian also enforces these rules:
- **Offered tools only:** a model can only run tools offered for this turn.
- **Repo creation cap:** at most 2 repositories can be created per run.
- **Postures:** operator-shell (the default: shell and site deploys run, repository writes need a co-sign), full-cosign, or autonomous.

Paths in `.github/protected-paths.txt` (workflows, manifests, build configs, Guardian and tool dispatch) cannot be changed by autonomous workflows. These are ordinary application controls implemented in this repository, not a dependency on a proprietary platform or service.

### Failure visibility

Failures are classified and surfaced in the Activity area. The current code distinguishes categories such as tool, authentication, network, dependency, invalid-assumption, user-constraint, and unknown failures.

## Capability status

Updated 2026-10-20. "Works" means it ran successfully end to end on GitHub Actions; run IDs are given. "Not verified live" means tested with mocks or in a container only.

| Capability | Tool / workflow | Status |
| --- | --- | --- |
| Reasoning (default) | `deepseek_reason` / `deepseek-16b.yml` | **Works:** Qwen3-8B, run 39439006131 (43 s, cached model). GPU runner not tested. |
| Live web research | `deep_research` / `deep-research.yml` | **Works:** runs 39439011635 (5 sources) and 39449600771 (8 sources, all 2026). |
| Kimi / Claude tool loops | hosted providers | Unit- and app-tested. The live acceptance test (`docs/live-acceptance-test-2026-10-20.md`) is pending. |
| Self-sculpt / shell repair | `sculpt_self`, `shell_patch` | **Works:** runs 39362448179 and 39362463489 opened the intended pull requests. Key gate and `/sculpt` are not verified live. |
| Website deploy | `github_create_repo`, `github_publish_site`, `github_pages_status` | Not verified live (acceptance step C). |
| Build-step sites | `github_build_site` / `site-build.yml` | Not verified live (acceptance step D). |
| Pictures: Claude / Kimi | native image input | **Works with Kimi K2.7 Code** (verified live 2026-10-20: it described an uploaded screenshot correctly). Claude not yet run live. |
| Pictures: DeepSeek | `analyze_image` / `image-analyze.yml` | The Qwen2-VL model ran on main (run 39319037899, URL input). The attached-picture path is not verified live. |
| Free mode (visitors) | `relay/` | Needs the relay deployed or redeployed (`relay/README.md`). Not verified live. |
| Error reports to owner | `relay/` `/v1/errors` + Resend | Needs the relay and a Resend key. Not verified live. |
| Web search | `web_search` / `ddg_search.yml` (or Brave with a key) | Works (15 of 15 on 2026-10-19). |
| Image generation | `generate_image` / `generate-image.yml` | Works (28 of 30 on 2026-10-19). |
| Shell commands | `shell_exec` / `shell-exec.yml` | Works. Runs report the command's own exit code. |
| GitHub repo read/write, issues, runs, logs | `github_*` tools | Works with a GitHub token. |
| Code search proxy | `search-proxy.yml` | Works: run 39465089415, all 10 results scoped to DeviousDevv303/forgeclaw. |
| Code review | `review_code` / `code-review.yml` | Returns the review to the chat (mirror branch). The workflow ran on main (run 39505268990); the review text and the app path end to end are not verified live. |
| Browser automation | `browser-automation.yml` | Fixed 2026-10-19, not verified live. Not a chat tool. |
| Click and browse (cloud browser) | `browser_run` / `browser-agent.yml` | **New, not run live yet.** Free: it uses only GitHub Actions minutes (unlimited on a public repository, your monthly quota on a private one; a round takes a few minutes and a session is capped at 10 rounds) and no paid service. The runner is tested in a real Chromium (browse, click, type, follow links; refuses internal addresses, password fields, downloads); the workflow has never been dispatched. Clicking and typing need your co-sign. NEXUS keeps what worked as a playbook (typed text is never stored); once you approve it, it teaches the browsing agent and DeepSeek. Kimi/Claude only. |
| Gmail, Calendar, WhatsApp | `gmail_*`, `calendar_*`, `send_whatsapp` | Need your own OAuth/API credentials in Settings; not verified here. |
| `http_fetch`, `run_js` | browser-side | Work within browser limits (`http_fetch` is subject to CORS). |

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
    forgeTools.ts              Tool definitions and dispatch (protected)
    guardianGate.ts            Guardian postures and co-sign rules (protected)
    toolExposure.ts            Which tools each turn offers; refusals
    githubPublish.ts           Pages publishing, repo creation, token diagnostics
    siteBuild.ts               Build-step sites via site-build.yml
    deepResearch.ts            Live web research client
    visionInput.ts             Picture analysis on Actions
    workflowRun.ts             Dispatch a workflow and wait for its run
    sculptKey.ts               Owner-only self-sculpt key
    nexusLearning.ts           NEXUS outcome summary and lessons
    publicRelay.ts             Free mode through the relay
    github.ts                  GitHub API client and repository operations
    supabase.ts                Optional Supabase client
  hooks/
    useOrchestrator.ts         Agent contracts and admission checks
    useIntegrityGate.ts        Integrity checks and unknown-state ledger
    useErrorBus.ts             Centralized failure emission
  components/
    FailureDashboard.tsx       Failure view rendered from Activity
    AgentsPanel.tsx             Custom-agent interface

relay/
  worker.js                    Free-mode relay (Cloudflare Worker), see relay/README.md

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
| AI runtime | Qwen3-8B (GGUF, llama.cpp) on GitHub Actions; Moonshot/Kimi and Anthropic/Claude adapters; optional local llama.cpp |
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

Keep API keys, service-role keys, and GitHub tokens in local environment configuration or the application's secure settings flow. Never commit credentials, generated secrets, or private customer data. A test fails if any shipped source contains a credential-shaped string.

Optional repository variables (Settings → Secrets and variables → Actions → Variables):

| Variable | Effect |
| --- | --- |
| `FORGECLAW_PUBLIC_RELAY_URL` | Enables free mode on the deployed site (the relay's URL). |
| `FORGECLAW_GPU_RUNNER` | Runs the model on a GPU larger runner. Needs a GitHub Team/Enterprise organization and is billed per minute. Unset, the free CPU runner is used. |

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
