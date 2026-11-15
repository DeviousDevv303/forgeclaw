# DeepSeek → Qwen identifier migration: plan (DRAFT; changes nothing)

Written by the Claude lane on 2026-11-03 on the owner's direction that the model was never DeepSeek 16B and the name should be Qwen (Qwen3-8B, 4-bit GGUF via llama.cpp). This is a plan and an inventory, not a change. No code, workflow or data was touched, and nothing was merged.

## 1. What is already done and what is left

Display names were renamed on `main` earlier (#340 run-list display, #348 mocks and prompt): the run list and labels already read `Qwen/Qwen3-8B`. What is left is the **identifier layer**, which the workflow's own comment calls "internal route/provider id stays `deepseek` for continuity". Inventory on `origin/main` (script: `qwen_inventory.py`, first matching class wins, 1,269 lines in 166 files plus 31 file names):

| Class | Lines | Files | What a rename touches |
|---|---|---|---|
| module and identifier names (`deepseekSculpt`, `isDeepSeekProvider`, …) | 509 | 111 | TypeScript only |
| tool names (`deepseek_reason`, `ask_deepseek`, …) | 244 | 74 | model-facing tool schemas, prompts, tests |
| workflow file and dispatch (`deepseek-16b.yml`, `deepseek_gguf.py`, `DEEPSEEK_*`) | 180 | 54 | the workflow file, `workflow_id`, dispatch payloads, pins |
| prose, docs, comments | 168 | 55 | nothing functional |
| provider/runtime id `'deepseek'`, `deepseek:` source prefix | 109 | 30 | router, the lineage rule, **stored records** |
| mirror branch `deepseek-results` | 32 | 9 | every banked artifact path and reader |
| checkpoint label `deepseek-16b` | 27 | 12 | run meta, labels, tests |

Also noted in passing, not part of this: two compiled `__pycache__/*.pyc` files for `deepseek_tool_calls` are tracked in `.github/scripts/`.

## 2. Hard constraints (why this cannot be a find-and-replace)

1. **The swarm exam is pinned to the names being changed.** Pass 7 dispatches `deepseek-16b.yml` on `main` and its A6 check pins the blobs of `deepseek-16b.yml` (`e65e3429…`) and `deepseek_gguf.py` (`7fd87e50…`) at `main` `53c39e36`. Muse's fire-queue files name `deepseek-16b.yml`, and her runner and my verification read the `deepseek-results` mirror branch. **Any merge to `main` while the exam runs risks moving the pinned workflow commit; any change to those two files or the mirror branch name breaks the pin or the readers.** Nothing in this plan merges until the exam has converged and Muse agrees the pins can move.
2. **Frozen exam objects name the old workflow.** Frozen records (REVIEWER v1 run 1, the swarm anchors, `check_clean` anchors) cite `deepseek-16b.yml` at specific commits. Those are history and must keep resolving; they are not edited.
3. **Stored data uses the old ids.** Learning and corpus records carry `runtime: 'deepseek'`, `source: 'deepseek:…'` and `lineage` markers. The Route C lineage rule (`hasQwenLineage`, `QWEN_RUNTIMES`) depends on recognizing them. Both the old and the new ids must be recognized for as long as old records exist, or Qwen answers stop being classified as Qwen lineage and could self-admit. The `corpus` provider id is also a Qwen alias and stays.
4. **Protected paths.** `.github/workflows/**` and the relay are protected; the owner has said a protected path may be edited when needed, but each such change should be named and reviewed by the other lane.
5. **Pinned tests encode dispatch payloads.** Several tests (`toolExecutionChain`, `relayWorker`, `deepseekArtifact`) assert the dispatch body and tool names; they change in the same commit as the code they pin.

## 3. Proposed new names (owner to confirm before any rename)

Workflow `qwen3-8b.yml`; script `qwen_gguf.py`; mirror branch `qwen-results`; tool names `qwen_reason` and `ask_qwen`; provider id `qwen` (`corpus` stays an alias); modules `qwen*.ts`; env prefix `QWEN_`; checkpoint label `qwen3-8b-q4`. These are proposals, and the checkpoint label may need to stay as it is because it is recorded in run metadata that frozen records quote.

## 4. Stages (each independently reversible; stages 2 to 5 wait for converge)

0. **Now, safe:** this plan and the inventory. No code.
1. **Aliases, additive only (branch, not merged to `main` during the exam):** the code accepts both names everywhere a name is read: provider id (`qwen` and `deepseek`), tool names (`qwen_reason` alongside `deepseek_reason`), lineage sets and source prefixes. Nothing is removed, so both old and new runs and records work. A guard test sweeps every place a name is read and fails if a reader accepts only one of the two.
2. **Dispatcher and readers dual-read:** the mirror reader, run finder, relay and `check_clean` accept both workflow names and both mirror branches.
3. **Workflow cutover (needs Muse and the owner):** add `qwen3-8b.yml` as a copy (the old file stays until the swarm and all frozen references no longer need it), re-pin A6 to the new blobs, dispatch the next exam pass on the new file, mirror to `qwen-results` (the old branch kept read-only).
4. **Data migration:** write new ids from now on; leave old records as they are and keep the dual-read. No history is rewritten.
5. **Remove the old names** only once nothing reads them, proven by the same guard test, and never from frozen records.

## 5. Risks and how each is held

| Risk | Hold |
|---|---|
| Breaking the in-flight exam pin | nothing merges during the exam; stage 1 stays on a branch |
| Qwen answers losing lineage and self-admitting | the guard test plus the CURATOR lineage check (`curatorChecks.ts`) run on both ids |
| A reader that only knows the old name | the guard test; stage 2 before stage 3 |
| A missed protected-path or relay edit | each such file named in the PR and reviewed by the other lane |
| Large noisy diff | stage 1 is additive and small; the mass rename of module names (509 lines) is mechanical and last |
| The checkpoint label | keep the old label where frozen records quote it; decide separately |

## 6. What I need from the owner

1. Confirmation of the proposed new names (§3), especially `qwen3-8b.yml`.
2. A word that the cutover (stage 3) waits for converge and Muse's agreement on the pins. I recommend it.
3. Whether stage 1 (additive aliases) should be built now on a branch for review after converge. I recommend yes; it changes no name anyone reads today.

## 7. Stage 3 done (2026-11-04): `deepseek-16b.yml` no longer exists
Owner direction (third time, in session): there never was a DeepSeek 16B workflow; the model is Qwen/Qwen3-8B. `.github/workflows/deepseek-16b.yml`, `deepseek_gguf.py`, `deepseek_tool_calls.py` and their three tests were removed; **`qwen3-8b.yml` is the only workflow** and carries the swarm's 1500 s chat budget. Evidence it is the same instrument: after renaming, its embedded Python differs from the old workflow's only by the lazy torch import (#362), the real DeepSeek-Coder fallback name and the budget line; `qwen_gguf.py` and `qwen_tool_calls.py` equal the old scripts apart from one comment; and running the new script on a real swarm queue file reproduces the exam's frozen scaffold hashes (pre, mid, post) and passes `swarm_dispatch_clean.py`. New artifacts land on the `qwen-results` branch; artifacts banked before this change stay on `deepseek-results` as history, and `swarm_batch.py` reads both. Frozen records that quote `deepseek-16b.yml` are history and are not edited.
