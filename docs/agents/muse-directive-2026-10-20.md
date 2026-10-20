# Directive for Muse — ForgeClaw heavy lifting, 2026-10-20

**From:** Claude (lead on this workstream), on behalf of Cristian Nunez.
**Scope:** the assignments in §3 only. Anything else needs Cristian's explicit OK first.
**Why this exists:** work is moving fast across shared files. These rules keep your work and mine
from colliding, and make every hand-off checkable.

## 1. Ground truth you start from

- **Base:** branch from **latest `main`**, never from an older branch or a merged PR's branch.
  - Merged work includes #164 (Kimi/Claude fixes, site deploy, search proxy).
  - The follow-up PR from `claude/code-search-proxy-workflow-d37e2y` has:
    - Qwen3-8B as the model behind the "DeepSeek 16B" provider
    - deep research
    - build-step sites
    - the DeepSeek site and self-sculpt chains
    - the NEXUS page
    - offered-tools-only Guardian
    - token diagnostics
    - opt-in GPU
- **Model:** the provider and workflow are still *named* DeepSeek 16B; that's legacy. The checkpoint is `Qwen/Qwen3-8B`. Don't "fix" the label back.
- **Governance:** read `docs/founder-principles.md` and `.claude/skills/forgeclaw-project-conventions` before you change anything.

## 2. Hard rules (non-negotiable)

1. **Don't touch these without Cristian's written, named OK in the PR thread:**
   - **Protected paths:** everything in `.github/protected-paths.txt`. That covers `.github/`, `package*.json`, build configs, `scripts/`, `src/lib/guardianGate.ts`, `src/lib/forgeTools.ts`, `engine/`, `foundation/` and `LICENSE*`.
   - **Shared files:** `src/App.tsx`, `src/lib/ai/providerRouter.ts`, `src/lib/toolExposure.ts`, `src/lib/managedAgent.ts`, `src/lib/githubPublish.ts`, `src/lib/workflowRun.ts`. I'm actively changing these, and parallel edits there will conflict.
2. **One PR per assignment**, opened as a **draft**, from its own branch (`muse/<short-name>`). Never push to `main`, never merge, never force-push someone else's branch.
3. **No silent behaviour changes.** Don't remove, skip, weaken or `.skip` a test to get green. If a test is wrong, say why in the PR and change it in a separate commit with that reason.
4. **Evidence or it didn't happen** (NEXUS: *My Logic Is Undeniable*):
   - Each PR body lists the exact commands you ran, their exit codes, and what remains unverified.
   - "Dispatched", "should work" and "fixed" without output don't count.
5. **No secrets:** never paste tokens or keys into code, tests, PRs or chat. Use placeholders like `ghp_xxxx`.
6. **Pins:** runners are `ubuntu-24.04`. Dependencies use exact versions that are at least 2 weeks old. Don't upgrade anything I didn't ask for.
7. **Stuck means stop:** if you're blocked for more than 2 attempts, stop and report the blocker with its evidence. Don't improvise around Guardian or the protected-path checker.

## 3. Your assignments (in priority order)

### A. Live acceptance run, report only, no code
Run `docs/live-acceptance-test-2026-10-20.md` against the deployed site after the follow-up PR merges.
- Fill in its Results table: PASS/FAIL, run links, commit SHAs, site URLs.
- **Output:** one comment on the follow-up PR with the filled table. No code changes.

### B. NEXUS page polish (`src/components/NexusLearningPanel.tsx` only)
- Make it readable on a 375 px phone: no horizontal scroll, and the table either scrolls inside its card or collapses.
- Add Spanish strings through `src/lib/i18n.ts` keys, prefixed `nexus.`. Keep `NEXUS_MOTTO` in English; it's a brand line.
- **Don't change** `src/lib/nexusLearning.ts` logic or its tests.
- **Tests:** keep `npx vitest run src/lib/i18n.test.ts src/appLanguage.test.tsx` green, and add a render test for the phone layout.

### C. Tests that still have gaps (test files only)
- `src/lib/deepResearch.test.ts`: research output exactly at the 40,000-character limit.
- `src/lib/siteBuild.test.ts`: a mirror tree listing that comes back `truncated: true`.
- `src/lib/nexusLearning.test.ts`: 1,000+ candidates, check that summarizing takes under 50 ms.
- **No production changes.** If a test shows a real bug, open an issue with the failing test attached instead of fixing it.

### D. Docs (`docs/` only)
- **User guide:** `docs/user-guide-sites-research-sculpt.md`. It covers how to ask ForgeClaw for a site, a build-step site, research, and a self-sculpt, with real example prompts and expected tool sequences, taken from the acceptance test.
- **Known limits section:** DeepSeek/Qwen runs on a CPU at about 3–4 tok/s, a file over 8,000 characters is too large for the DeepSeek sculpt route, and Pages deploys need a public repo.

## 4. Hand-off format (every PR)

```
## What changed
<files, one line each>
## Evidence
<command> -> exit <code>   (paste the summary line, e.g. "Tests 868 passed")
## Not verified
<what you could not check and why>
## Touches protected/shared files?
No / Yes: <file> - authorized by Cristian on <link>
```

## 5. What I'm doing in parallel (so we don't collide)

- Public-visitor mode: the relay plus making visitors use the hosted model without Cristian's session.
- Any change to `App.tsx`, the provider router, tool exposure, Guardian, `forgeTools.ts` and every workflow.

If you need any of those changed, write the request in your PR and I'll make the change.
