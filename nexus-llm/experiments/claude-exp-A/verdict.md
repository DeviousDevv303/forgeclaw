# Claude parallel experiment A (originally "Run 26"; not a chain run) — Verdict (multi-seed design study)

**Single-lane (Claude).** Run 26 was the first mix (Run 25 held byte-identical + X1–X4, `run26/DESIGN.md`). It was trained at three seeds, with Run 25's own data at three seeds as the control, all in this environment with the loop's frozen `train.py`/`predict.py`/scorer. Only v1 and domains-v1 were graded (no closed loop, no unrestriction read); Run 27 superseded it before a full grade was warranted. Nothing here is promoted.

| Arm (small-copy-ind, 5,000 steps) | Seed | v1 | domains-v1 | v1 evidence | domains tool_choice | fabrication |
|---|---|---|---|---|---|---|
| Run 25 data (control) | 1 | 76.2% | 83.0% | 81.3% | 73.1% | 0.0% |
| | 2 | 73.8% | 76.6% | 75.0% | 65.4% | 0.0% |
| | 3 | 67.9% | 80.9% | 75.0% | 73.1% | 0.0% |
| | mean | 72.6% | 80.2% | 77.1% | 70.5% | |
| Run 26 data (+X1–X4) | 1 | 78.6% | 78.7% | 93.8% | 69.2% | 0.0% |
| | 2 | 78.6% | 78.7% | 93.8% | 73.1% | 0.0% |
| | 3 | 79.8% | 83.0% | 87.5% | 80.8% | 0.0% |
| | mean | 79.0% | 80.1% | 91.7% | 74.4% | |
| Run 26 data, `medium-copy-ind` (12.7M params, one draw) | 1 | 82.1% | 83.0% | 93.8% | 80.8% | 0.0% |

Reference: the VM-trained Run 25 checkpoint scores v1 70.2% / domains-v1 87.2% (committed `c41852fb…`, re-graded here: identical). The control retrain is a different checkpoint (`00cbe42e…` for seed 1) from identical data and recipe.

Readings (n = 3 per arm; indicative):
- **Noise:** same data and recipe span 8.3 points on v1 and 6.4 on domains-v1. Single-run differences under ~5 points are not evidence of a mix effect.
- **X1–X4:** v1 +6.4 points mean, spread 8.3 → 1.2, driven by the evidence lane (form-matched `(runtime state: …)` rows; +14.6). Domains unchanged (−0.1). v1 honesty not moved.
- **Scale:** one 12.7M draw sits inside the small model's range on domains (83.0). Scale was not the binding constraint on the domains misses.
- **What was left:** the persistent domains misses (image-with-dimensions answered DIRECT, owner-price copy, funds and Kalshi doors) and the thin-mass funds-proposal answers — the brief for Run 27.

Authoring note: the Run 26 pass over X4 dropped 75 rows to the frozen-prompt denylist (bare tool names equal to graded prompts, run URLs, greetings); that is the denylist working, not a leak.
