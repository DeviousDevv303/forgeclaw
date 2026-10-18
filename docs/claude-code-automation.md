# Claude Code Automation Layer

**Status:** Implemented on feature branch `feat/claude-automation-hardening`.

## Purpose

This layer gives local Claude Code sessions the same conservative posture already used by ForgeClaw’s autonomous GitHub workflows. It does not grant Claude new runtime authority, bypass Guardian controls, dispatch workflows, write secrets, merge pull requests, or modify protected policy.

The design follows the Founder’s Principle: capability may evolve when improvement is demonstrated against verified reality, while constitutional authority remains unchanged. It also follows the project completion standard: a concept is not complete until it is implemented, validated, and recorded with a documentation trail.

## Implemented components

- `.claude/hooks/protected-path-guard.py` — `PreToolUse` guard for Edit/Write/MultiEdit. It reads `.github/protected-paths.txt` as the policy source, denies `.env` writes and credential-shaped content, asks before protected-path edits, fails closed if policy loading fails, and records non-secret decisions in the ignored audit log.
- `.claude/settings.json` — registers the local guard for Edit, Write, and MultiEdit.
- `.claude/skills/forgeclaw-verify/SKILL.md` — user-invoked, read-only pre-PR verification procedure. It reports branch, changed paths, protected-path results, validation commands, warnings, and unverified live behavior.
- `.claude/skills/forgeclaw-project-conventions/SKILL.md` — Claude-only project context for Guardian boundaries, evidence semantics, protected paths, credentials, and branch/PR-only landing.
- `.claude/agents/guardian-reviewer.md` — read-only review for governance, protected-path, operator-control, and constitutional regressions.
- `.claude/agents/integration-evidence-reviewer.md` — read-only review for workflow dispatch, provider, browser, shell, artifact, correlation, retry, and evidence regressions.
- `src/scripts/claudeTooling.test.ts` — regression coverage for policy delegation, absolute paths, `.env` and credential denial, fail-closed behavior, settings registration, skill invocation policy, and reviewer read-only constraints.

## Explicit boundaries

This implementation intentionally does not change `.github/workflows/`, `.github/protected-paths.txt`, Guardian/tool-dispatch code, `foundation/`, package manifests, lockfiles, or the frozen runtime/model/build configuration. No workflow was dispatched and no live external side effect was attempted during implementation.

The hook asks before a protected edit; an ask/approval is not a named Tier-2 authorization. Cristian’s authorization rules remain authoritative for Tier-2 paths.

## Validation record

Validation is run on the feature branch before push and must be repeated after any later change:

```text
PYTHONDONTWRITEBYTECODE=1 npx tsc -p tsconfig.app.json --noEmit
PYTHONDONTWRITEBYTECODE=1 npx eslint src
PYTHONDONTWRITEBYTECODE=1 npx vitest run
PYTHONDONTWRITEBYTECODE=1 npm run build
```

The implementation’s local guard tests are mutation-oriented: they assert behavior through the actual Python hook process and would fail if policy delegation, credential denial, fail-closed handling, or Claude registration were removed. Live workflow execution, deployment, external browser sessions, and production side effects remain **not verified** by this change.
