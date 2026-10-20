# User guide: sites, research, and self-sculpt

This guide covers four common ForgeClaw tasks: creating a straightforward website, building a site that needs a bundler, gathering research evidence, and proposing a guarded self-sculpt. The example prompts and expected sequences below are taken from the [2026-10-20 live acceptance checklist](live-acceptance-test-2026-10-20.md). A listed sequence is what to look for in Activity; it is not evidence that a run succeeded. Verify the returned workflow/repository result and, for Pages, open the published URL.

## Before you start

For GitHub-backed tasks, configure a GitHub token in ForgeClaw Settings. The live acceptance checklist calls for a classic token with `repo` and `workflow` scopes, or a fine-grained token with the required Contents, Actions, Pages, and Administration permissions. If a GitHub operation reports a missing scope, use that error to identify the permission to correct; do not paste a token into a prompt.

For a Pages site on GitHub's free plan, use a **public** repository. The site tools publish to `gh-pages` rather than `main`; keep source on a separate branch when using a build step.

## 1. Ask ForgeClaw for a simple website

With **Moonshot · Kimi** selected, send the acceptance-test prompt:

> build me a landing page website for a coffee shop called Night Owl and deploy it

Expected Activity sequence:

1. `github_create_repo` creates the site's repository.
2. `github_publish_site` writes the complete static site in one publish operation.
3. `github_pages_status` confirms Pages is `built` for the published commit.

The reply should include a `https://<owner>.github.io/<repo>/` URL. Open it and check that the page loads and matches the request. In the repository, the published `gh-pages` branch should contain the site files plus `.nojekyll` in one commit; the acceptance checklist expects the commit message to end in `ForgeClaw-Site: true`.

## 2. Ask for a site with a build step

For a React/Vite, npm, or other bundled app, send:

> build a small React counter app with Vite and deploy it to GitHub Pages

Expected sequence from the acceptance checklist:

1. Store the source in a public repository with `github_publish_site`, using `enable_pages: false` and branch `source`. This stores source; it does not enable Pages yet.
2. `github_build_site` dispatches the **Site Build** Actions workflow to build that source and publish the output to `gh-pages`.
3. `github_pages_status` confirms the deployed commit is `built`.

Check that the reply links to the actual **Site Build** Actions run, then open the returned site URL. In the workflow run, the build job should have read-only Contents permission; the mirror job records the generated output under `builds/<invocation-id>/` on the `site-builds` branch. ForgeClaw then publishes the mirrored build output to the site's `gh-pages` branch in one commit.

## 3. Ask ForgeClaw to research a question

With **Kimi** selected, use the acceptance-test example:

> research the current state of open-source LLMs that run on CPU and compare the top 3

Expected sequence: `deep_research` runs the **Deep Research** Actions workflow, gathers pages, and returns numbered evidence. The answer should cite only those sources as `[1]`, `[2]`, and so on, with a Sources list whose URLs open and support the claims.

The acceptance checklist also tests the same prompt with **DeepSeek 16B** selected. There, expect `deep_research` first and then `deepseek_reason`; the final answer still needs to cite the numbered research evidence. If the research run finds no readable sources, ForgeClaw should say that it gathered no usable sources rather than answering the research question from memory.

## 4. Ask ForgeClaw to self-sculpt one file

Self-sculpt is a guarded proposal flow, not an automatic merge. In Settings, set a self-sculpt key phrase of at least 12 characters and unlock it. The acceptance checklist first checks the locked case: lock the key and send:

> /sculpt src/lib/elapsed.ts add a JSDoc comment above each exported function

Expected while locked: ForgeClaw says self-sculpt is locked and runs no change workflow. Unlock the key again for the actual example. With any provider selected—or without a provider key—send the same `/sculpt` prompt.

Expected Activity sequence:

1. `github_read_file` obtains the target file.
2. `deepseek_reason` sends the rewrite request through the existing code-profile workflow.
3. `sculpt_self` validates the proposed replacement and opens a pull request on a `sculpt/*` branch.

Open the PR and review the change. It should change only the requested file; the workflow does not merge it automatically. The acceptance checklist also covers ordinary Kimi chat with:

> sculpt yourself: tidy src/lib/elapsed.ts

For that provider-driven phrasing, expect Kimi to read the file and call `sculpt_self` or `shell_patch`; the reply should link the resulting PR. Keep the self-sculpt key unlocked only for work you intend to authorize.

## 5. Send a picture

Attach a picture with 📎 and ask about it, for example "what is this?". With **Kimi** or **Claude**, the model sees the picture itself and answers right away. With **DeepSeek 16B**, Activity shows `analyze_image`. The **Analyze Image** Actions run takes a few minutes, and the answer ends with "(Looked at by Qwen/Qwen2-VL-2B-Instruct · run …)".

For that analysis, the picture is stored on the private `vision-inputs` branch, then removed from the branch's tip once the analysis finishes. It stays in that branch's history until the branch is deleted.

Free mode can't read pictures yet, and says so instead of guessing.

## 6. Free mode for friends and family

Visitors with nothing configured use ForgeClaw's own model through the owner's relay, and answers take a few minutes. Questions about recent events run live web research first, and the answer cites `[n]` sources. Conversations and errors are shared with the developer, as the yellow note on screen says. Visitors don't see the owner's keys, tools, chats or the NEXUS tab.

## Known limits

- **CPU inference is slow.** The workflow/provider label remains “DeepSeek 16B” for continuity, but the current primary workflow model is Qwen/Qwen3-8B in a 4-bit GGUF on a CPU runner, at approximately **3–4 tokens per second**. A first run may also wait for the model cache to be populated. Allow several minutes; website-generation acceptance runs have been estimated at roughly 12–20 minutes.
- **DeepSeek self-sculpt needs the whole file.** The `github_read_file` tool returns at most the first 8,000 characters and marks longer content as truncated. The DeepSeek `/sculpt` rewrite relies on that read as the complete source, so a file over **8,000 characters is too large for the DeepSeek sculpt route**. Choose a smaller file or use an explicitly reviewed, narrow patch workflow where appropriate; do not treat a truncated read as the full file.
- **Free-plan Pages deployments need a public repository.** Create/use a public site repository before asking ForgeClaw to deploy. Private repository Pages availability depends on the repository's GitHub plan and settings; this guide's free-plan path assumes public visibility.
- **Evidence matters.** A tool name appearing in a plan or assistant message is not proof it ran. Check Activity for the actual tool result, follow the linked Actions run when applicable, confirm `github_pages_status`, and open the live URL. Use the acceptance checklist's results table to record each live result, run URL, and commit. Steps requiring an operator's provider keys or in-app interaction remain operator-run checks.
