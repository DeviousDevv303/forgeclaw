# User guide: sites, research and self-sculpt

How to ask ForgeClaw for four things: a static website, a website with a build step, a deep research answer, and a change to its own code (self-sculpt). The example prompts and expected tool sequences come from the live acceptance test (`docs/live-acceptance-test-2026-10-20.md`).

> **Status of this guide.** These sequences are what the code and the acceptance plan *expect*. The
> interactive live-acceptance steps (A–F, H–K) have not been run against the deployed app yet, so
> treat a sequence as the target behaviour, not a recorded result. Watch the **Activity** panel: it
> shows each tool call and whether it succeeded. A step is done only when its tool shows ✅. Text that
> says "deployed" with no tool result behind it isn't evidence.

## Before you start

| You need | Where | Used by |
|---|---|---|
| GitHub token: classic PAT with `repo` + `workflow`, or fine-grained with Contents, Actions, Pages and Administration (Read and write) | SETTINGS → GitHub token | everything below |
| Kimi key (Moonshot) or Claude key (Anthropic) | SETTINGS → provider → **TEST … KEY** | sites, research; optional for `/sculpt` |
| Self-sculpt key: a phrase of 12+ characters, unlocked | SETTINGS → **Self-sculpt key** | self-sculpt only |
| Autonomy posture `operator-shell` (the default) | the autonomy button above the chat input | sites run without a co-sign prompt; switch to `full-cosign` to approve each write yourself |

If a GitHub step fails, the error names the missing scope or permission, for example
`(this call needs the scope repo; the token has scopes: public_repo)`. Fix the token and ask again.

## 1. A static website

**Ask (Kimi or Claude selected):**

```
build me a landing page website for a coffee shop called Night Owl and deploy it
```

**Expected tool sequence:**

1. `github_create_repo` creates a new **public** repository under your account.
2. `github_publish_site` makes **one** call with every file. The result is one commit on `gh-pages` holding all files plus `.nojekyll`, and the commit message ends with `ForgeClaw-Site: true`.
3. `github_pages_status` shows `built`.
4. The reply gives `https://<you>.github.io/<repo>/`.

**With the DeepSeek provider** (Qwen3-8B on a CPU runner; 12–20 minutes):

```
build me a simple landing page website for a bakery called Rise and Shine and deploy it
```

`deepseek_reason` → `github_create_repo` → `github_publish_site` → `github_pages_status` → "Your site is live: …".
The reply "DeepSeek returned an incomplete or repetitive page … nothing was published" is also a correct outcome. It means the safety check stopped a broken page.

**Guardrails you may hit:**

- Asking to publish into `DeviousDevv303/forgeclaw` is refused (`[TOOL ERROR] refusing to publish into DeviousDevv303/forgeclaw`). Its `gh-pages` branch is the deployed ForgeClaw app.
- A third repository creation in one run is blocked (`[GUARDIAN BLOCKED] … limit 2`).

## 2. A website with a build step (React, Vite, any bundler)

**Ask:**

```
build a small React counter app with Vite and deploy it to GitHub Pages
```

**Expected tool sequence:**

1. `github_create_repo`, if the site doesn't have a repository yet.
2. `github_publish_site` with `enable_pages: false` to branch `source`. This stores the source and doesn't deploy it.
3. `github_build_site` dispatches the **Site Build** workflow in the ForgeClaw repository and takes 2–6 minutes. The reply links the Actions run.
   - The `build` job runs `npm ci && npm run build` (the default) with `contents: read` only.
   - The `mirror` job copies the output directory (default `dist`) to `builds/<id>/` on the `site-builds` branch.
   - ForgeClaw then publishes that output in one commit to the site's `gh-pages`.
4. `github_pages_status` shows `built`, and the URL works.

If the build fails, nothing is published and the error links the run logs (`build run #N concluded "failure"; nothing was published. Logs: …`). Create React App outputs to `build`, not `dist`. Say so in the prompt, or the run finds no output in `dist` and publishes nothing.

## 3. Deep research with cited sources

**Ask (Kimi or Claude):**

```
research the current state of open-source LLMs that run on CPU and compare the top 3
```

**Expected tool sequence:**

1. `deep_research` dispatches the **Deep Research** workflow (up to 6 queries, up to 15 sources), waits for the run, and reads the evidence from the `research-results` branch.
2. The model writes the answer **only from those sources**, cites them as `[1]`, `[2]` …, and ends with a Sources list.

**With DeepSeek:** the same prompt runs `deep_research` first, then `deepseek_reason`, and the answer still cites `[n]`.

If no page could be fetched, the tool result starts with `[TOOL ERROR] deep_research found no readable sources`. The reply must say so instead of answering from memory. Check that the cited URLs open and support the claims.

## 4. Self-sculpt: ForgeClaw proposing a change to its own code

Self-sculpt only ever **proposes** a change as a pull request on a `sculpt/…` branch. Nothing is merged automatically. You review and merge, or close the PR.

**Unlock first:** SETTINGS → Self-sculpt key → set or unlock. While it is locked, every sculpt request gets "Self-sculpt is locked …" and nothing runs.

### `/sculpt` command (works with any provider, or none)

```
/sculpt src/lib/elapsed.ts add a JSDoc comment above each exported function
```

Expected: `github_read_file` → `deepseek_reason` (Qwen3-8B, several minutes) → `sculpt_self` → the reply links a PR. Only the named file changes.

### Asking in plain language (Kimi or Claude)

```
sculpt yourself: tidy src/lib/elapsed.ts
```

Expected: the model reads the file with `github_read_file`, then calls `sculpt_self` (whole-file rewrite) or `shell_patch` (unified diff). The reply links a PR.

### `/patch` command

```
/patch <one-line reason>
<unified diff, git diff format>
```

Runs `shell_patch` directly with your diff.

Guardian-protected paths, such as `package.json`, `src/lib/guardianGate.ts`, `src/lib/forgeTools.ts`, `.github/workflows/` and `foundation/codex/`, are refused by `sculpt_self`.

## Known limits

| Limit | What you see | What to do |
|---|---|---|
| **DeepSeek/Qwen runs on a CPU at ~3–4 tokens/s.** Qwen3-8B (4-bit GGUF) on a GitHub Actions runner measured 3.3–4.1 tok/s (`.github/scripts/deepseek_gguf.py`). | DeepSeek sites take 12–20 min; a `/sculpt` rewrite takes several minutes. The first run after a model change also downloads ~5 GB. | Use Kimi or Claude when speed matters. |
| **A file over 8,000 characters is too large for the DeepSeek sculpt route.** `github_read_file` returns at most 8,000 characters, and `/sculpt` refuses a truncated read instead of rewriting a partial file (`src/lib/ai/deepseekSculpt.ts`). | "Self-sculpt of … stopped before any change: the file is larger than 8,000 characters …" | Use Kimi or Claude in plain language. They can propose a `shell_patch` diff, or you can use `/patch` with your own diff. |
| **GitHub Pages deploys need a public repository** on free GitHub plans. `github_create_repo` makes public repositories by default, and `github_build_site` expects the source in a public repository. | Pages never reaches `built`, or enabling Pages fails. | Keep the site repository public, or use a paid plan that allows Pages on private repositories. |
| Whole-file self-sculpt content is capped at 60 KB (workflow-input limit). | `Self-sculpt content exceeds the 60KB workflow-input limit.` | Use `/patch` or `shell_patch` for large files. |
| Research evidence handed to the model is capped at 40,000 characters. | The result ends with `(N more source(s) omitted for length)`. | Narrow the question, or ask for fewer sources. |
