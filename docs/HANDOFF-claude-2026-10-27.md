# Handoff — Claude lane, 2026-10-27 (~20:20 UTC)

Branch `claude/forgeclaw-refactor-audit-b5ydc0` (ForgeClaw), head at the commit that adds this file. TradeSheet: `DeviousDevv303/tradesheet`
branch `claude/tradesheet-v1` @ `392029c`. **Nothing is in a PR or merged** (NEVER MERGE on ForgeClaw: only the operator merges).
`main` is `60d8a9e` (PR #327, J-01, merged by the operator); this branch merges into it cleanly (checked with `git merge-tree`).

## 1. NEXUS LLM (nexus-llm/) — where it stands
| Item | State | Evidence |
|---|---|---|
| Grammar, tokenizer v1 (50 tool names atomic) | done | `ccc2aa9`; tokenizer unittest 10/10 |
| Frozen suites | v1 (84, `079df97bcb91`), domains v1.1 (47, `da429fa8b9db`; one correction recorded in its MANIFEST) | `eval/`; rebuild against the pinned app: `npx vite-node nexus-llm/eval/rebuild-pinned.ts build-domains.ts --check` |
| Constrained decoding | done; 3 dead-end fixes | `train/constrain.py`, `9315843`, `1af8e71` |
| Gate (replace-only-if-better) | done | `eval/gate.ts`, `eval/gate-cli.ts` |
| Closed loop (model drives tool flows; propose-only sidecar; argument fidelity) | done | `eval/loop/`, `train/loop.py`, `2e53e97` |
| Run 2 (`small`, 12k synthetic, low-entropy args) | v1 48.8%, domains 66.0% (constrained); loop **3/18** honest (8/18 before fidelity checks) | `train/README.md` |
| **Run 4** (`small` 4.35M, 20k synthetic, router-labelled + high-entropy args, 5000 steps, 47 min CPU) | **v1 60.7%, domains v1.1 76.6%** (constrained; format/schema 100%, overclaim 0%, fabrication 0%); tool choice v1 24.2→57.6%; owner-only 0→66.7%; **regression: v1 no_tool 60→40%**. Gate vs incumbent run 2: **ELIGIBLE** (not a ship decision: synthetic-only). **Loop 6/18 (33.3%)** vs run 2's 3/18: funds flows and owner-only commands now pass; **argument copying still fails: 0/5 image prompts and 0/2 Kalshi queries carried the requested words** ("fed" -> "hurric curricane landfall") | measured this session |
| Run 3 | stopped at step 1000 (superseded: low-entropy data) | `2e53e97` message |

**Not yet committed (lives only in this container's scratchpad, which is reclaimed):** the run 4 checkpoint and its prediction files. To
reproduce run 4 exactly: generator at `2e53e97`,
`npx vite-node nexus-llm/train/gen-synthetic-traces.ts --out /tmp/syn20k.jsonl --n 20000 --seed 13`, then
`python nexus-llm/train/train.py --data /tmp/syn20k.jsonl --out /tmp/ckpt4 --preset small --steps 5000 --batch 32 --lr 6e-4`
(torch + sentencepiece in a venv outside the repo; CPU thread order can change the last digits).
Then: `predict.py --constrained` on both suites, `eval/gate-cli.ts --candidate <dir> --incumbent <run-2 dir>`,
`train/loop.py --ckpt … --out loop.jsonl --dispatch-log dispatch.jsonl`, `eval/loop/score-loop-cli.ts loop.jsonl`.

**Next NEXUS steps, in order:**
1. **Copying unseen words is the blocking capability.** Run 4 cannot yet put the user's words into a call. Options, best first: a copy
   mechanism (pointer/copy head over the prompt span), a larger model (`nexus-30m`, needs a GPU), or many more high-entropy rows.
2. Only when the loop's fidelity check passes for an image scenario: dispatch that call once to the repo's own `generate-image.yml`
   (inputs `prompt, style, width, height, model, invocation_id`). Not done: no run-4 image call carried the requested words, so a real
   render would prove nothing.
3. Investigate the no_tool regression (v1 60→40%).
4. Real next step per the operator: **admitted data** (exporter waits on the operator's JSON); the fine-tune comparator (read the actual
   licence text first); a GPU for `nexus-30m`.

## 2. Funds
- `/funds halt` (operator amendment): design `433d481`, code `9b4c8b2`, 13 tests. Stop-only; open positions settle as-is. **Waiting on
  Guardian review**; past review is the operator's call.
- Exposure gap: pinned as a KNOWN GAP test (`be3f8cb`, $148.80 open vs a $100 limit). The fix was WITHDRAWN: do not build it. The real
  worst case for a bad day today is the whole capped bankroll; do not pick N from cap × exposure.
- Record: `docs/specs/trading-performance-review-design.md` §7. Trading stays propose-only in the model's scope; the placement path is
  design-only (wake the operator before proposing to build it).

## 3. TradeSheet v1
Phone run passed on speed (0:50 vs 5:00). Fixed in `392029c`: the literal "null" under Download PDF, and a typed-but-not-added job
dropped on Next. **Needs the operator's re-run** (type a job, tap Next without "Add", confirm Work Experience). Still open: LICENSE (operator's
directive), `.github/workflows/ci.yml` is a new workflow file (rule-18 flag), and Muse's verification against the brief and the five fixes.

## 4. Browser write block
`ec49dfe`: draft mode always on. Backlog item (needs a new authorization): write-block v2 for WebSocket sends and state-changing GETs.

## 5. App findings (not fixed; for the operator)
- `routeLiveDataQuestion` sends "What does Kalshi say about…" to `web_search`, against the `kalshi_markets` description.
- `routeLiveDataQuestion` emits `weather_forecast` `day:"0"` (string) where the schema says number.

## 6. Waiting on the operator
N and cap; Guardian review of the halt; EF-03 (staged, pre-PR, Guardian first); license directive; Kimi's docs; the exporter JSON;
the TradeSheet re-run.

## Addendum (23:30 UTC): run 5 and the first NEXUS-driven image
- Copy head (`21842ac`, preset `small-copy`). Run 5 (same data/steps as run 4): v1 64.3%, domains v1.1 68.1%; gate vs run 4 **REJECTED**
  (domains below the incumbent), so run 4 stays the incumbent. Loop 7/18; **3/5 image calls now carry the requested unseen words**; Kalshi
  queries still garbled.
- One faithful call ("make a watercolor picture of a lighthouse at dawn", watercolor) was dispatched unedited to `generate-image.yml`:
  run 40601203465 succeeded; image at `generated-images/nexus-run5-loop-img3.png` (`2c4b697`).
- Next: combine run 4's routing with run 5's copying (copy head + more rows/steps, or nexus-30m on a GPU); fix the Kalshi query copy.
