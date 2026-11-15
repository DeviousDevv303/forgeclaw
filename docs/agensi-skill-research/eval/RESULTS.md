# Results (2026-11-14) - read the limits first

n = 1 run per cell, same model for every arm, 6 fixtures (15 planted bugs, 13 decoys, 1 bug-free file). Raw outputs: `results/`. Scores: `results/score.json`.

| Arm | Bugs found | Critical/warning findings | Matching a planted bug | Precision | Decoy alarms |
|---|---|---|---|---|---|
| A: no skill | 15/15 | 20 | 17 | 0.85 | 1 |
| B: Agensi reconstruction | 15/15 | 23 | 16 | 0.70 | 4 |
| C: ours, earlier text (steps labeled as a framework) | 15/15 | 17 | 15 | 0.88 | 1 |
| C2: ours, shipped text (framework not named) | 12/12 on 4 scored fixtures; f3 not scored* | 16 | 12 | 0.75 | 2 |

*The C2 f3 reviewer's file write was denied by the environment, so that cell has no result file and is counted as missing. Its inline report listed all three planted f3 bugs; this is not scored.

Same-subset comparison (f1, f2, f4, f5, where all four arms have data): precision A 13/16 = 0.81, B 13/20 = 0.65, C 12/14 = 0.86, C2 12/16 = 0.75.

Tokens per review (subagent totals, dominated by fixed overhead): A about 62.7k, B about 63.9k, C about 64.7k, C2 about 64.4k. Differences are around 3 percent and not meaningful.

## What this does and does not show
- **Recall is at ceiling.** Every arm found every planted bug. These fixtures cannot show a recall advantage.
- **Supported:** with the skill text we ship (C2) and the earlier text (C), precision is higher than the Agensi reconstruction (B) on the same files, and B raised the most decoy alarms. This is a small difference (a few findings) at n=1.
- **Not supported:** that our skill beats no skill. A is within noise of C and slightly above C2 on the shared subset.
- **The shipped text (C2) did worse than the earlier text (C)** on precision. At n=1 this could be noise or a real cost of removing the explicit step labels. It needs repeated runs.
- **Scorer understates precision for every arm.** Some "unmatched" findings are real unplanted issues. Example: `revokeSessions` in `f2_auth.js` has no authorization check, and all four arms flagged it; I did not plant it. Decoy alarms on f2 are largely that same finding sitting next to a decoy line. Unmatched findings need a hand audit.
- **B is a reconstruction** from the public listing, not Agensi's actual SKILL.md. Claims apply to the publicly described behavior only.
- Fixtures were written by us, and nobody except the author has validated them.

## To make "testably better" defensible
1. Harder fixtures: subtle bugs that no-skill misses (cross-function invariants, concurrency, realistic diffs).
2. At least 5 runs per cell; report mean and spread.
3. Fix the f2 fixture (add an authz check so it is clean) and hand-audit all unmatched findings.
4. Get the real Agensi SKILL.md via their MCP and replace arm B.
5. Re-run C2 f3 with a working write path.
