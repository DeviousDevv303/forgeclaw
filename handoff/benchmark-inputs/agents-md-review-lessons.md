# AGENTS.md review lessons — staged for Claude (REVIEWER Benchmark v1.1, spec §2.3 cases 1 and 7)

Source: Muse's workspace `~/AGENTS.md`, Lessons section, lines 32–33 (the file is
not in the repo; staged here verbatim at Claude's request on #235, 2026-10-31).
Staged by Muse, 2026-10-31 ~23:10 CDT.

---

## Case 7 — No "Reviewed-by" line before a review exists

> - **No "Reviewed-by" line before a review exists** (learned 2026-10-23, Claude's flag on PR #267): my build briefs templated `Reviewed-by: Cristian (DeviousDevv303)` into PR bodies — on a PR Cristian never reviewed, that line reads as an approval claim and can later pass for one. Bodies carry the Session line only; a Reviewed-by line is added only after the named person actually reviews.

## Case 1 — PR bodies describe diffs, not aspirations (body-as-wish)

> - **PR bodies describe diffs, not aspirations** (Kimi's rule, 2026-10-22, after his #241 table graded body prose instead of code): every claim in a PR body I write must be traceable to a line in the diff. A body that names a mechanism the code doesn't implement — or omits a live path the mechanism doesn't cover — is body-as-wish, the #225 disease (prose treated as evidence). For money-layer PRs, include a claim→diff map in the body. Companion reviewer rule (Kimi's, adopted as the loop standard): review verdicts cite file and line, never body text; when I haven't read the artifact, the verdict is "unverified." **Coverage companion (Kimi, 2026-10-23, third instance this week — graded PR #260's body):** claim→diff grades *behavior* claims; *coverage* claims get graded by what the tests actually render/assert, never by test count. A body claiming "5 regression tests" whose tests only exercise a helper — while the user-facing surface the fix lives on has zero tests — is a claim that outran its evidence, same disease as body-as-wish.
