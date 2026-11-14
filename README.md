# ForgeClaw

> **An operator-controlled AI development and automation console. Its own model runs free on GitHub Actions; Kimi and Claude plug in as hosted reasoners.**
>
> ForgeClaw combines structured agent workflows, a provider-backed AI runtime, GitHub operations, browser-automation runners, safety checks, and failure visibility in one browser-based workspace.

**Status:** Active development
**License:** Proprietary and confidential — all rights reserved (see LICENSE). No use, copying, modification, or distribution except under a separate written license agreement signed by Cristian Nunez.

## What ForgeClaw does

ForgeClaw is designed for people who want an AI-assisted development environment that remains observable and operator-controlled. It provides a single workspace for:

- Running ForgeMind's structured reasoning workflow and custom agents.
- Connecting to the configured AI provider through a replaceable provider interface.
- Reading and writing repository files, managing branches and pull requests, dispatching workflows, and inspecting workflow runs through GitHub.
- Building and deploying websites to GitHub Pages, including sites that need a build step.
- Researching questions against the live web, with numbered, cited sources.
- Looking at pictures you attach.
- Proposing changes to its own code (self-sculpt), always as a reviewable pull request behind an owner-only key.
- Learning from every run in NEXUS, the recursive-learning page: evidence-backed records converge into knowledge on their own (marked AUTO-ADDED); everything else stays an unapproved candidate.
- Starting browser-automation work through Playwright-based GitHub Actions runners.
- Reviewing activity, classified failures, and integrity checks instead of losing failures inside chat output.
- Applying project-local scope and authorization checks before sensitive operations.

ForgeClaw does not claim to be a general-purpose autonomous replacement for engineering judgment. Operators remain responsible for credentials, repository permissions, deployment choices, and review of generated changes.

## Current runtime

**Providers** (chosen in Settings):

| Provider | Models | Runs where | Needs |
| --- | --- | --- | --- |
| **Qwen/Qwen3-8B** (default; provider id `qwen`, formerly labelled "DeepSeek 16B", which it never was) | **Qwen/Qwen3-8B**, 4-bit GGUF (Q4_K_M), 8K context, via llama.cpp (`llama-cpp-python` 0.3.36); labelled `deepseek-coder-1.3b` fallback only if it cannot run | `qwen3-8b.yml` on a free CPU runner; opt-in GPU runner | A GitHub token |
| Moonshot · Kimi | Kimi K2.6, K2.7 Code (+ Highspeed), K3 | Moonshot API | A Moonshot key |
| Anthropic · Claude | Claude Haiku / Sonnet / Opus 5.5 | Anthropic API | An Anthropic key |
| OpenRouter | Any tool-capable OpenRouter model (the Settings field lists the live catalogue with prices); default Claude Haiku 5.5 | OpenRouter API | An OpenRouter key (`sk-or-`) |
| Local | llama.cpp server you run | Your machine | — |
| Nexus Intelligence | The owner's own Run 25 checkpoint (4.48M parameters, 640-token window), served alone | `nexus-intelligence.yml` on a free CPU runner | A GitHub token. A tool-call specialist: not reliable on general questions; image requests are routed to the image generator |
| Muse · Meta | Meta's hosted model | Meta API | A Meta key |

Qwen3-8B was chosen by benchmark on the runner's 4 CPU threads (2026-10-20). The old `deepseek-llm-7b-chat` got a two-step time question wrong and looped on HTML; Qwen3-8B answered correctly and completely at 3.3–4.1 tokens/s. A short answer took 43 s with the model cached (run 39439006131). Long answers take minutes; the chat shows elapsed time.

**How a turn runs:**
- **Claude and Kimi** are tool-calling reasoners. They read the repository, run shell commands, research, build and deploy sites, and propose self-sculpt changes through ForgeTools, quoting real tool results.
- **Qwen** has no tool loop of its own. The router runs fixed chains for it: picture → analysis; research question → sources → answer; website → generate → repo → publish → verify; "improve <file>" → read → rewrite → pull request.
- Every model is told today's date. Questions about recent events go through live web research first.
- Every side effect goes through ForgeTools and Guardian.

