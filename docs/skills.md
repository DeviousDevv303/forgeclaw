# Bundled skills

A skill is a `SKILL.md` procedure the chat agent follows when a request matches it. Code: `src/lib/skills.ts`.

## Add a skill
1. Create `src/skills/<name>/SKILL.md`. `<name>` is lower-case words joined by hyphens.
2. Frontmatter needs `name` (same as the folder) and `description`. Add `triggers`: comma-separated phrases that select the skill when a message contains one. Keep them specific; a bare word like "review" would fire on unrelated requests.
3. Body: the procedure, at most 6,000 characters. A longer or malformed file is rejected and fails `src/lib/skills.test.ts`.
4. Commit through a reviewed PR. That review is the approval step: the text becomes instructions the agent follows.

A user can also name a skill in a message: `/evidence-code-review`.

## What a skill is not
- It adds no tool and grants no authority. Actions still go through `executeTool()` and the Guardian gates.
- One skill at most per turn (most trigger matches wins, ties by name).
- It reaches models that receive the system prompt (hosted and local chat). The Qwen and Nexus GitHub Actions workflows do not receive the system prompt, so skills do not apply to them.

## Everything in src/skills is public
Skill files are compiled into the browser bundle. Anyone who can load the app can read them. Do not put a paid or private skill here.
