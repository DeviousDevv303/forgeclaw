# Handoff directive for Manus — continue ForgeClaw from Claude, 2026-10-20

**Authority:** Cristian Nunez (owner). This file is the complete state; you don't need the chat.
**Your role:** finish verification and operational setup support. **Don't redesign anything.**

## 1. Where things stand (verified)

- **Merged to `main`:** PR #164 and PR #165 (head `dc31bdd`). CI `build` was green on both.
- **Tests at merge:** `npx vitest run` gives 894 passed and 8 skipped across 104 files. `python3 -m unittest discover -s .github/scripts` passes 52. Lint has 0 errors. The build passes.
- **Already proven live on GitHub Actions:**
  - `self-sculpt.yml` run 39362448179 and `shell-repair.yml` run 39362463489 both succeeded.
  - They opened PRs #166 and #167, each with exactly the intended file. Both PRs are closed.
  - Their branches still exist: `sculpt/live-smoke-202610200305` and `forge/repair/repair-live-smoke-202610200305`. Cristian deletes them with the button on each closed PR.
- **Proven only in a container (not yet on Actions), using the real Qwen3-8B model:**
  - The `site` profile produced a complete one-page site.
  - The `code` profile produced a complete file rewrite with indentation preserved.
  - `deep_research.py` fetched 5 live sources.

## 2. What exists now (read these, don't rewrite them)

| Feature | Where |
|---|---|
| "DeepSeek 16B" provider actually runs **Qwen/Qwen3-8B** (4-bit GGUF, CPU, 8K context). Leave the label as is. | `.github/workflows/deepseek-16b.yml`, `.github/scripts/deepseek_gguf.py` |
| Opt-in GPU runner, set by repo variable `FORGECLAW_GPU_RUNNER` (paid org plans only) | `deepseek-16b.yml` |
| Kimi and Claude tool loops (reasoning_content, 16K tokens, truncated-call guard) | `src/lib/ai/providers/*` |
| Site publish and deploy tools, build-step sites | `src/lib/githubPublish.ts`, `src/lib/siteBuild.ts`, `.github/workflows/site-build.yml` |
| Deep research | `.github/workflows/deep-research.yml`, `.github/scripts/deep_research.py`, `src/lib/deepResearch.ts` |
| Self-sculpt: tools, `/sculpt`, `/patch`, owner key | `src/lib/sculptCommand.ts`, `src/lib/sculptKey.ts`, `src/lib/ai/deepseekSculpt.ts` |
| NEXUS Recursive Learning page ("My Logic Is Undeniable") | `src/components/NexusLearningPanel.tsx`, `src/lib/nexusLearning.ts` |
| Free public mode, central learning, error reports | `relay/` (Cloudflare Worker), `src/lib/publicRelay.ts`, `src/lib/errorReporting.ts` |

## 3. Your tasks, in order

### T1. Live Actions verification (no code changes)
Run these and record each run URL and conclusion:
1. Actions → **DeepSeek 16B** → Run workflow with `task="What is 17 * 23? One line."`, `invocation_id=manus-qwen-1`.
   - **PASS:** success, and `result_meta.txt` in the artifact shows `model=Qwen/Qwen3-8B` and `engine=llama.cpp GGUF Q4_K_M`.
   - The first run downloads about 5 GB, so it's slower than later runs.
2. Actions → **Deep Research** with `question="Which open-source LLMs run well on CPU in 2026?"`, `invocation_id=manus-research-1`.
   - **PASS:** success, and the `research-results` branch has `research-results/manus-research-1.json` with at least 1 source.
3. Actions → **Code Search Proxy** with `query="useState repo:evil/x"`, `invocation_id=manus-search-1`.
   - **PASS:** the artifact's `result.json` lists only `DeviousDevv303/forgeclaw` paths.
4. Check that the latest **Deploy to GitHub Pages** run on main succeeded and the site loads.

### T2. Help Cristian deploy the relay (he does the account steps)
- Walk him through `relay/README.md` step by step. **Never ask him to paste a token or key into chat.**
- Then run the README's "Check it" section and **acceptance-test step K**.

### T3. Full acceptance test
- Run `docs/live-acceptance-test-2026-10-20.md`, steps A–K.
- Write the filled Results table as a comment on PR #165.

### T4. Coordinate Muse
- Muse's directive is `docs/agents/muse-directive-2026-10-20.md`. Since #165 is merged, Muse now branches from **main**.
- Assignments: B (NEXUS page phone layout and Spanish), C (test gaps), D (docs).

## 4. Rules (same as Claude worked under)

1. **Protected paths:** everything in `.github/protected-paths.txt`, plus `src/lib/forgeTools.ts`, `src/lib/guardianGate.ts` and `relay/`. Don't change them without Cristian's written, named OK.
2. **Branches and merging:** use `manus/<name>` branches and draft PRs only. Never push to main and never merge; Cristian merges.
3. **Evidence:** every claim needs a run URL, command output or commit SHA. "Dispatched" isn't "done".
4. **Tests:** never skip or weaken a test to get green. A failing test that is genuinely wrong gets its own commit with the reason.
5. **No secrets in code, docs, issues or chat.**
6. **Self-sculpt stays locked behind Cristian's key.** Never ask for the key.
7. **Stuck means stop.** After 2 failed attempts, report what's blocking, with evidence.

## 5. Known limits (don't try to "fix" these without asking)

- **Speed:** Qwen3-8B on the free CPU runner takes minutes per answer (about 3–4 tok/s).
- **DeepSeek `/sculpt`:** only works on files up to 8,000 characters. Bigger files use Kimi or Claude with `shell_patch`.
- **Free mode** needs the relay deployed (Cloudflare, Cristian's account).
- **Error emails** need a Resend key on the relay.
- **GitHub GPU runners** need a paid organization plan.
