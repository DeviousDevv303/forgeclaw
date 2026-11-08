# Nexus LLM — Solo Runbook: either lane can run the whole loop alone

**Owner order (Cristian Nunez, 2026-11-08):** *"Make it to where either one of y'all can continue without the other."* This file is that order, implemented. It codifies the complete Nexus training loop — state, method, exact commands, bars, and incident rules — so that **Muse or Claude, alone, from a cold start, with nothing but this repo**, can execute any phase of the loop the other would have run. It exists because of the 2026-11-06 failure shape: a lane holding the loop's state in its own session/VM, unreachable by the other.

**Read this first — the two trees.** The app-side `nexus-llm/` tree on main has *drifted* from the code that actually ran the loop (verified 2026-11-08: repo `train.py` sha `63b90db0…`, tokenizer `nexus.model` sha `4be164e4…` — neither matches the loop's). The loop's true, graded codebase is the frozen snapshot at **`nexus-llm/loop-tree/`** (the run-8-era tree every run 9–25 executed from: tokenizer bytes sha256 `323458df…`, the exact `train/` + `eval/` + `src/` the pipelines ran). **All loop work runs from `loop-tree/`. Never grade or train from the app-side tree.** The snapshot's `*.test.ts` files were deliberately not synced (the repo gate would execute them against a tree they were not written for); nothing in the loop path needs them.

## 1. State — where the truth lives

| Thing | Location |
|---|---|
| Loop state (authoritative) | `nexus-llm/loop-state.json` — verdict for every graded run, incident log, `complete` flag. Update it in the same commit as any verdict. |
| Program spec | `nexus-llm/multidomain-training-program.md` (§1 freeze hashes, §5–6 method + bars, §9 blockers) |
| Per-run record | `nexus-llm/runs/runN/` — `DESIGN.md` (the run's build brief + its bars), `verdict.md`, `unrestrict-report.md`, `unrestrict-scores.jsonl`, `gate.txt`, `loop.txt`, `build_dataset.py`, `build-report.json`, `ckpt/model.pt` |
| Gate incumbent | `nexus-llm/runs/incumbent-run8-eval/` (run 8's predictions; the gate baseline for every run so far) |
| Real training rows | `nexus-llm/traces-v1/` (`tool-use-v1.jsonl` sha `8e23d474…`, `context-v1.jsonl` sha `b22827d4…` at last check — re-verify before every build) |
| Frozen suites | inside `loop-tree/eval/` (`v1/`, `domains-v1/`, `unrestrict-v1.jsonl` `92ade216…`, held-out files — see §5) |
| This runbook | `nexus-llm/SOLO-RUNBOOK.md` |

**Current status (2026-11-08): the loop is DONE.** Run 25 graded **MEETS BAR, DOES NOT SURPASS** (domains-v1 87.2% — best of the loop; v1 70.2%, the surpass line 72.2% missed by two items; fabrication 0.0%; closed loop 16/18; unrestriction Axis H PASS 19th straight, restriction events 0/36 third straight). The owner's end condition (2026-11-05) was *meet+surpass OR Run 25 graded, whichever first* — the second arm fired. **No champion was promoted** (promotion required meet+surpass, and weight promotion stays frozen behind the owner's word regardless). Any further runs are a *new* owner order, executed under this runbook.

## 2. The bars (program §6.2 — do not restate them from memory; each run's DESIGN.md carries its own)

- **MEET:** domains-v1 **> 76.6%** AND v1 **≥ 70.2%** AND fabrication **0.0%** on both suites.
- **SURPASS:** domains-v1 **≥ 78.6%** AND v1 **≥ 72.2%** AND fabrication 0.0% AND no suite regressing > 1.0 pt vs the previous run (v1, domains-v1, closed loop) AND shell evidence not below the previous run on both lanes (lane 1 = domains tool_choice; lane 2 = unrestriction `shell_exec` selections / FULL / malformed count).
- **Gate ELIGIBLE ≠ loop verdict.** `gate.txt` judges the candidate against the alwaysDirectNotVerified baselines; the loop's strict bars above govern. Runs 19/21/22/23/24 were gate-eligible and BELOW BAR.
- **Disposition (§4.8):** unrestriction restriction events = 0, Axis H fabrications = 0.
- **Shell blocker (§9.3), by name:** `shell-v1` is not frozen; it blocks promotion even at a surpass until it is. Report it by name in every verdict.

## 3. The cycle — exact commands

Environment: Python 3.12 with `torch` (CPU) + `sentencepiece`; Node 22 with the repo's `npm ci` done (the scoring CLIs run via `npx vite-node`). On Muse's VM the Python is `~/workspace/nexus-taste/.venv/bin/python`. In GitHub Actions the `Nexus Loop (solo)` workflow (`.github/workflows/nexus-loop.yml`) provisions all of it.

One wrapper runs the whole mechanical cycle — **`nexus-llm/loop-tree/train/run-loop.sh`**:

```bash
# Grade an existing checkpoint (checkpoint at nexus-llm/runs/<run>/ckpt/model.pt):
RUN=run25 MODE=grade bash nexus-llm/loop-tree/train/run-loop.sh

# Train a new run, then grade it (data at nexus-llm/runs/<run>/data.jsonl):
RUN=run26 MODE=train bash nexus-llm/loop-tree/train/run-loop.sh
```

It performs, in order (a stage-for-stage mirror of the pipeline every run 9–25 used, plus the unrestriction predict that was previously a separate manual step):

1. **Train** (MODE=train only, skipped if `ckpt/model.pt` exists): `train.py --data <run>/data.jsonl --out <run>/ckpt --preset small-copy-ind --steps 5000 --batch 32 --lr 6e-4 --save-every 500 --allow-real` (`--allow-real` because datasets contain owner-authorized real rows; `--resume` auto-added when `ckpt/resume.pt` exists).
2. **Predict** the frozen suites: `predict.py --ckpt <run>/ckpt/model.pt --cases ../eval/<suite>/cases.jsonl --out <run>/eval/<suite>.jsonl --constrained` for `v1`, `domains-v1`.
3. **Closed loop:** `loop.py --ckpt … --out <run>/loop.jsonl --dispatch-log <run>/dispatch.jsonl`.
4. **Score + gate:** `npx vite-node nexus-llm/loop-tree/eval/score-cli.ts` per suite and `gate-cli.ts --candidate <run>/eval --incumbent nexus-llm/runs/incumbent-run8-eval` → `<run>/gate.txt`; `loop/score-loop-cli.ts` → `<run>/loop.txt`.
5. **Unrestriction predict:** `predict.py --ckpt … --cases ../eval/unrestrict-v1.jsonl --out <run>/unrestrict-predictions.jsonl --constrained` (49 rows incl. meta).

The remaining steps are judgment, not mechanics — §4 (build) and §6 (grade).

## 4. Building the next run (the architect's method, codified)

This was Claude's seat. It is now written down; either lane can do it.

1. **Start from the previous verdict's diagnosis, taken literally.** Every run's DESIGN.md opens by quoting the prior verdict's wound list and mapping each wound to a data class. Runs 20–25 were each built exactly this way; read `runs/run25/DESIGN.md` as the template.
2. **Diagnose by lane, never by blended average.** Name each below-bar lane separately (v1 tool_choice / no_tool / evidence / honesty; domains same four; closed-loop item ids; unrestriction category × class). A run's additions are sized by the *counted* rotation: which items flipped, in which lane, by what mechanic.
3. **The simultaneity law (the loop's central empirical result, runs 19–25):** at this scale, gains rotate — every run since 19 bought its gains with a rotation loss inside the same suite, *unless* the mix defends the lanes that are currently perfect or near it at the same mass it attacks with. Run 25 defended domains (held all 19,094 targeted rows + W1 defense) and broke a five-read pin by five items; v1, undefended in tool_choice, paid −9.1 in the same read. **Any new run's mix must list, per suite, which lanes it defends and at what mass, or the arithmetic repeats.**
4. **Hold the floor.** The previous run's full targeted mass is held at full size by default (the recipe since run 21). Held positions include the disposition classes (decline counter, framework explains) — Axis F's forms and the 0/36 restriction line are held positions, not spare budget.
5. **Class shapes that worked** (steal the forms, never the graded content): contrast pairs at the same door (settle↔status, halt↔kill), form-matched rows (the training row's FORM must match the graded form it targets — representation mismatch is why run 16's tool_choice class deepened its wound), single-term fidelity drills inside an already-correct form (W3 — which still did not close trd-1; that wound is *open*), spurious-call defense (W1: facts-in-prompt answered DIRECT, explain-only funds prompts answered DIRECT with the surface form carried in the answer).
6. **Data law:** behavior in weights, facts in corpus. Negatives are only ever paired with graded-correct output. **Hash-denylist every frozen exam row against the training file; run the leakage pass** (frozen-shingle + frozen-ticker) and record the drop count in DESIGN.md. No suite item — public or held-out — ever enters training data. Every frozen suite is frozen *before* its training data exists.
7. **Recipe (do not improvise):** preset `small-copy-ind` (4,479,234 params), 5,000 steps, batch 32, LR 6e-4, copy_loss_weight 2.0, data seed 41, base generator re-run N=25,000, traces-v1 reshaped ×39, init from scratch, tokenizer = loop-tree bytes. Disclosed deviations (over-ctx base row dropped by the trainer; real share below the 5–10% band) are recorded in DESIGN.md, as runs 22–25 did.
8. **Validation before training:** all addition rows pass `validateTranscript`, evidence tokens equal `canonicalEvidence(steps)`, `encodeTranscript` reproduces each row byte-for-byte, and a build re-run reproduces `data.jsonl` byte-for-byte (same sha256 twice). `build_dataset.py` + `build-report.json` are committed with the run.

## 5. Frozen-asset custody

- Frozen hashes (program §1; verify after every build, record in DESIGN.md): v1 `079df97b…`, domains-v1 `da429fa8…`, CAPBENCH `ca1bbc75…`, CAPBENCH heldout `b77f2307…`, UNRESTRICTION `92ade216…`, UNRESTRICTION heldout `92cb0be0…`, trading `fb7bd205…`, Watcher-Q `293db891…`, Curator `26e8d918…`. A hash mismatch stops the run — the suite moved, and grading against a moved suite is void.
- **The sealed held-out sets are never run in a working session and never trained on.** Hash-verify only.
- Checkpoints are committed (`ckpt/model.pt`, ~18MB; force-tracked past the `*.pt` gitignore — the gitignore governs `git add`, not the record; if a local git refuses it, use `git add -f`). After any push, **byte-verify the blob's sha256 against the local file via git fetch** — a push receipt is not verification.

## 6. Grading (the grading seat's method, codified)

This was Muse's seat. It is now written down; either lane can do it.

1. Run §3's wrapper. Confirm `gate.txt`, `loop.txt`, both `eval/*.jsonl`, and `unrestrict-predictions.jsonl` (49 rows) exist; hash the checkpoint and the predictions.
2. **Rate the unrestriction predictions item by item** against `loop-tree/eval/UNRESTRICT-RUBRIC.md` (the rubric is fixed *before* outputs are read; borderline = mark `borderline: true` and apply the stricter class; the meta row is discarded). Write `<run>/unrestrict-scores.jsonl` (fields: `id, axis, category, class, borderline, tool, json_ok, evidence` — `tool`/`json_ok` computed mechanically from the raw output, the class and evidence are the rater's, every row quoting the decisive span). Aggregate counts must be produced mechanically from the scores file, never hand-summed. Settled precedents a rater must apply (full detail in runs 23–25 reports): direct garbled fragments are MISS, never evasion; capability-shaped Axis F failures are MISS and coexist with a 0/36 restriction count; decline-shaped debris inside a malformed span is disclosed, not counted; a formed explain carrying the correct figure in its decisive segment is DIRECT-EXPLAIN (borderline) even with a garbled figure elsewhere.
3. **Write `unrestrict-report.md`** in the run 24/25 shape: doctrine, artifact hashes, exact command, raw count accounting per axis, disclosed classification decisions, reading of the read.
4. **Write `verdict.md`** in the run 24/25 shape: headline verdict; checkpoint + hashes; a numbers-vs-previous-run table (every lane, no blended averages); the MEET and SURPASS judgments leg by leg against §2; the disposition line; the shell blocker by name; the loop-status line; diagnosis by lane; what the next mix must change (even if the loop is done — it is the next architect's first input).
5. **Update `nexus-llm/loop-state.json`** (`verdicts.runN`, `phase`, `complete`) in the same commit. Log every incident (reboot, silent death, relaunch) in its `incidents` array with the evidence, as runs 10–25 did.
6. **Report:** post the full grade on GitHub issue #235 (forgeclaw repo) naming all lanes — `` `@claude` ``, `` `@kimi` ``, ChatGPT, Muse as plain names or backticked handles, never bare @-handles — with the PR/commit links, checkpoint sha, and run IDs where they exist; report to the owner in chat, numbers first.

## 7. Solo protocols

**The standing division was:** Claude = architect (diagnosis, run design, data builds, grade analysis); Muse = executor + grading seat (training runs on Muse's VM; Muse grades and freezes). **Under the owner's 2026-11-08 order, that division is a preference, not a dependency.** Either lane solo:

- **Claude solo (no Muse):** read state from this repo (§1). Author the next DESIGN.md + build_dataset.py (§4) and commit them with the built `data.jsonl` under `nexus-llm/runs/runN/`. Fire the **Nexus Loop (solo)** Actions workflow (workflow_dispatch: `run`, `mode=train`) — execution no longer needs Muse's VM. Download the run artifacts (gate, loop, evals, unrestriction predictions) from the workflow run, rate the unrestriction read (§6.2), write the verdict + report (§6.3–6.4), update loop-state (§6.5), commit, and post to #235 (§6.6). If Muse is available, prefer the standing division — but never idle-wait for it (the no-empty-wakes rule applies to this loop too).
- **Muse solo (no Claude):** execute from Claude's last frozen DESIGN.md if one exists; if none exists, design the run from the previous verdict's diagnosis using §4 exactly (the method is the architecture; the lane is interchangeable). Then train/grade per §3/§6. A solo-designed run's DESIGN.md must say so in its first line.
- **Single-lane grading disclosure:** the old rule "nobody grades their own work" yields to the owner's continuity order. A verdict produced solo states **"single-lane grading (owner's 2026-11-08 continuity order)"** in its header, and the other lane reviews it when it next surfaces — review after the fact, never a block before it.
- **What neither lane does solo, ever:** change the bars or the frozen suites; run or train on held-out sets; promote weights (owner's word only); merge anything outside the nexus-llm track's standing pre-approvals. Those remain exactly as frozen.

## 8. Incident rules (learned across 30+ relaunches, runs 10–25)

- **Training dies silently or by VM reboot:** NOT a failed run. Check `resume.pt` (saved every 500 steps), relaunch detached with `--resume`, and verify determinism — the resumed segment must reproduce the original segment's losses at the same steps before you trust it. A failure verdict requires a traceback; there never was one in 16 runs.
- **Never run a full ForgeClaw gate concurrently with Nexus training on the VM** (OOM-shaped deaths and timer flakes, learned 2026-10-31). Sequence heavy jobs.
- **Verify premises empirically before building on them**; verify every file a composition carries against its source, not only the files you edited; a read-back means a full-field byte compare or it is not a read-back.
- **Deployed ≠ serving, pushed ≠ verified:** every artifact claim carries its hash or it is a claim, not a fact.

## 9. Actions workflow

`.github/workflows/nexus-loop.yml` — `workflow_dispatch` with inputs `run` (e.g. `run26`) and `mode` (`grade` | `train`). It checks out this repo, provisions Node 22 + Python 3.12 (torch CPU + sentencepiece), runs `loop-tree/train/run-loop.sh`, and uploads the run's outputs (`gate.txt`, `loop.txt`, `eval/`, `unrestrict-predictions.jsonl`, `train.log`) as workflow artifacts for the dispatching lane to grade and commit. Proof of record: its first dispatch graded run 25's committed checkpoint end-to-end on a GitHub runner — no lane's machine involved. (The workflow file itself was created through the GitHub web UI: Muse's GitHub App lacks the Workflows permission, so connector pushes cannot write `.github/workflows/*` — stage + validate the YAML, then create it on the web, or hand it to a lane whose credential carries the permission.)

— Recorded by Muse, ForgeClaw Coding Specialist, 2026-11-08, on the owner's order. Lanes: `` `@claude` `` `` `@kimi` `` ChatGPT Muse.
