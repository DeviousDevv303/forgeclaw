# DeepSeek full-stack trace — 2026-10-06

## Verified baseline

- GitHub `main` HEAD: `3675d16e485d3992fe25382f7c17a08520f31947`.
- The live Settings panel reported build commit `3675d16e485d` and the live JavaScript bundle contained the same marker.
- The Pages deploy and Build Gate for that SHA completed successfully.
- A real DeepSeek workflow run on that SHA completed successfully and produced both a mirror result and an artifact.

## Defect found

The frontend exposes both `github_repo_state` and `deepseek_reason` for repository-oriented coding requests. In `sendViaRouter`, the DeepSeek bootstrap ran before the repository-evidence bootstrap. That allowed the workflow to receive a repository question without the verified `HEAD` result from ForgeTools. The observed run returned a malformed identity placeholder instead of the actual commit, proving that the text response was not repository evidence.

## Fix

`github_repo_state` now has precedence whenever it is available and the current request is repository-oriented. Only after that result is appended to the conversation can the router dispatch `deepseek_reason`. Existing DeepSeek-only requests remain unchanged.

The Pages deployment workflow also stopped passing `VITE_GITHUB_TOKEN` to the public build. `VITE_*` values are embedded in client JavaScript; shipping a PAT there contradicted `githubAuth.ts` and could publish a credential. Live browser users must configure their own scoped token in Settings.

The legacy `nexus` provider alias was also routed consistently through the canonical DeepSeek provider in `modelProviders.ts`. Before this correction, saved-agent/manual-tool calls using `nexus` were incorrectly treated as local-inference calls, which caused tool-mode and Guardian-path diagnostics to fail even though the default UI provider was DeepSeek.

## Validation plan

1. Run the router regression suite proving repository evidence precedes DeepSeek.
2. Run conflict, workflow syntax, lint, TypeScript, full tests, and production build checks.
3. Push the verified commit to `main`; confirm Build Gate and Pages deployment use that SHA.
4. Confirm the live Settings build marker, `main` HEAD, and deployed bundle marker are identical.
5. Exercise read-only repository evidence and DeepSeek through the UI when a scoped browser token is present; do not treat model prose as evidence without the real tool result.
