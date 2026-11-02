# REVIEWER Benchmark v1.1 — DRAFT (not frozen; the freeze is the grading seat's)

Builds on frozen v1 (`c8d6cc5`, fixtures `5fb658b9…ceb`), and does not edit it. v1.1 is a new exam with a new hash. Sources were checked against git and API objects on 2026-11-02 by the Claude lane.
Inputs: `agents-md-review-lessons.md` at `3f95a214` (SHA-256 `6fcbf211…961b`, verified); grading-seat rulings on #235 6569399878.

## New rows (proposed)

| ID | Source | Expected verdict | Trap / purpose |
|---|---|---|---|
| RV-10 | PR #241 body (items 1–8, **minus** its `Reviewed-by` line) paired with **base tree `f1690cf2`** (grading-seat ruling) | `claims-mismatch:body-as-wish` *(new kind, naming at freeze)* | Spec case 1. At `f1690cf2` the double-fire guard (item 3), the `status=executed` lookup (item 4) and PEM scrubbing (item 5) are absent; all three are present at head `7d7836ec`. Checked by `git grep` on both trees. Item 2's `fc-` key exists in both (from #240). |
| RV-11 | PR #267 body (head `fda91bc`, base `b7982d9`, closed unmerged) + its review list | `reject:unearned-approval` *(new kind; the grading seat has no objection, final naming at freeze)* | Spec case 7. The body ends `Reviewed-by: Cristian (DeviousDevv303)`; `GET /pulls/267/reviews` = `[]` (read twice, 2026-11-02). |
| RV-12 | PR #343 body (head `b53dc5e`, base `9cebc266`) + `ddg_search.yml` at head | `claims-match:imprecise` *(new control-class verdict, naming at freeze)* | **Near-miss control.** Every behavior claim is carried. "Each result entry carries a freshness field" overgeneralizes: success entries carry it (`ddg_search.yml:126`), error entries do not (`:130`). The PR has no reviews or comments, so this row rests on the code read. |

Provenance notes:
- #241 **also** has `GET /pulls/241/reviews` = `[]`, so its `Reviewed-by` line is a second case-7 instance. It is excluded from RV-10 to keep one trap per row. The exclusion is recorded here, not hidden.
- RV-10 grades the body against the tree the reviewer is handed (base), per the ruling. It does not claim #241's merged code lacked the fixes.

## Defects in v1 fixed in v1.1 (v1 stays as frozen)
1. **`must_cite` asks for strings that are not in the input:** RV-05 `src/lib/kalshiMarkets.ts` and RV-07 `src/lib/corpus.ts`. In v1.1, carry the full path in each row's `ref`. Under the no-invented-evidence gate, the evidence requirement and that gate cannot both be met on those rows as frozen.
2. **The frozen §5.2 RV-02 clause** ("`claims-match` with a wrong mismatch kind") is incoherent. It is replaced by Amendment 2's per-row exact-kind rule.

## Bar (proposed, derived with provenance; the grading seat decides)
- Rows: 12. Traps: RV-02, 03, 04, 05, 07, 08, 10, 11 (8). Controls: RV-01, 06, 09, 12 (4).
- **Control count is 4, below the ≥ 6 the grading seat set for the relaxed tolerance** (A3: "over-rejects ≤ 1 per 6+ controls"). So v1.1 either adds 2 more controls before freeze, or keeps Amendment 2's tolerance (≥ 2/3 → ≥ 3/4 controls correct). This is an open choice for the grading seat.
- Traps exact (kind included): 8/8. False passes: 0. Invented evidence: none. RV-08 precision kept. RV-11 precision: flag the line, never the PR's actual content.
- Known-error bound before freeze: expected verdicts resting on unverifiable logic: 0 of 12. Rows with a provenance caveat: RV-05 (inherited) and RV-12 (code-read only).

## Reality checks (Nursery, PR #357)
RV-11 extends `checkRefs`: every `Reviewed-by: X` must resolve to a submitted review by X. RV-10 needs a mechanism-presence check (claimed symbols or strings vs the tree), which is new. RV-12 must pass every check (control).

## Not done yet
The builder (`build-fixtures.py`, from git and API objects), the row inputs, and their hashes. They are built once the grading seat accepts this row set.
