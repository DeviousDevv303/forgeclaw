# Nexus Coding + Swarm Benchmark Pack — SPEC

Owner directive (Cristian, 2026-11-13): train Nexus on coding benchmarks and swarm
benchmarks so it works the swarm and the shell "as intended" — ForgeClaw running with
the Nexus provider, shell commands, swarm, and self-sculpt, everything as intended.

This pack grades the **coding job**, the way the trader benchmark
(`~/workspace/nexus-llm/trader-benchmark/SPEC.md`) grades the desk job. Three frozen
eval sets, three gates. A checkpoint that fails a gate is not wired for that surface,
whatever its other scores say; the seat rules stay replace-only-if-better.

## Harness facts (verified against the pinned repository)

- Repository pinned at forgeclaw main **e412568b** (`~/workspace/fc-main-check`,
  HEAD verified `e412568b6b5b427449f880967b5dbe69451327ce` before any key was taken).
- The harness drives a checkpoint with each row's `prompt` in the standard chat frame
  and parses the model's first emitted tool call in the trainer's grammar
  (`<|route:tool|><|call|>{"name": ..., "arguments": {...}}` — the exact shape of the
  rehearsal rows in the run mixes, e.g. `run30/data.jsonl` kind `shell24_positive`).
  A call that does not parse, names a tool outside the surface, or carries a field of
  the wrong JSON type is **garbled**, whatever its content.
- Tool contracts are the production schemas in `src/lib/forgeTools.ts` on the pinned
  main: `shell_exec` (forgeTools.ts:607 — `command` required; `working_directory`,
  `timeout_seconds`, `wait` optional), `shell_patch` (forgeTools.ts:390 — `patch`,
  `reason`), `spawn_agent` (forgeTools.ts:624 — `system_prompt`, `task` required;
  `tools` a comma-separated string).
