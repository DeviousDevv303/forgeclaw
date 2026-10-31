# Handoff: Claude lane, 2026-10-31 (to Muse; written because usage is about to run out)

Branch `claude/forgeclaw-refactor-audit-b5ydc0` (ForgeClaw), head at the commit that adds this file. Previous handoff: `docs/HANDOFF-claude-2026-10-27.md`. Ledger: #235. Nexus-track: #326.
Nothing below was merged by me except what is marked MERGED. No self-merge anywhere else.

## 1. In flight RIGHT NOW (the one thing that can be lost)
**Run 9 (generated nonces)** is training in MY container scratchpad, which is reclaimed when the session ends or usage runs out.
- Work dir: `/tmp/claude-0/-home-user-forgeclaw/5bc7fd5b-4925-53c7-ad80-0d46d37c5f59/scratchpad/run9` (pipeline PID in that container; train log `run9/train.log`; checkpoints every 500 steps at `run9/ckpt/resume.pt`).
- Started ~21:20Z; at the time of writing it was at step ~400/5000 (about 0.45 s/step, so roughly 40 min total). It will probably NOT finish before my usage ends.
- **Treat it as lost unless a notice says otherwise. It is fully reproducible from the repo; nobody needs my container.** Command (any lane, ~1 h on 4 CPU cores; torch + sentencepiece in a venv outside the repo):
  ```
  GEN_ARGS='--nonce generated' PY=<venv python> nexus-llm/train/pipeline.sh <work-dir OUTSIDE repo> small-copy-ind 30000 31 5000 6e-4 <run-4 eval dir>
  ```
  (CPU thread order can move the last digits; the pre-registered bands are wide enough for that.) Run-4 eval dir = the incumbent's constrained predictions (`eval/v1.jsonl`, `eval/domains-v1.jsonl`); if you do not have it, drop the incumbent argument and gate against run 4 afterwards.
- **Pre-registered BEFORE training** (6a31a5e, `nexus-llm/runs/diagnosis/gennonce-preregistration-2026-10-31.md`). Score it exactly like this, no new thresholds:
  1. `cd nexus-llm/train && python predict.py --ckpt <work-dir>/ckpt/model.pt --cases ../eval/firstpiece-v1/probe.jsonl --out <preds> --constrained`
  2. `python nexus-llm/eval/firstpiece-v1/score-probe.py <preds>`
  3. Read pooled exact (S+L, n=62; capfix baseline 7/62 = 11.3%): **>= 35% SUPPORTED, < 20% NOT SUPPORTED, between AMBIGUOUS**; INCONCLUSIVE if Kalshi routing < 50% in either stratum. My prediction was 15-30% (SUPPORTED about 20%).
  4. Secondary, non-gating: capprobe-v1.2 strict (capfix 4/60 = 6.7%), closed loop /18, gate vs run 4, per-suite drop over 1 point. A good H3 result is NOT a ship decision; the gate decides.
- If you run it, post the number as it falls and commit it under `nexus-llm/runs/run9/`. model.pt is not pushed (no one pushes weights).

## 2. Done and verified this block (SHAs on the branch above)
| Item | State | Evidence |
|---|---|---|
| Workflow rename (directive item 1) | MERGED | PR #340 |
| Thread B (main-chat DeepSeek run persist/clear) | **draft PR #341, head d375595, CI green, 4/4 tests fail on main / pass with fix incl. required crash-path test; App.tsx +12/-0. Waiting on YOUR verification and merge; I did not merge.** | `src/appDeepSeekMainChatPersist.test.tsx` |
| Capitalization hypothesis (capfix) | graded as pre-registered: **FAIL**; my earlier "confirmed" claim RETRACTED | 518c982, `runs/capfix/RESULTS.md`, banner on `runs/diagnosis/copy-fidelity-capitalization-2026-10-31.md` |
| First-piece-length lead | pre-registered a7eb440, scored: **NOT SUPPORTED** (exact S 3/31 vs L 4/31, diff 3.2 pts < 10) | 24db644 `runs/firstpiece/RESULTS.md`; correction ef5f378 (the "span overrun" reading was wrong: training queries copy whole event phrases) |
| Forced-first-character test | pre-registered dd6fcdf, scored: **AMBIGUOUS** (40.3% pooled vs 11.3% unforced; my <25% prediction was WRONG) | 2f3bb74 `runs/firstpiece/FORCED-RESULTS.md` |
| `--nonce generated` generator flag | default OFF; flag-off output byte-identical on 800 rows; gen tests 8/8 | 6a31a5e |
| TradeSheet CI-red | **FIXED**: e2e `tap()` used scrollIntoViewIfNeeded; Chromium 131 (CI) leaves a low button under the sticky Next bar. Reproduced with the CI browser first; test-only fix; **CI run 41242644306 green** | tradesheet `claude/tradesheet-v1` @ 9e8bdf0 |

Findings worth keeping (all measured, small n, labeled): capfix exact copy of unseen words ~11%; 51/61 queries open with "e" for entities that do not (training: 7.6% of queries start with "e"); constrained == unconstrained on the 8 items I checked, so it is the model, not constrain.py; forcing the correct first character helps (to 40%) but does not fix mid-word drops; fixed nonce pool is only 48 words.

## 3. Standing state
- Run 4 remains the incumbent (v1 60.7%, domains-v1.1 76.6%). Run 8 is not a clean replace (domains v1 vs v1.1 tie across suite versions). Nothing from runs 5-9 is promoted or shipped; all weights are synthetic-data-only.
- Goal ("Nexus LLM completion with image generation, trader and tokenization") is **NOT met**: image generation worked end-to-end once (run 40601203465 -> `generated-images@2c4b697`); copy of unseen words is the blocker for reliable image/Kalshi flows; best model unshipped.

## 4. Blocked / operator-gated (unchanged)
- GPU for `nexus-30m`, admitted real data, tokenizer v2: Cristian's calls. (The first-piece lead that would have justified v2 failed its test.)
- N and cap; **independent Guardian review of `/funds halt` (9b4c8b2) and EF-03**: I cannot review my own work.
- TradeSheet phone re-run (type a job, tap Next WITHOUT "Add", confirm Work Experience); footer version tag still open.
- Thread A: the patch `agent-channel/deepseek-workflow-followup-2026-10-29.patch` lives in Muse's workspace, not my container. Bot-series Researcher+Reviewer benchmarks: `fleet-specs/forgeclaw-bot-series-spec.md` is not in my container. Both need to be placed where I (or another lane) can read them.
- Muse to score the run-8 checkpoint on `eval/capprobe-v1/probe.jsonl` (the clean attribution test; ask is on #326).

## 5. Next, in order (for whoever picks this up)
1. PR #341: verify and merge (or request changes).
2. Run 9: reproduce and score per section 1 if my container is gone.
3. shell_exec routing-gap generator expansion (legit build/test/dev scope only; unrestriction benchmark priority one).
4. attach.ts ranking/selection; held-out coding gate is wired (4429317).
5. Thread A and bot-series once their inputs are readable.

## 6. Deviations and caveats I own
- Candidate pool for the first-piece probe was widened after the builder's >=30-pair assertion first gave 16 (assertion kept; disclosed in the pre-registration).
- Earlier errors, all corrected in-repo: the "CONFIRMED" capitalization claim; the "span overrun" reading; a stale-image control re-score (amendment 1); the vacuous lowercase bar (3.3%).
- First-piece and forced-first results: n = 31 per stratum / 62 pooled (CI about +/-12-17), one checkpoint, one seed, one template.
- Pushed the TradeSheet fix directly to its branch (test-only); say if you want a PR instead.
