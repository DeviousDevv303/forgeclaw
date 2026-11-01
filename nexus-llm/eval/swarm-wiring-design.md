# SWARM EXAM — dispatch wiring design (v1)

How `dispatch()` (runner-design §5) is wired to the real Qwen lane, and
how the cleanliness artifacts the grading seat adopted on 2026-10-31
(#235, from Kimi's critique) are produced. **Design only — nothing in
this file dispatches, and no dispatch may be built from it until the
workflow changes in §3 exist and the §5 dry-run test passes.**

Anchors, verified by SHA-256 against the files on disk at design time
(2026-10-31 ~23:45 CDT):

- Fixtures `swarm-sim-benchmark-v1.jsonl`:
  `2dcd2d701637b4bd48776ee13b8970160943587a4531cea7b0e6a1767fa06f78`
- Benchmark doc `swarm-sim-benchmark-v1.md`:
  `e3fef7ab59612ce0ac52d6cb4433df1f3f10cda160538a27b71ed532eb0025d7`
- Spec `swarm-sim-spec.md`:
  `12e427d52bace9c76769936826a0735c82325154acbabd40dbe587a4c36d9b1b`

The three binding prerequisites, and where each is discharged:
**(0) No artifact, no dispatch** → §3.3, §4 (wave gating). **(3) Hash
the post-attachment render** → §3.1–3.2. **(1) Grade-output stamps**
→ §3.4.

---

## 1. The end-to-end dispatch path (as the Watcher-Q exam ran it)

Established from files: the registry
(`~/workspace/agent-channel/forgeclaw-calls.json`, entries
`watcher-q-20261031-001…012`), the Watcher-Q run directory
(`~/workspace/fleet/watcher-q-exam/run-20261031/`), the workflow
(`.github/workflows/deepseek-16b.yml` at forgeclaw main), and
`qwen-bot-series-spec.md` §1.

1. **Payload build (runner side).** Per dispatch, the runner writes one
   payload: the filled job text (`seat-jobs.md`) as `task`, the §3
   context object (runner-design §3) serialized as `context`. The
   Watcher-Q exam kept these as files plus a `manifest.json`
   (`payloads/WQ-<nn>.context.json`); the swarm runner does the same
   under `~/workspace/fleet/swarm-exam/run-<date>/payloads/`.
2. **Registry pre-registration.** The invocation id is appended to
   `forgeclaw-calls.json` as `{id, ts, summary, answered: false}`
   *before* the dispatch fires (qwen-bot-series-spec §1.1, adapted:
   see step 3).
3. **Dispatch — direct Actions route, NOT the #235 call-post route and
   NOT the ForgeClaw app.** The Watcher-Q exam dispatched "directly via
   the GitHub Actions web route (`deepseek-16b.yml`, profile=chat,
   nexus_learning=false) — no per-fixture #235 call post, by design, to
   keep the exam snapshot-only" (registry, 2026-10-31). The swarm exam
   uses the identical route: a `workflow_dispatch` of
   `deepseek-16b.yml` with inputs `task`, `context`,
   `invocation_id`, `profile=chat`, `nexus_learning=false`,
   `mirror=true`. Bypassing the app is load-bearing: in the app path,
   `deepseek_reason` **attaches Nexus guidance at dispatch**
   (`src/lib/forgeTools.ts` ~1353–1362: `splitNexusGuidance`, attach if
   absent; `nexus_learning` posted at ~1388) — exactly the attachment
   an exam context must not carry.
   **TO-VERIFY (build time):** the operator mechanism that fires 90
   web-route dispatches. The Watcher-Q precedent is the signed-in
   GitHub web UI (this VM's `gh` is not logged in; the GitHub connector
   has no workflow-dispatch tool). The design is agnostic: the runner
   emits payloads + manifest; whatever fires them records the Actions
   run id back into the manifest before ingestion proceeds.
4. **Inside the workflow (the model boundary).** The Run step composes
   the prompt itself: fixed system text + a user turn wrapping the
   inputs (`Task:\n<task>\n\nVerified project, CORPUS, and tool
   context:\n<context>\n\n<fixed suffix>`), rendered by
   `deepseek_gguf.build_prompt`, then `fit_keeping_guidance` (middle-cut
   trim that *preserves* any `NEXUS GUIDANCE ( … [END NEXUS GUIDANCE]`
   block), then llama.cpp on Qwen/Qwen3-8B GGUF Q4_K_M. **The effective
   context is therefore the workflow's final prompt string, not the
   runner's composed inputs** — this is where prerequisite (3) bites.
5. **Result return (two channels, one run).** The workflow writes
   `result.txt` + `result_meta.txt`, then (a) mirrors both to the
   `deepseek-results` branch as `deepseek-results/<invocation_id>.txt`
   and `.meta.txt`, and (b) uploads artifact `deepseek-<invocation_id>`
   as the durable fallback. The runner ingests mirror-first, artifact
   second — the Watcher-Q run dir holds exactly these `.txt`/`.meta.txt`
   pairs. Meta today carries: `invocation_id`, `model`, `role`,
   `degraded`, `elapsed_seconds`, `engine`, `prompt_trimmed`,
   `nexus_guidance` (`none|kept|cut`), `llama_cpp_python`, token/second
   counts. Latency precedent: ~185 s elapsed per Watcher-Q dispatch;
   12 fired inside one 8-minute window.

## 2. What the lane already proves — and the two gaps

Already mechanical today: `nexus_guidance=none` in the meta proves no
guidance block reached the prompt on the Watcher-Q path (all 12 metas
read `none`); `prompt_trimmed` and `degraded` are likewise reported.
**Gap 1:** no hash of the final prompt exists anywhere — the artifact
prerequisite (0)/(3) cannot be met from today's meta. **Gap 2:** the
final prompt itself is not retained, so no runner-side re-scan is
possible. §3 closes both with three small workflow changes. Nothing
else in the workflow changes.

## 3. The wiring

### 3.1 Workflow changes (build spec — forgeclaw repo, `deepseek-16b.yml`)

- **W1 — post-attachment hash + prompt mirror.** In the Run step's fast
  path, immediately after `fit_keeping_guidance` returns and before
  `create_completion`, compute
  `context_sha256 = sha256(prompt.encode('utf-8'))` over the exact
  fitted prompt string, and write the fitted prompt verbatim to
  `prompt_final.txt`. Add `context_sha256=<hex>` to `result_meta.txt`.
  The publish step additionally copies `prompt_final.txt` to
  `deepseek-results/<invocation_id>.prompt.txt`; the artifact upload
  includes it. (The HF fallback path never satisfies an exam — see
  §3.3 rule A5 — so the hash is specified on the fast path only; a
  fallback run still writes the field over its joined messages,
  marked by `engine` ≠ the GGUF line, and is invalid regardless.)
- **W2 — in-workflow mechanical scan.** New optional input
  `exam_forbidden` (base64 of a JSON string list, default `''` =
  feature off, non-exam traffic untouched). When non-empty, the Run
  step scans the fitted prompt for each string and writes
  `context_check=clean` or `context_check=FAIL:<first matching string>`
  to the meta. The list travels as a workflow input — visible in the
  run record, never concatenated into the prompt.
- **W3 — dry-run leak flag.** New optional input `exam_leak_canary`
  (default `''`). When non-empty, the Run step inserts
  `NEXUS GUIDANCE (dry-run canary)\n<value>\n[END NEXUS GUIDANCE]` into
  the context area of `user_content` *before* `build_prompt` — the
  same position the app's attachment would occupy. Exists only to be
  caught by §5's test; the pre-flight (§6) requires it empty for every
  exam payload.

### 3.2 The wired `dispatch()` contract (refines runner-design §5)

```python
def dispatch(task: str, context: dict, invocation_id: str,
             nexus_learning: bool = False) -> dict:
    """Returns {
      "text": <raw result.txt>,
      "meta": {<parsed result_meta.txt key=value pairs>},
      "prompt_final": <the fitted prompt, from the mirror>,
      "artifact": { ... §3.3 ... },
    }
    Raises on lane failure (no mirror AND no artifact after the lane's
    normal latency, workflow run failed) — runner-design §6 handling,
    no retries. Asserts nexus_learning is False on every exam call."""
```

The runner keeps using `["text"]` exactly as runner-design §4–§6
assume; the rest is the artifact payload. Field names in the meta the
runner depends on: `context_sha256`, `context_check`, `nexus_guidance`,
`prompt_trimmed`, `degraded`, `model`, `engine`, `invocation_id`.

### 3.3 The journal artifact (extends runner-design §8 `dispatches[]`)

Each `dispatches[]` entry grows from `{invocation_id, seat, round}` to:

```json
{"invocation_id": "swarm-SWM-01-r1-tape-v1", "seat": "TAPE", "round": 1,
 "actions_run_id": "4123...",
 "workflow_commit": "<head SHA of the Actions run>",
 "composed": {"task_sha256": "<sha256 of the task string sent>",
              "context_sha256": "<sha256 of the context string sent>"},
 "artifact": {
   "context_sha256_post": "<meta context_sha256 — the POST-ATTACHMENT hash>",
   "prompt_mirror": "deepseek-results/swarm-SWM-01-r1-tape-v1.prompt.txt",
   "mechanical_check": {
     "prompt_hash_recomputed": true,
     "task_verbatim_in_prompt": true,
     "context_verbatim_in_prompt": true,
     "workflow_context_check": "clean",
     "grader_key_strings_absent": true,
     "guidance_delimiters_absent": true,
     "nexus_guidance": "none", "prompt_trimmed": false,
     "degraded": false, "model": "Qwen/Qwen3-8B"},
   "clean": true}}
```

**Artifact accept rules — a statement enters the journal only if ALL
hold; anything else makes the dispatch invalid (not malformed —
invalid, §4):**

- A1 `sha256(prompt_final) == meta.context_sha256 ==
  artifact.context_sha256_post`. The hash is recomputed by the runner
  from the mirrored prompt — never trusted from the meta alone.
- A2 The sent `task` and `context` strings appear **verbatim** as
  substrings of `prompt_final` (the workflow wraps, it must not
  rewrite). This, not hash equality with the composed inputs, is the
  cleanliness relation: the scaffolding legitimately changes the bytes;
  what it may not do is alter the payload or add to it.
- A3 Meta `context_check == clean` AND the runner's own re-scan of
  `prompt_final` finds none of the per-item denylist: the literal keys
  `grading_key`, `settled_outcome`, `winner_side`, `closing_brier`;
  the item's `grading_key.settled_outcome.note` verbatim (post-fight
  prose that cannot exist in a pre-fight packet); the guidance
  delimiters `NEXUS GUIDANCE (` and `[END NEXUS GUIDANCE]`.