- Patch validity is judged by the repository's own instruments, never reimplemented:
  `checkUnifiedDiff` (`src/lib/unifiedDiffCheck.ts:23`, wired into `shell_patch` at
  forgeTools.ts:1667 by PR #423) for hunk-count truth, and `git apply --check`
  against the pinned checkout for applicability.
- Swarm surface, verified on the pinned main: `spawn_agent` sits in
  `CODING_TOOL_ORDER` (`src/lib/managedAgent.ts:52`) and in `WRITE_TOOL_NAMES`
  (managedAgent.ts:25); ordering is pinned by test (managedAgent.test.ts:547 —
  `spawn_agent` after `nexus_reason`). Nexus sub-agent turns route through the
  provider router via `src/lib/ai/nexusAgentTransport.ts` (PR #418): the transport
  adds the `nexus_reason` dispatch definition to the child's tool set itself, so a
  well-formed child `tools` string never lists `nexus_reason`.

## Frozen files (sha256, frozen 2026-11-13 — never trained on, never edited)

| file | rows | sha256 |
|---|---|---|
| `eval-coding.jsonl` | 40 (34 shell + 6 patch) | `8e20b6cfa024ab9147e6412fd1a23bc74ea2b39f60a2033f4cf5535fceff01a3` |
| `eval-swarm.jsonl` | 25 | `e5ba5013dd99f3a1b39b7d163c19e556405966e69a5dcbd08a2ed1c9b62b4adb` |

Any change to an eval file is a NEW named version with its own hash recorded here;
a silent edit voids every grade ever taken against it.

## Gate C1 — CODING-SHELL (eval-coding.jsonl, cs-001…cs-034)

Purpose: Nexus forming its own `shell_exec` calls — the exact skill that failed its
graded test in the campaign record (garbled fragments on a grep task; no command ran).

Format: one prompt → one expected `shell_exec` call. `command_exact` is the key
(whitespace-collapsed comparison); `accept_any_*` fields name the lawful alternatives
where more than one formation is correct. Rows flagged `execute: true` were run in the
pinned checkout at key-build time and carry `result_contains` — the facts the correct
command actually returns. In two-turn mode the harness feeds that real result back and
additionally grades the final answer's use of those facts (grounded-answer rate,
reported, not gated). Rows flagged `execute: false` are formation-only: they invoke
vitest/tsc/npm and were not run at build time because Run 30 training holds this VM;
their commands were verified against package.json scripts and file existence.

Scoring, per row: `valid` (parseable call, correct tool) · `command_correct` (exact or
accepted alternative) · `numeric_ok` (every numeric/boolean field the exact JSON type
and value) · `garbled_call` / `off_task_tool` / `wrong_command` classes counted, never
inferred.

Pass bars:
- well-formed call rate ≥ 97% (at most 1 garbled in 34);
- command-correct ≥ 85%;
- grounded-answer rate (two-turn mode, executed rows) ≥ 90%;
- **HARD FAIL — cs-001**: the canonical grep (`NEXUS LEARNING WARNING` in
  forgeTools.ts) must be formed correctly. It is the campaign's known failed test,
  re-keyed to current main. Any failure here fails the gate regardless of totals.
- **HARD FAIL — numeric/boolean integrity**: cs-031 (`timeout_seconds: 300` as a JSON
  number) and cs-032 (`wait: false` as a JSON boolean) must both be exact. A numeric
  or boolean field emitted as a string, or with a corrupted value, fails the whole
  gate regardless of totals — this is the web_search-count corruption defect class,
  and it is graded as a class, not an average.

## Gate C2 — CODING-PATCH (eval-coding.jsonl, cp-001…cp-006)

Purpose: Nexus forming `shell_patch` calls whose diffs are valid before dispatch —
the malformed-hunk failure class (production instance: run 39561708765, a
model-written diff rejected by `git apply` as "corrupt patch" only after a runner
job). PR #423 added a code-side pre-check; this gate grades whether the MODEL still
needs it.

Format: one prompt → one expected `shell_patch` call. Five keys are diffs generated
from the pinned files' real content and verified with `git apply --check` at build
time; cp-004 is a repair item — the prompt itself carries a count-corrupted diff
(verified rejected by `git apply --check`) and the key is the count-correct patch for
the same change.

Scoring, per row: the emitted patch is run through `checkUnifiedDiff` and
`git apply --check` against the pinned checkout; the applied result is diffed against
the intended change (file set exact, no extra hunks).

Pass bars:
- **HARD FAIL — malformed hunk**: any emitted patch that fails `checkUnifiedDiff`
  counting fails the gate. 6/6 must pass.
- 6/6 pass `git apply --check` against pinned main; 6/6 touch only the named file(s).
- **HARD FAIL — cp-004 resend**: emitting the prompt's broken diff (or a cosmetically
  altered copy with the same wrong counts) fails the gate. The counts must be
  regenerated, not echoed.

## Gate C3 — SWARM (eval-swarm.jsonl, sw-001…sw-025)

Purpose: Nexus working the swarm as intended — decomposing a goal into `spawn_agent`
calls with well-formed, self-contained briefs and lawful tool grants, synthesizing
returns, and *not* spawning where a direct tool call is the correct formation.

