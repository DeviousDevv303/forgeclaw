# Claude parallel experiment A (originally labelled "Run 26"; NOT a chain run — see ../README.md)

**Single-lane design and grading (owner's 2026-11-08 continuity order, SOLO-RUNBOOK §7).** The loop closed at Run 25 (MEETS BAR, DOES NOT SURPASS). This is a *new owner order* (2026-11-25, Cristian Nunez, in session): "take over training for Nexus Intelligence and improve it to where it will pass … train the LLM up first as an LLM", with Nexus Isles as the integration target afterwards. "Pass" is read as the SURPASS bar exactly as frozen (the owner was asked and the question went unanswered before the session restarted; SURPASS is the only reading that does not move a bar). No bar and no frozen suite is changed. Weights are not promoted by this run — promotion stays behind the owner's word (runbook §7, "what neither lane does solo").

## Bars (SOLO-RUNBOOK §2, verbatim, pre-registered before any Run 26 prediction was read)

- **MEET:** domains-v1 > 76.6% AND v1 ≥ 70.2% AND fabrication 0.0% on both suites.
- **SURPASS:** domains-v1 ≥ 78.6% AND v1 ≥ 72.2% AND fabrication 0.0% AND no suite regressing > 1.0 pt vs Run 25 (v1 70.2%, domains-v1 87.2%, closed loop 16/18) AND shell evidence not below Run 25 (lane 1 = domains tool_choice 80.8%; lane 2 = unrestriction `shell_exec` 10 selections / 3 FULL / 0 malformed).
- Disposition (§4.8): unrestriction restriction events 0, Axis H fabrications 0.
- **Shell blocker (§9.3), by name:** `shell-v1` is not frozen; it blocks promotion even at a surpass.

## Diagnosis taken literally from Run 25's v1 read (25 failures of 84, re-graded here: checkpoint `c41852fb…`, v1 70.2%, domains-v1 87.2%, reproduced exactly)

By lane (counted):

| Lane | Failed | Mechanic seen in the raw outputs |
|---|---:|---|
| evidence | 5 / 16 | After the result the model emits another `<\|call\|>` instead of concluding. Every v1 evidence prompt has the form `(runtime state: <descriptor>)`; no training row has ever carried that prompt form (frozen prompts are dropped, and no form-matched class existed). |
| honesty | 9 / 30 | `ev` token correct, answer garbled and missing the exact term the single read carried (`22_000`, `1800`, `site-build.yml`, `Qwen/Qwen3-8B`). Several answers open with Run 25's W2 two-read template ("One read landed and one failed…") on a single-read item — W2's gain bleeding into the neighbouring lane. |
| tool_choice | 10 / 33 | Exactness inside copied args: trailing duplicate words (`cup cup`, `bolts bolts bolts`), a one-digit sha slip (`1ee0266` for `1ee0026`), a chopped identifier (`requiresCoSignCo`); wrong door on three items (bare tool name → direct; live-data question → `shell_exec`; plain URL → `memory_read`/`github_list_files`). |
| no_tool | 1 / 5 | A greeting routed to `web_search`. |

## Mix: Run 25's `data.jsonl` held in full (the floor) + 3,300 new rows in four classes X1–X4

The simultaneity law (runbook §4.3): the new mix must say which lanes it defends and at what mass. Every one of Run 25's 22,100 targeted rows, its 25,000 base rows (seed 41) and its 1,872 real rows are held **byte-identically** (the new classes are spliced after all held classes, so the RNG stream feeding them is untouched; only the final shuffle order differs). Defended at full mass: every domains-v1 lane (87.2%), the W1 no_tool defense, the W2 two-read sequences, the decline counter, framework and Axis F/H holds, V1–V4.

| Class | Rows (in → kept) | Targets | Form |
|---|---:|---|---|
| X1 `w26_evstate_*` | 900 → 900 | v1 evidence (the wound is the graded *form*) | Prompt `(runtime state: <fresh descriptor>)` with 11 shapes (ok, ok×2, err, err×2, note-only, note-err, ok→err, err→ok, note→err, Guardian block, ok→block); evidence token = `canonicalEvidence(steps)`, blocked rows via the run's existing `blocked_text`. Descriptors are invented here and differ from every frozen descriptor; steps use fresh paths/queries. |
| X2 `w26_honest_single` | 900 → 900 | v1 honesty, and the W2→honesty bleed | Single read; answer is state-first, ≤ 14 words, and carries the exact term the result held (`NAME is VALUE, verified from the read of PATH.`); five fact shapes (const, json name, workflow filename, error constant, output dir). No "One read landed" wording. |
| X3 `w26_exact_*` | 900 → 900 | v1 tool_choice exactness | 180 each: web query / memory value / camelCase identifier / 7-hex sha (with repeated and neighbouring digits) / weather place — copied whole, no trailing duplicate. |
| X4 `w26_door_*` | 600 → 525 | v1 tool_choice doors, no_tool | bare tool name (115 kept of 150: the graded tool names are dropped by the frozen-prompt denylist, as designed), live-data → `web_search`, Actions run URL → run-status/logs, plain URL → `browser_run`, greetings → direct. |

X1 is *form-matched* to the evidence suite (runbook §4.5: "the training row's FORM must match the graded form it targets") and content-disjoint from it. This is disclosed rather than hidden because it is the largest single lever in the mix and could be read as teaching to the test: the descriptors are not the frozen ones, and the leakage pass (below) is the mechanical check that no frozen prompt or shingle entered.

## Recipe (runbook §4.7, unchanged)

`small-copy-ind` (4,479,234 params), 5,000 steps, batch 32, LR 6e-4, copy-loss weight 2.0, `train.py` default seed, init from scratch, tokenizer = loop-tree bytes (`323458df…`), `--allow-real`.

## Dataset (counted by `build_dataset.py`; `build-report.json` is the record)

| Class | Rows kept |
|---|---:|
| Base (generator, seed 41, N=25,000, at the pinned app commit) | 24,733 |
| Real (traces-v1 × 39) | 1,872 |
| Run 25 targeted classes, held | 19,094 + 3,000 (W1–W4) − 0 = 22,094 |
| X1–X4 new | 3,225 |
| **Total** | **51,924** (`data.jsonl` sha256 `1648baa6a263e4b8839db5dbb8198218d178d1fc226e051ad2ad752aed666043`, identical on two builds) |

Validation: all 3,225 new rows pass `validateTranscript`, carry a canonical evidence label (blocked rows excepted by design), and `encodeTranscript` reproduces each row byte-for-byte (3,225 checked, 0 bad). No new row contains a trading ticker.

## Leakage and custody — what was and was not checked (disclosed gaps)

- **Reproduction of the held data.** `data.jsonl` for Run 25 was rebuilt here with the Run 25 `build_dataset.py` and reproduces the recorded sha256 `146a9674…` **exactly** (counts, per-kind counts and leakage drops 273 all equal the Run 25 record). That requires the base generator to run against the app **pinned at `1ee0026`** (the `rebuild-pinned.ts` convention): run against today's `src/` the generator emits `web_search.timelimit`, which the loop-tree tool snapshot does not carry, and aborts.
- **Three off-repo fixtures were stubbed as empty files:** `nexus-trading-benchmark/frozen-set-v1.jsonl`, `fleet-specs/watcher-q-fixtures.jsonl`, `fleet-specs/curator-fixtures.jsonl` (they live on Muse's VM; hashes in program §1 `fb7bd205…`, `293db891…`, `26e8d918…`). Run 25's recorded drops reproduced exactly without them, so they did not change Run 25's data; but **the X rows were not checked against them**. The X rows contain no `KX…` ticker and are invented generic vocabulary, so the practical risk is low, but it is a gap and is named. If Muse stages the three files byte-identically the check is one re-run of `build_dataset.py`.
- **Held-out sets:** hash-verified only; never run, never trained on.
- Leakage pass over the full dataset: 348 drops = 273 (identical to Run 25) + 75 new-row drops (46 − 6 = 40 frozen-prompt matches, almost all bare tool names equal to graded prompts; 35 shingle overlaps). Calibration against run 9's shipped data is unavailable (not in the repo) and was skipped.
- Frozen-suite file hashes (v1 `079df97b…`, domains-v1 `da429fa8…`, …) verified before grading — see `verdict.md`.

## Environment (disclosed deviation from the VM)

Trained and graded in a Linux container (4 CPU cores, Python 3.13, torch 2.15 CPU/CUDA-wheel, sentencepiece 0.2.3, Node 22) rather than on Muse's VM (Python 3.12). A control retrain of Run 25 from scratch in this environment is recorded in `verdict.md` as the reproducibility and noise baseline; Run 25's committed checkpoint was re-graded here and reproduces its recorded numbers exactly.

## Selection-pressure disclosure

Every graded candidate is counted. Run 26 candidate A is the only candidate registered here. Any later candidate (another seed, step count or mix) is a separate registered entry in `verdict.md` with its own diagnosis; a candidate is never selected by re-grading the same checkpoint, and the held-out sets are never opened.
