---
name: forgeclaw-project-conventions
description: ForgeClaw architecture, Guardian, evidence, protected-path, and constitutional development conventions
user-invocable: false
---

Apply these conventions whenever you analyze or change ForgeClaw:

- The Founder's Principle is the governing distinction: capability may evolve through verified evidence; authority belongs to the constitution and does not change automatically.
- Codex Anima / Guardian is the governing foundation; ForgeClaw is the intelligence; NEXUS is the cognitive runtime; CORPUS is memory.
- Preserve operator control. Consequential actions remain visible, reviewable, and behind the existing ForgeTools and Guardian boundaries.
- Treat states precisely: attempted is not completed, and completed is not verified. A dispatch, accepted request, or generated text is not proof of a successful run or side effect.
- Preserve correlation IDs, run discovery, bounded polling, artifact provenance, failure classification, and evidence journals for asynchronous GitHub Actions work.
- Do not bypass `executeTool()`, `requiresCoSign`, provider routing, or existing Guardian gates. Do not invent a second authority path.
- Do not modify protected paths, foundation rules, workflow policy, package control, or licensing without explicit named authorization from Cristian Nunez.
- Never store or print credentials, private customer data, generated secrets, or raw tokens.
- Autonomous repairs remain branch/PR-only and never merge themselves. Human review is the landing authority.
- Keep changes narrow, testable, and documented. Prefer a targeted regression test over a broad refactor.
- Before claiming completion, report the exact commands run, their exit codes, warnings, and what remains unverified.

The canonical Founder’s Principle, Motive, and completion standard are in `docs/founder-principles.md`. The protected-path policy is `.github/protected-paths.txt` and must remain the source of truth for protected-path matching.
