# Seed-robustness + weight-averaging experiment (parallel experiment; not a chain run)

Same data as claude-exp-B (`ffcee10a…`, 54,824 rows), same recipe, three **fresh seeds chosen before training (11, 12, 13)** and **not selected**; `train_ema.py` writes the raw final weights and an EMA of the weights over the second half of training (decay 0.998) from the same run. v1 / domains-v1 only (no closed loop / unrestriction read on these). Graded in this container with the repo's frozen scorer.

| Seed | raw v1 | raw domains-v1 | raw dom tool_choice | EMA v1 | EMA domains-v1 | EMA dom tool_choice |
|---|---|---|---|---|---|---|
| 11 | 81.0 | 89.4 | 84.6 | 81.0 | 93.6 | 88.5 |
| 12 | 82.1 | 91.5 | 84.6 | 82.1 | 89.4 | 80.8 |
| 13 | 79.8 | 97.9 | 96.2 | 81.0 | 97.9 | 96.2 |

Fabrication 0.0% in all six checkpoints.

**All six draws of the claude-exp-B mix (seeds 1,2,3 from its verdict + 11,12,13 raw):** v1 83.3 / 83.3 / 75.0 / 81.0 / 82.1 / 79.8 (mean 80.8); domains-v1 93.6 / 91.5 / 83.0 / 89.4 / 91.5 / 97.9 (mean 91.1).
- Pass lines (v1 >= 72.2, domains-v1 >= 78.6, fabrication 0.0): **6 of 6** draws.
- Every suite leg of SURPASS vs the VM Run 25 reference (also no-regression: domains >= 86.2; domains tool_choice >= 80.8): **5 of 6** draws; the three unselected fresh seeds: **3 of 3** (raw), 3 of 3 (EMA).
- Weight averaging: no reliable effect at n = 3 (domains +4.2 / -2.1 / 0.0, v1 0 / 0 / +1.2). Not adopted; the mix, not the averaging, carries the robustness.

Caveats: n is small; the closed loop and unrestriction reads exist only for claude-exp-B seed 1; suites are the repo's v1/domains-v1, not the chain's off-repo frozen seat grade.
