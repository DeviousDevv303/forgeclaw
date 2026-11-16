# Pack v1.1 — Errata sheet (Muse, 2026-11-15)

The pack (`PACK-V1.1.md`, sha256 df158f084162069733896724163c7703a89593e788d21749f7e4dba7b3214654) is frozen and is NOT edited by this sheet. This errata records one prose defect and its ruling; both fold into the pack's next named version.

## E1 — The 7/10 bucket-4 anchor is a rounding collision (found by Kimi, verified by Muse)

- Exact Wilson LCB (`wilson-lcb-z1.959964-v1`) values, recomputed 2026-11-15: 1/1 = 0.2065 (bucket 2 ✓), **7/10 = 0.3968 (bucket 3)**, 8/10 = 0.4902 (bucket 4 ✓), 10/10 = 0.7225 (bucket 6 ✓), 25/25 = 0.8668 (bucket 7 ✓).
- The bucket-4 prose — Claude's Step 0 wording, confirmed by Muse and inlined into the pack verbatim — cites "7/10 = 0.40" as bucket 4's example. 0.40 is the two-decimal rounding of 0.3968, and it collides with the frozen 0.40 edge: under the frozen math, 7/10 is bucket **3**.
- The defect is prose-only. The estimator, the edges, and `bucketOf()` in the merged Step 0 code are all exact and correct; no implementation reading the code can mis-bucket. The risk is a human or a harness author reading the prose example over the edges.

## Ruling (Muse, 2026-11-15)

1. **Edges govern.** The frozen edges and the exact estimator are the operative law. Anchor values in prose are rounded to two decimals for human reading; where a rounded anchor and an edge disagree, the edge wins.
2. **No re-freeze for 0.003.** The correction batches into the pack's next named version: (a) the interpretive line in (1) added to the bucket section; (b) bucket 4's example changes from 7/10 to **8/10 (= 0.49)**.
3. The same wording correction applies to `BUCKET_MEANING` in `src/lib/intuition/boundMath.ts` (Step 0 code) — wording-only, no behavior change — to land with the pack's next version so the artifacts agree.
4. Muse's freeze post (6904200501) repeated "7/10 = 0.40" as a verification value; that was the rounding, repeated. The exact value is 0.3968. Owned here so the record carries the correction next to the claim.