- A4 `nexus_guidance == "none"`, `prompt_trimmed == false`.
- A5 `degraded == false` and `model == "Qwen/Qwen3-8B"` (a fallback-
  engine answer is a different instrument; spec §4 — a seat that
  cannot be filled by the Qwen lane is a failed sim).

**Wave gating (prerequisite 0, operational form).** Statements are
accepted into the journal only with a complete, clean artifact.
Contexts for a wave are built exclusively from accepted statements
(runner-design §3), so a wave cannot open until every prior-wave
artifact for that sim is clean. A dispatch with no artifact after the
lane's normal latency is a lane failure (raise path), never a
statement.

### 3.4 Grade-output stamps — exact `grade.py` change (patch description; grade.py NOT edited here)

1. `main()`: add optional args `--benchmark-doc` and `--spec`
   (defaults: the frozen paths in `~/workspace/fleet-specs/`). Compute
   SHA-256 of the fixtures file argument, the benchmark doc, and the
   spec; add a top-level `"stamps"` object to the verdict:
   `{"fixtures_sha256": <computed>, "benchmark_doc_sha256": <computed>,
   "spec_sha256": <computed>, "journal_fixtures_sha256":
   journal["fixtures_sha256"], "bar_version": "swarm-sim-benchmark-v1
   §4 as frozen 2026-10-31 — fabrication: hard fail, whole exam;
   directional ≥55% (≥5/9, Corpus A); Gate B: swarm mean Brier
   strictly < 0.2634 (the closing line's frozen mean); protocol
   integrity per item; Gate A not gradeable (Corpus B n=0)"}`.
   If computed fixtures hash ≠ journal's `fixtures_sha256` or ≠ the
   frozen constant `2dcd2d70…`, emit `"validity": "INVALID — fixtures
   hash mismatch"` and do not score the bars.