The operator supplies credentials through Settings. They stay in the browser and are never committed to the repository.

## Main capabilities

### Structured agent execution

ForgeMind and specialist agents use contracts, tool definitions, failure classification, and observable execution state. The orchestration layer is intended to make assumptions and failed actions easier to inspect and correct.

### GitHub operations

The GitHub integration supports repository metadata, file reads and writes, tree inspection, branch operations, pull requests, workflow dispatch, and workflow-run inspection. Repository writes should be performed on a reviewable branch whenever possible.

### Shell commands

`shell_exec` runs a command through `shell-exec.yml` on a GitHub Actions runner (`bash -c`, working directory repository-relative, 10-minute limit). Facts verified live on 2026-11-13 (run [43346840540](https://github.com/DeviousDevv303/forgeclaw/actions/runs/43346840540)):

- The job starts in a **shallow checkout of `main`**: `pwd` is the repository root, `grep` over the checkout works, and `git diff HEAD~1` needs `git fetch --unshallow` first.
- `git clone` works for public repositories into a **new** directory (`git clone --depth 1 <url> /tmp/x`). Cloning into the checkout itself fails with exit 128, and private repositories cannot be cloned: the runner holds no credential, so it also cannot push.
- The command's own exit code is reported. Commands run with `pipefail` (since 2026-11-13), so `git clone … | tail` reports git's exit 128 instead of the last stage's 0. The runner starts steps with SIGPIPE ignored, so the workflow restores the default (`env --default-signal=PIPE`); a producer cut off by `| head` then exits 141, which is reported as 0 with a `note:` line in the output, so it is never silent.
- Nothing persists between calls. Each call is a separate job (roughly 15 s to 2 minutes).

An operator can type a command (`pwd`, `git diff HEAD~1 --stat`, `grep -rn "x" src`, `git clone …`, or `/shell <cmd>`) and it is dispatched **without a model turn**, under any provider. A prompt that asks for more than the command ("run git diff and tell me what changed") is a task for a tool-calling model (Claude or Kimi); the Nexus Intelligence provider is offered only `nexus_reason`, so it cannot run the shell itself. To change ForgeClaw's own code, edits go out as pull requests through `sculpt_self`, `shell_patch` or `github_write_file`; the shell is for running and inspecting.

### Websites to GitHub Pages

`github_create_repo` → `github_publish_site` (all files in one commit, `.nojekyll`, Pages enabled) → `github_pages_status` (waits for the build). Sites that need a build step (npm, Vite, React) go through `site-build.yml`: a read-only build job, plus a separate mirror job that runs no model code. Publishing refuses `main`/`master`, `.github/`, and the ForgeClaw repository itself, and a truncated build listing publishes nothing.

### Live web research

`deep_research` runs `deep-research.yml`: up to 6 searches, a server-side fetch of each page, main-text extraction, and numbered evidence. Answers cite `[n]` and say so when nothing usable was found, instead of answering from memory.

### Pictures

Claude and Kimi receive the attached picture directly. With Qwen, the picture is analyzed on Actions by Qwen2-VL-2B (`image-analyze.yml`). The picture is removed from the `vision-inputs` branch tip after analysis; it stays in that branch's history until the branch is deleted. Free mode says it can't read pictures yet.

### Self-sculpt

`sculpt_self` (whole file) and `shell_patch` (diff) open a pull request on their own branch, never a direct change. Both are locked behind a **self-sculpt key** only the owner knows. The key is stored as a PBKDF2 hash in the owner's browser, and an unlock stays on in that browser until the owner locks it again (no timed expiry: the owner's choice, 2026-10-20). `/sculpt <file> <change>` and `/patch` work with any provider, or with none.

### NEXUS recursive learning

The NEXUS page ("My Logic Is Undeniable") counts outcomes, tracks per-tool reliability and recurring failure lessons, and feeds those lessons back into prompts as labelled evidence. Every run, including failures and Guardian blocks, becomes an unapproved candidate. Knowledge converges on its own when a record passes the evidence gate on the owner's five phases (Assumptions, Heuristics, First Principles, Extension, Convergence) and is marked AUTO-ADDED (`nexus-convergence`); failed or blocked runs, visitors' input, and evidence-free answers never converge. The signed-admission path exists in code but has no trusted key in the app, so it is not the live route. NEXUS also mines the owner's own rules of thumb from what he types (approved ones are given to every model) and learns his visual taste from his 🔥 👍 👎 on pictures, measured in the browser with nothing to set up. The NEXUS tab is hidden from free-mode visitors; any other browser shows it with that browser's own data plus the records published on the `nexus-intake-data` branch.

### Free mode for visitors

A visitor with no GitHub token uses ForgeClaw's own model through the owner's relay (`relay/`, a Cloudflare Worker). Visitors never see the owner's keys, tools, NEXUS or chats. The relay can only run the model and research workflows. It enforces allowed origins, per-IP limits and a concurrency cap. Visitor conversations are stored for the owner to import into NEXUS. The relay also accepts error reports at `POST /v1/errors` (secret-stripped, stored, and emailed to the owner when Resend is configured) — the app's automatic error-report send was removed (2026-10-21), so nothing in the current app posts them.

### Browser automation

Playwright scripts can be run through the repository's automation workflow. This keeps browser automation separate from the browser UI and makes the execution path easier to reproduce in CI.

### Spiderlings (tool-activity display)

The spiders on the throne rig are a display of **real tool events**, not decoration. A spider leaves the throne at a `TOOL_START`, returns on `TOOL_SUCCESS`, returns trailing red thread on `TOOL_FAILURE`, and is shown as *unresolved* or *unknown* (never "working") when a run ends or outlives its tool's timeout. Every counter on the panel is counted from ledger lines that each trace to one event, so `out = returned + flagged + unresolved + in flight + unknown`. The panel shows when a run starts and hides about 5 s after the last activity. Ambient spiders are a seeded animation, labelled "not tool events, not counted". `?spiders=demo` shows a scripted feed labelled DEMO. Code: `src/lib/spiderlings.ts`, `src/hooks/useSpiderlings.ts`, `src/components/Spider*.ts*`; design notes: `docs/display-layer/spiderlings/README.md`. Limitation: events carry no run id, so two concurrent runs of the same tool can swap outcomes (counts stay right).

### MiroFish swarm simulation (removed)

MiroFish was removed on 2026-11-14 at the owner's direction. The `mirofish_sim` and `mirofish_sim_result` tools, `mirofish-sim.yml`, the runner scripts and their tests, and `docs/mirofish-runner.md` are gone, so nothing in ForgeClaw can start a MiroFish run or spend Moonshot or Zep credit on one. In-house multi-agent work is `spawn_agent` (sub-agents), which is a different mechanism with a different purpose. The sim lane that sat behind it was removed the same day: the sim-grading module, the sim-run and sim-outcome intake schema, the corpus writer for sim runs, the optional "swarm sim" FUSION line (its format, its weight check and its guidance), and the two dead tool names in the evidence gate's deny-list. The sim carried zero weight until its record earned some, which never happened, so no remaining lane's weight moved: the fighter-state read is still capped at 3% and the crowd's rules are unchanged. Old `sim-run` and `sim-outcome` lines still sitting in intake data are skipped by the generic parser (tested), and records already stored in a browser's corpus still load. Left in place on purpose: the Guardian and action-impact entries for `mirofish_sim` (a stale entry is inert, and removing guard entries is a separate decision), the two tool names in the spider ledger's map, the Nexus tokenizer, tool snapshots and training data (hash-pinned model assets), and the chat's display code for old sim-world pictures (not re-tested after the removal).

### Safety and integrity checks

The application includes project-local checks for scope, action impact, identity, contracts, and integrity. Guardian also enforces these rules:
- **Offered tools only:** a model can only run tools offered for this turn.
- **Repo creation cap:** at most 2 repositories can be created per run.
- **Postures:** autonomous (the default: everything runs without a co-sign except merges), operator-shell (shell and site deploys run, repository writes need a co-sign), or full-cosign.

Paths in `.github/protected-paths.txt` (workflows, manifests, build configs, Guardian and tool dispatch) cannot be changed by autonomous workflows. These are ordinary application controls implemented in this repository, not a dependency on a proprietary platform or service.

### Failure visibility

Failures are classified and surfaced in the Activity area (the Failures view lists tool, Guardian, missing-key and missing-token failures). The current code distinguishes categories such as tool, authentication, network, dependency, invalid-assumption, user-constraint, and unknown failures.

## Capability status

Table last verified 2026-10-20; audited 2026-11-12 (notes below the table). "Works" means it ran successfully end to end on GitHub Actions; run IDs are given. "Not verified live" means tested with mocks or in a container only.

| Capability | Tool / workflow | Status |
| --- | --- | --- |
| Reasoning (default) | `qwen_reason` / `qwen3-8b.yml` | **Works:** Qwen3-8B, run 39439006131 (43 s, cached model). GPU runner not tested. |
| Live web research | `deep_research` / `deep-research.yml` | **Works:** runs 39439011635 (5 sources) and 39449600771 (8 sources, all 2026). |
| Kimi / Claude tool loops | hosted providers | Unit- and app-tested. The live acceptance test (`docs/live-acceptance-test-2026-10-20.md`) is pending. |
| Self-sculpt / shell repair | `sculpt_self`, `shell_patch` | **Works:** runs 39362448179 and 39362463489 opened the intended pull requests. Key gate and `/sculpt` are not verified live. |
| Website deploy | `github_create_repo`, `github_publish_site`, `github_pages_status` | Not verified live (acceptance step C). |
| Build-step sites | `github_build_site` / `site-build.yml` | Not verified live (acceptance step D). |
| Pictures: Claude / Kimi | native image input | **Works with Kimi K2.7 Code** (verified live 2026-10-20: it described an uploaded screenshot correctly). Claude not yet run live. |
| Pictures: Qwen | `analyze_image` / `image-analyze.yml` | The Qwen2-VL model ran on main (run 39319037899, URL input). The attached-picture path is not verified live. |
| Free mode (visitors) | `relay/` | Needs the relay deployed or redeployed (`relay/README.md`). Not verified live. |
| Error reports to owner | `relay/` `/v1/errors` + Resend | Needs the relay and a Resend key. Not verified live. |
| Web search | `web_search` / `ddg_search.yml` (or Brave with a key) | Works (15 of 15 on 2026-10-19). |
| Image generation | `generate_image` / `generate-image.yml` | Works (28 of 30 on 2026-10-19). |
| Shell commands | `shell_exec` / `shell-exec.yml` | **Works:** run 43346840540 (2026-11-13): `pwd`, shallow `git clone` into a new directory, `grep`, `git fetch --unshallow` + `git diff --stat`. Runs report the command's own exit code. `pipefail` was added after this run (2026-11-13). A live dispatch (run 43358671825) showed `seq | head` exiting 1 because the runner ignores SIGPIPE; fixed with `env --default-signal=PIPE` and re-verified live on the branch: run 43513771514 (`seq | head` → `exit_code=0` plus the SIGPIPE note) and run 43513775849 (failed `git clone … | tail` → `exit_code=128`, job failed, where it used to be masked as success). Not yet dispatched from `main`: the change lands only when the branch is merged. |
| Spiderlings (tool-activity display) | `src/lib/spiderlings.ts` | Works in the app: 67 tests pass, and in a browser pass (GitHub stubbed) three failed shell calls showed as 3 out / 3 flagged / 0 in flight. |
| GitHub repo read/write, issues, runs, logs | `github_*` tools | Works with a GitHub token. |
| Code search proxy | `search-proxy.yml` | Works: run 39465089415, all 10 results scoped to DeviousDevv303/forgeclaw. |
| Code review | `review_code` / `code-review.yml` | Returns the review to the chat (mirror branch). The workflow ran on main (run 39505268990); the review text and the app path end to end are not verified live. |
| Browser automation | `browser-automation.yml` | Fixed 2026-10-19, not verified live. Not a chat tool. |
| Click and browse (cloud browser) | `browser_run` / `browser-agent.yml` | **New, not run live yet.** Free: it uses only GitHub Actions minutes (unlimited on a public repository, your monthly quota on a private one; a round takes a few minutes and a session is capped at 10 rounds) and no paid service. The runner is tested in a real Chromium (browse, click, type, follow links; refuses internal addresses, password fields, downloads); the workflow has never been dispatched. Clicking and typing need your co-sign. NEXUS keeps what worked as a playbook (typed text is never stored); once you approve it, it teaches the browsing agent and Qwen. Kimi/Claude only. |
| Gmail, Calendar, WhatsApp | `gmail_*`, `calendar_*`, `send_whatsapp` | Need your own OAuth/API credentials in Settings; not verified here. |
| `http_fetch`, `run_js` | browser-side | Work within browser limits (`http_fetch` is subject to CORS). |

Audit notes, 2026-11-12 (run history and a browser pass of the built app):

- `site-build.yml` and `browser-agent.yml` have never been dispatched. `shell-repair.yml`'s latest run (2026-10-21) failed.
- Recent successful runs: `generate-image.yml` (2026-11-10), `nexus-intelligence.yml` (2026-11-12), `ddg_search.yml` (2026-11-08), `qwen3-8b.yml` (2026-11-09), `deep-research.yml` (2026-11-01).
- Workflows not described above: `build-gate`, `deploy`, `channel-watch`, `forgeclaw-loop`, `nexus-loop`, `nexus-intelligence`, `trader-agent`, `owner-exit`, `kalshi-snapshot`, `qwen-bench`, `qwen-cache-keepwarm`, `cpu-image-benchmark`.
- Hosted providers, Gmail/Calendar, WhatsApp, Kalshi funds, the relay and the merge tool were not exercised in this audit.

Audit notes, 2026-11-13 (full-stack pass): lint, `tsc -b` and the full unit suite pass (247 files, 2731 tests); `vite build` was not run. `shell_exec` was dispatched live (see Shell commands). The latest `shell-repair.yml` failure (run 39561708765, 2026-10-21) was `error: corrupt patch at <stdin>:55`: the model wrote a malformed diff and the workflow correctly refused it; it is not a workflow defect. `shell_patch` now checks that every hunk's body matches its `@@` header before dispatching (`src/lib/unifiedDiffCheck.ts`), refusing a malformed diff with the counts instead of spending a runner job; `git apply` in the workflow remains the authority on whether a patch applies. The checker was run over the last 137 hunk-bearing commits (0 false rejections, 137 of 137 corrupted copies caught); `shell_patch` itself was not re-run live. A typed shell command's result bubble no longer carries the active provider/model label.

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
| AI runtime (added since) | The Nexus Intelligence checkpoint on GitHub Actions; Meta and OpenRouter adapters |
| GitHub API | Octokit REST |
| Optional backend | Supabase Edge Function |
| Browser automation | Playwright, installed inside the GitHub Actions workflows (not a dependency of the app) |
| CI/CD | GitHub Actions |
| Database support | Browser storage in the app; SQLite only in the optional `engine/` server; optional Supabase integration |

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

Copyright (c) 2026 Cristian Nunez. All rights reserved. ForgeClaw is proprietary and confidential — not open source and not source-available. No license, express or implied, is granted to any person or entity to use, copy, modify, merge, publish, distribute, sublicense, or sell this software or any part of it, for any purpose, except under a separate written license agreement signed by Cristian Nunez. [LICENSE](LICENSE) is the authoritative text.

## Disclaimer

ForgeClaw is an evolving software project. Review permissions, credentials, generated code, browser actions, CI workflows, and deployment changes before running them against important repositories or systems.
