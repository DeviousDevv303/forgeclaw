# Agensi best-seller research (2026-11-14)

## What was done
- Pulled Agensi's public browse page (`/skills`), which embeds the full catalog: **589 skills, 82 paid**. Raw data: `eval/data/agensi_catalog_2026-11-14.json`.
- Ranked by `install_count`. Read the #1 listing (`/skills/code-reviewer`).

## Caveats (read before trusting the ranking)
- **"Installs" is not "sales".** Most top entries are free. Agensi publishes no sales or revenue figures; installs is the only volume metric available.
- Review counts are tiny (top skill: 19; most paid ones: 0-1). Ratings are weak evidence. Installs can be inflated by free promotion or self-installs; this was not auditable.
- The real SKILL.md text is served only through Agensi's MCP behind sign-in. Only the public listing text was read.

## Top 15 by installs
| # | Skill | Price | Installs | Rating (reviews) |
|---|---|---|---|---|
| 1 | `code-reviewer` | free | 1,950 | 4.3 (19) |
| 2 | `humanize-writing` | free | 816 | 4.8 (12) |
| 3 | `prompt-engineer` | free | 587 | 4.7 (7) |
| 4 | `git-commit-writer` | free | 484 | 4.8 (9) |
| 5 | `readme-generator` | free | 366 | 5.0 (5) |
| 6 | `frontend-motion-wizard` | free | 348 | 4.3 (6) |
| 7 | `codex-grade-coding` | free | 332 | 4.8 (4) |
| 8 | `seo-optimizer` | free | 276 | 5.0 (5) |
| 9 | `env-doctor` | free | 259 | 5.0 (1) |
| 10 | `deep-research-team` | free | 258 | 4.8 (5) |
| 11 | `technical-scanner` | free | 234 | 5.0 (3) |
| 12 | `pr-description-writer` | free | 225 | 5.0 (4) |
| 13 | `cinematic-4k-landing-page` | free | 209 | 4.2 (5) |
| 14 | `truth-first` | free | 187 | 5.0 (3) |
| 15 | `video-enhancement` | free | 184 | 3.7 (3) |
## Top paid skills by installs

| # | Skill | Price | Installs | Rating (reviews) |
|---|---|---|---|---|
| 1 | `prompt-dataset-builder` | $9.9 | 162 | 1.0 (1) |
| 2 | `incident-postmortem-1` | $5 | 151 | - |
| 3 | `llm-becomes-an-award-winning-app-site-designer` | $9.99 | 139 | 4.1 (8) |
| 4 | `clone-site-to-elementor` | $9 | 137 | 5.0 (1) |
| 5 | `geo-seo-suite-ai-search-optimization` | $9.99 | 125 | 5.0 (1) |
| 6 | `temporal-reasoning-sleuth` | $15 | 118 | 5.0 (1) |
| 7 | `dependency-upgrade-planner` | $5 | 91 | - |
| 8 | `git-history-archaeologist` | $5 | 89 | 5.0 (1) |
| 9 | `cli-ux-doc-builder` | $5 | 85 | - |
| 10 | `meeting-decision-log` | $5 | 82 | - |
| 11 | `sql-query-clinic` | $5 | 81 | - |
| 12 | `docker-ops-playbook` | $5 | 79 | - |

## Already built by us (excluded)
`forgeclaw-project-conventions`, `forgeclaw-verify`, `agent-commit-attribution`, `agent-completion-audit`, `claim-diff-verification`, `token-saver-protocol`.

## Pick: Code Reviewer (1,950 installs, 4.3 stars from 19 reviews, free)
Why it is the target:
- #1 by installs, 2.4x the runner-up. Not on our built list.
- Output is measurable: plant known defects and score recall and false alarms with a script.
- Visible weaknesses in its own listing: lowest rating among the top 8 (4.3, with 4 of 19 reviews at 3 stars or below); states it "cannot execute code" and has "limited context"; five generic dimensions with no requirement to prove a finding; severity tiers differ between the listing text (Critical/Warning/Suggestion) and its FAQ (Critical/Suggestions/Nitpicks); no explicit handling of false positives.

Runners-up, if this one is rejected: `humanize-writing` (816), `prompt-engineer` (587), `git-commit-writer` (484, overlaps our attribution skill), and the top paid ones (`prompt-dataset-builder` 162, `incident-postmortem-1` 151, `temporal-reasoning-sleuth` 118).

## Our version
`skill/SKILL.md` (`evidence-code-review`). Differentiators: every finding needs a line cite and concrete failing scenario; candidates are attacked before reporting; a CHECKED AND OK list suppresses known false-positive traps; unverifiable risks are labeled UNVERIFIED; depth scales with blast radius.

## Proof
See `eval/README.md` and `eval/RESULTS.md`.
