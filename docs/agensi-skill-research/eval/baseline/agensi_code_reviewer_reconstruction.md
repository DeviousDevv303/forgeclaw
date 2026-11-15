---
name: code-reviewer
description: Reviews your code for bugs, security vulnerabilities, logic errors, performance issues, and style violations. Organizes findings by severity and suggests fixes with code examples.
---

NOTE: This is a RECONSTRUCTION written from the public Agensi listing (https://www.agensi.io/skills/code-reviewer). The real SKILL.md is only served through Agensi's MCP and was not read. It encodes only behavior the listing states publicly.

# Code Reviewer

Run a structured code review on the user's recent changes. Review uncommitted changes via `git diff`, a feature branch against its base (e.g. `main...HEAD`), or specific files and snippets provided.

Analyze the code across five dimensions:
1. Logic bugs and edge cases
2. Security vulnerabilities (SQL injection, XSS, authentication bypasses, hardcoded secrets)
3. Performance bottlenecks
4. Maintainability and readability
5. Architectural consistency

Organize findings by severity:
- Critical: must fix before merge
- Warning / Suggestion: maintainability and performance
- Nitpick: style and minor refactors

Every finding includes the file name, the line number, an explanation of why the change matters, and a fenced code block showing the fix.

Follow the established style and patterns of the existing codebase. Avoid suggesting changes for purely subjective style preferences unless they violate the project's own standards.

Known limitations: cannot execute code to find runtime-only bugs; limited context on very large monorepos; may not catch violations of private libraries.