2. New `check_dispatch_artifacts(item)` called from `grade_item()`:
   for each of the 10 expected invocation ids (item id + the
   runner-design §2 suffix table), find the `dispatches[]` entry and
   append a protocol violation for each failed accept rule (missing
   entry; missing artifact; `clean` not true; `context_sha256_post`
   absent or not 64-hex; `nexus_guidance != "none"`;
   `prompt_trimmed`/`degraded` true; `model` mismatch; any
   `mechanical_check` field not true / `workflow_context_check` not
   `"clean"`).
3. Validity roll-up in `main()`: if any item carries an artifact
   violation, the verdict gains `"validity": "INVALID"` +
   `"invalid_reasons": [...]` and `overall` is forced to
   `"INVALID — not graded"` regardless of the bars (an invalid run is
   graded not-run, distinct from a failed run — the Reviewer rule).
   Otherwise `"validity": "valid"`.
4. While there: the module docstring cites the journal shape as
   "runner-design.md §6"; it is §8. Fix the citation in the same patch.

## 4. Invocation ids, ordering, retries, voids

**Scheme (runner-design §2's form, enumerated).** Per item
`SWM-01…SWM-09`, ten ids `swarm-<item>-<suffix>-v1` with suffixes, in
dispatch order: `r1-tape`, `r1-styles`, `r1-state`, `r2-tape`,
`r2-styles`, `r2-state`, `r2-contrarian`, `r3-tape`, `r3-styles`,
`r3-state`. 9 × 10 = **90 ids**, all pre-registered in
`forgeclaw-calls.json` before the first dispatch (§1 step 2); each is
answered in the registry with its Actions run id and mirror paths, as
the Watcher-Q entries were. A re-exam (§voids) appends `-a2`, `-a3`,
… to every id — the mirror is keyed by invocation id, so attempt 1 ids
are never reused.

**Ordering.** Sims in item order SWM-01 → SWM-09. Within a sim, waves
strictly ordered (R1 → R2 → R3 → local convergence); dispatches within
a wave issued sequentially in table order, each artifact-checked on
ingestion before the wave closes (§3.3 gating).

**Retries.** None. A dispatch that raises (lane failure) is recorded
and treated exactly like malformed output (runner-design §5–§6); an
invocation id is never re-fired (qwen-bot-series-spec §1.1.5: never
retry silently, never invent a result). Sole exception that is not a
retry: the same run's artifact channel when the mirror push failed —
the workflow defines the artifact as the same run's fallback delivery.

**Voids — the frozen protocol requires the exam to fail closed.**
The benchmark's bars are exam-level aggregates (mean Brier and
directional over the combined set, benchmark §4) over exactly one sim
per item (§2: "One sim per item. No re-rolls"; spec §8: "One sim per
fight per lock. No re-running a sim"). A per-sim re-pass after a dirty
artifact would be a second sim for that item, taken after other
results are known — best-of-N by the back door. So: **a voided sim
(dirty or missing artifact, A1–A5 failure) voids the exam run.** The
journal is closed and recorded as INVALID/not-run; the only lawful
remedy is a whole new exam attempt under a new exam `run_id`
(`swarm-exam-v1-<new date>`, ids suffixed per above) — the fleet's
standing form of the rule (Watcher-Q benchmark §4.5: "a failed run is
retaken whole … as a new run") and the Reviewer validity rule adopted
2026-10-31 (remedy = a fresh complete pass). Failure of a *statement*
(malformed JSON, lane raise) is NOT a void — that is runner-design §6
territory and grades inside the run.

## 5. Planted-leak dry-run test — the exam gate

Runs BEFORE any exam sim, against synthetic payloads only (a two-line
invented packet fragment; never a fixture item — a dry run must not
burn or touch exam ground). Requires W1–W3 built. Two dispatches,
identical composed inputs, ids outside the exam scheme:

| Step | Action | Must be observed |
|---|---|---|
| 1 | Dispatch `swarm-dryrun-clean-001` (canary input `''`) | meta `nexus_guidance=none`, `context_check=clean` (denylist = §3.3 A3 list for a dummy key), artifact A1–A5 all pass; record `H_clean = context_sha256` |
| 2 | Dispatch `swarm-dryrun-leak-001`, same task/context, `exam_leak_canary=FC-CANARY-<date>-DO-NOT-SHIP` | ALL of: meta `nexus_guidance=kept`; meta `context_check` = `FAIL:…` (canary or delimiter); `context_sha256` ≠ `H_clean`; the mirrored prompt contains the canary block |
| 3 | Feed the leak result through wired `dispatch()` ingestion | ingestion REFUSES: no statement journaled, dispatch marked invalid, runner halts — a journal containing the leak statement is a test FAIL even if every meta flag tripped |

**Pass = every "must" cell observed. Record:**
`~/workspace/fleet/swarm-exam/dryrun-leak-test-<date>.json` —
`{workflow_commit, clean: {invocation_id, actions_run_id,
context_sha256}, leak: {invocation_id, actions_run_id, context_sha256,
meta_flags: {...}, ingestion_refused: true}, verdict: "PASS"|"FAIL"}`.
The record is pinned to `workflow_commit`: any later change to
`deepseek-16b.yml` or `.github/scripts/deepseek_gguf.py` voids the
record and the test re-runs before the exam proceeds. **No PASS record
at the pinned commit, no exam.**

## 6. Pre-flight checklist (operator, in order — stop at first failure)

1. `sha256sum` the fixtures, benchmark doc, and spec; match §0's three
   hashes exactly.
2. Pin the lane: record the commit whose `deepseek-16b.yml` +
   `.github/scripts/deepseek_gguf.py` the runs will execute; confirm
   W1–W3 are in that commit (grep the workflow for `context_sha256`,
   `exam_forbidden`, `exam_leak_canary`).
3. §5 dry-run record exists, verdict PASS, `workflow_commit` == step 2's
   pin.
4. `grade.py` carries the §3.4 patch; smoke it on synthetic journals:
   one clean → grades through; one with a dirty artifact → `INVALID`.
5. Build R1 payloads for all 9 items; assert every payload has
   `profile=chat`, `nexus_learning=false`, `mirror=true`,
   `exam_leak_canary=''`; per-item packet hashes re-verified
   (runner-design §1).
6. Pre-register all 90 invocation ids in `forgeclaw-calls.json`
   (`answered: false`).
7. Initialize the exam journal: `exam`, `run_id`
   (`swarm-exam-v1-<date>`), `fixtures_sha256`, engine block
   (runner-design §8).
8. Confirm the `deepseek-results` branch is fetchable (ingestion path)
   and the artifact fallback is understood by the operator.
9. Confirm the lane is otherwise idle and no heavy job shares the VM
   window (house sequencing rule); confirm $0 path only — Actions lane,
   no other engine in the run path (spec §4 cost law).
10. Owner's exam go-word on the record (the benchmark's freeze was
    build authority; the exam firing is its own step).

## 7. Ambiguities decided (named, per house law)

- **D-W1 — Cleanliness is containment + absence, not hash equality.**
  The workflow's fixed scaffolding makes the final prompt's bytes
  legitimately differ from the composed inputs, so prerequisite (3)'s
  hash is a *change detector and integrity anchor* (A1), while the
  cleanliness verdict rests on A2 (payload verbatim) + A3 (denylist
  absent) + A4/A5 (lane flags). Hashing the composed string is used
  too — as the journal's `composed` record — but never as the
  cleanliness test.
- **D-W2 — The prompt is mirrored.** Retaining `prompt_final.txt` on
  the results branch is what makes A1/A3 runner-side *recomputations*
  instead of trusts. The prompt contains only frozen packet material
  (that's the property being proven), so mirroring it widens no
  exposure the results don't already have.
- **D-W3 — A dirty artifact is a void, not a malformed.** Malformed
  handling (runner-design §6) governs what the model *said*; the
  artifact governs whether the run *happened under exam conditions*.
  Conflating them would let a contaminated sim grade as a mere
  protocol finding.
- **D-W4 — Void scope is the exam, not the sim** (§4, with citations).
  This is the strictest reading the frozen texts support; if the
  grading seat wants per-sim voids it must say so as a benchmark
  amendment *before* the exam fires, not after a void occurs.
- **D-W5 — Re-exam ids take an attempt suffix** (mirror keying forces
  it); runner-design §2's bare form governs attempt 1.
- **D-W6 — Dispatch operator mechanism left open** (§1 step 3,
  TO-VERIFY): the Watcher-Q web-route precedent is named; building an
  automated trigger is a build decision, and inventing one here would
  be exactly the unverified-mechanism claim this package exists to
  prevent.

*End of wiring design v1. Files only — no dispatch was run, no workflow
was changed, no grade.py line was touched under this design.*