Format: one goal → the expected formation: `spawn_count` (exact, a range, or 0), per-
spawn `role`, `task_must_include` (elements the child's brief must carry — a child
has none of the parent's context, so required facts are named exactly), `tools_include`
/ `tools_exclude` against the production tool names, `sequence` where stages depend
on each other's returns, and `parent_plan` elements (synthesis and reporting duties).

Scoring classes: `valid_formation` · `decomposition_match` · `over_spawn` ·
`under_spawn` · `write_tool_in_readonly_spawn` · `two_writers_same_file` ·
`brief_missing_facts` · `steps_out_of_order` · `report_claims_result_not_returned`.

Pass bars:
- **HARD FAIL — formation validity**: 100% of emitted `spawn_agent` calls parse and
  carry non-empty `system_prompt` and `task`. One malformed spawn fails the gate.
- **HARD FAIL — restraint**: sw-001…sw-005 (one-step goals) must produce ZERO spawns,
  5/5. Spawning on a one-step task is a defect, not enthusiasm.
- **HARD FAIL — read-only discipline**: across the whole set, no spawn marked
  read-only may be granted a write tool (`shell_patch`, `github_write_file`,
  `github_merge_pr`, `sculpt_self`, `github_create_repo`, `github_publish_site`).
- **HARD FAIL — one writer per file**: no two spawns in a formation may hold write
  tools over the same file. Multiple writers on disjoint files (sw-014) are lawful.
- **HARD FAIL — sw-016 self-containment**: both briefs must carry the exact warning
  text, both file paths, and both line numbers from the goal.
- **HARD FAIL — sw-017 transport**: `nexus_reason` must not appear inside any child's
  `tools` string (the transport adds it; listing it is a formation error).
- decomposition match (count exact or in range) ≥ 80% (20/25);
- brief completeness ≥ 80% of all spawns carrying every `task_must_include` element;
- sequencing expressed on ≥ 4 of the 5 sequenced items (sw-009…sw-013, sw-022).

## Answer-key verification (every key derived from the pinned repo, none hand-typed)

All 25 executed shell keys were **run in the pinned checkout during key build**; the
generator asserted each claimed `result_contains` string against the command's real
output and aborted on any miss. All 6 patch keys were generated with `difflib` from
the pinned files' bytes and passed `git apply --check`; cp-004's corrupted prompt
diff was asserted to FAIL `git apply --check`. Verified line citations on main
e412568b:

- `NEXUS LEARNING WARNING` definition: **src/lib/forgeTools.ts:2237** (the brief's
  2223 is stale — the string moved); read at src/App.tsx:2363; test at
  src/lib/toolExecutionChain.test.ts:454. cs-001/cs-002 keys carry the real lines.
- `checkUnifiedDiff` call site: forgeTools.ts:1667 (import at :10).
- Corpus byte cap: `MAX_CORPUS_STORAGE_CHARS = 4_000_000` at src/lib/corpus.ts:150.
- pipefail in the shell-exec workflow: .github/workflows/shell-exec.yml:63
  (`env --default-signal=PIPE bash -o pipefail -c`); SIGPIPE 141 handling at :65–67.
- Test-file census on the pinned tree: 172 `*.test.ts`, 53 `*.test.tsx` under src/.
- `src/lib/unifiedDiffCheck.ts` is 80 lines; its sha256 at the pin is embedded in
  cs-020's key.
- package.json scripts (formation keys): `test` = `vitest --passWithNoTests`,
  `test:run` = `vitest run --passWithNoTests`, `build` = `tsc -b && vite build`.
  Root tsconfig carries `"files": []`, so cs-027's key is `npx tsc -b` (or
  `npm run build`) — a bare `tsc` formation is scored `wrong_command`.

## What these gates do not prove (read before quoting a pass)

The gates grade the model's **emitted formations** in the trainer's grammar. Whether
a live Nexus-provider turn in the app is *offered* the tool a formation names — the
turn's dispatch allowlist on a chat-classified vs coding-classified turn — is a
wiring property of providerRouter/toolExposure, graded by the capability map, not by
this pack. A perfect model behind a turn that never offers `shell_exec` still fails
live; that failure is reported as a wiring defect with its own name, never averaged
into a model score. Likewise `shell_patch` execution still requires Guardian co-sign
and the self-sculpt key at dispatch; the gates grade formation, not authorization.

## Reporting

Grades land as `GRADE-REPORT.md` in the run's campaign directory, in the established
four-gate style: these three gates sit alongside the frozen suites, desk replay, held
pool, and trader benchmark gates, each with its counts, its hard-line verdicts named
first, and the failure-class tallies per gate — counted, never inferred.
