---
name: forgeclaw-verify
description: Run ForgeClaw's protected-path, type, lint, test and build checks and print an evidence report
disable-model-invocation: true
---

Run the ForgeClaw pre-PR gate and report evidence. Do not fix anything, push, or merge; only report.

1. `git status -sb` and `git rev-parse --abbrev-ref HEAD`; note the branch, HEAD sha, and whether the tree is clean.
2. List changed files against origin/main: `git diff --no-renames --name-only origin/main...HEAD`.
3. Protected paths: `git diff --no-renames -z --name-only origin/main...HEAD | python3 -B .github/scripts/check-protected.py .github/protected-paths.txt`. Exit 1 means a protected path changed: list which, and say whether a named authorization was given.
4. Run, in order, with `PYTHONDONTWRITEBYTECODE=1`, recording the exit code and the counts of each:
   - `npm run check:conflicts`
   - `npx tsc -p tsconfig.app.json --noEmit`
   - `npx eslint src`
   - `npx vitest run`
   - `npm run build`
5. If anything under `.github/` changed, also parse each changed workflow as YAML and say whether `ubuntu-latest` appears.
6. Report: branch/sha, changed files, each command with exit code and test counts, warnings, and a line "Unverified:" listing everything not run (live workflow runs are never verified by this skill). Use the words attempted / completed / verified / blocked precisely; prefer "not verified" to an inferred "complete".
