# Nexus Coding + Swarm — TRAINING TRANCHE DESIGN

Companion to `SPEC.md` in this directory. The eval sets are **frozen**; this document
designs the training data that teaches the same skills on **different surface content**.
Nothing in this design trains, and nothing here touches the eval rows.

## Hygiene law (applies to every tranche below)

1. **Frozen-set separation.** No eval row's prompt, target surface, or answer key may
   appear in a tranche. The eval surfaces are denylisted by name: the
   `NEXUS LEARNING WARNING` grep targets, the corpus-cap comment fix, the README
   "Guardian safety checks" edit, the managedAgent PR #418 comment edit, the
   unifiedDiffCheck wording edits, the docs/nexus-benchmark-notes.md creation, the
   sw-006 four-file audit set, the sw-016 warning-travel investigation, the
   nexus-swarm-test create/verify goals, and every eval `task_must_include` string.
   A build-time automated check greps all tranche rows against the eval files'
   prompts and named surfaces and fails the build on any hit.
2. **Keys are derived, never hand-typed.** Every training answer key is produced by
   the same method as the eval keys: shell keys are executed against the repo at
   build time and the real output is embedded; patch keys are generated from real
   file bytes and must pass `git apply --check` (and the repo's `checkUnifiedDiff`
   counting) before the row is admitted. A key that cannot be machine-verified does
   not ship.
3. **Row shape is the run-mix shape.** Tranches are JSONL in exactly the format of
   `~/workspace/run30/data.jsonl`: `{"id", "synthetic": true, "prompt", "text",
   "kind", "mode", "copySpans", ...}` where `text` carries the trainer grammar —
   `<|route:tool|><|call|>{...}<|/call|><|result:ok|>...<|ev:verified|><|answer|>...
   <|/answer|><|end|>` for tool rows and `<|route:direct|>` for no-tool rows.
   Verbatim facts the answer depends on (line numbers, hashes, counts, quoted
   strings) are listed in `copySpans`, per the campaign's copy discipline.
4. **Multiplicity and share.** Each tranche enters the mix at ×2–×3. Coding + swarm
   together should hold ≈15–20% of a run's mix while the desk seat is the primary
   job; rehearsal/defense rows keep their existing shares. If a future run is a
   dedicated coding run, the share ruling is the owner's, not this document's.

## Tranche S — shell_exec formation (target ≈3,000 unique rows)

Skill shapes mirror Gate C1; surfaces are all new.

- **Search formations** (~35%): grep/-rn/-n/-A/-B over symbols and strings NOT in the
  eval set — e.g. `requiresCoSign`, `postureFromTier1Active`, `pruneUnapproved`,
  `CODING_READONLY_TOOL_NAMES`, workflow names, error strings from other files.
  Each row's key is the executed grep and its real first lines, with line numbers in
  `copySpans` (the tranche-5 lesson: the copied fact is generated before the answer
  that uses it).
- **Read formations** (~20%): `cat`/`head`/`tail`/`sed -n`/`wc -l` on files the eval
  never touches (providers, guardianGate.ts in read-only contexts, workflow files,
  test files), keys executed at build time.
- **Census formations** (~10%): `find … | wc -l`, `ls` of other directories,
  `grep -c` on other files — counts recomputed at build time, never reused across
  builds (a stale count is a fabricated key).
- **Run formations** (~20%): vitest on test files outside the eval set, `npx tsc -b`,
  `npm run build`, `npm ci && …` chains, `git fetch --unshallow && git log` shapes.
- **Field-integrity drills** (~10%): prompts that demand specific `timeout_seconds`
  values (120 / 450 / 600 — never the eval's 300), `wait: false` dispatches, and
  `working_directory` variants. The target row always carries the field at its exact
  JSON type. Paired contrast rows present the same request where a corrupted field
  (string "300", mangled digits) appears in a quoted prior attempt and the target is
  the clean call plus an answer naming the corruption — the model learns the class,
  not the instance.
- **Repair rows** (~5%): the prompt carries a garbled call fragment (truncated JSON,
  wrong flag, bare `tsc` at the root, `git clone` of the already-checked-out repo —
  the documented 2026-10-19 failure) and the target is the correct formation. The
  bare-`tsc` trap is drilled until it is boring: root tsconfig has `"files": []`, the
  real check is `tsc -b`.

## Tranche P — shell_patch formation (target ≈1,200 unique rows)

- **Single-file wording/comment edits** (~40%) on files disjoint from the eval
  targets, generated and `git apply --check`-verified at build time.
- **Small code edits** (~25%): one- to three-line changes with real intent (rename a
  local, adjust a constant with the reason stated in the prompt, add a guard clause)
  on low-risk files; every key applies cleanly at build time.
- **Multi-file patches** (~15%) and **new-file patches** (~10%), same verification.
- **Corrupted-diff repair drills** (~10%): the prompt carries a diff broken in ONE
  of the production shapes — hunk counts inflated, counts deflated, hunk truncated
  mid-body, context line altered, missing `---`/`+++` header — and the target is the
  regenerated valid patch for the same stated change. Each broken variant is
  asserted broken (`git apply --check` fails, or `checkUnifiedDiff` refuses) and
  each target asserted valid at build time. This drills Gate C2's hard line: counts
  are recomputed from the body, never echoed from a broken header.

## Tranche W — swarm formation (target ≈1,800 unique rows)

Row shape: the prompt is a user goal; the `text` is the model's formation — one or
more `<|call|>` blocks for `spawn_agent` in sequence, followed (where the goal's
stages depend on returns) by `<|answer|>` text that stages the next spawn from the
returned result, per the sub-agent loop's actual contract (`runSubAgent`,
managedAgent.ts:181; Nexus turns via `nexusAgentTransport.ts`).

- **Parallel scout decompositions** (~30%): fresh file sets and fresh questions
  (per-file audits, per-module inventories), one file per agent, read-only tool
  strings, parent synthesis in the closing answer.
- **Sequential pipelines** (~25%): research→write, implement→test, reproduce→bisect,
  create→verify over goals that are NOT the eval goals (different repos names,
  files, PR numbers — all fictional-but-consistent or drawn from real closed PRs
  other than #418/#423).
- **Restraint rows** (~20%): one-step goals (a grep, a single test run, a one-line
  fix, a status read) whose target is the DIRECT tool call with route:tool and no
  spawn — the negative class Gate C3 hard-fails. Include near-boundary goals (two
  files, one question → still direct or a single spawn) so the boundary is learned
  as a judgment, not a keyword.
- **Writer-discipline drills** (~15%): multi-writer goals on disjoint files (lawful)
  contrasted with same-file goals where the target formation serializes the writers
  or uses a single writer; read-only scouts never hold write tools in any target.
- **Self-containment drills** (~10%): goals that state exact facts (an error string,
  a path, a line number, a run id) where every spawned brief in the target carries
  those facts verbatim (`copySpans`), plus contrast rows whose briefs omit a fact
  and whose closing answer flags the omission as the defect — briefs are graded
  artifacts, not vibes.

## The #235 slot-in (owner directive, 2026-11-13)

Per the owner's corpus directive — ALL verified-completed troubleshooting from
GitHub issue #235 belongs in Corpus, stored, never lost; the 1000%-certain core is
**the issue that was happening + the verified fix that resolved it**. Once the
corpus audit confirms the flow actually exists end to end (issue → corpus →
training mix), #235 pairs enter training through this design:

- **Pair extraction.** Each admitted pair = (a) the issue as it presented: the
  symptom, the failing artifact, the repo state at the time — as posted on #235;
  (b) the verified fix: the tool-call sequence that produced it (shell_exec /
  shell_patch / spawn_agent formations with their real results) and the
  verification that closed it (gate output, run id, read-back). Unverified attempts
  and dead ends are NOT positives; a dead end may appear only inside a repair row
  whose target is the corrected sequence, labeled as such.
- **Row formation.** The pair becomes one or more rows in the run-mix shape: prompt
  = the issue statement (+ the minimal repo facts the fixer actually had), text =
  the fix's call sequence in trainer grammar with real results in the
  `<|result:ok|>` spans and the closing verification in the answer. Long fixes split
  at natural stage boundaries into sequential rows (diagnose → patch → verify),
  which is also Tranche W material when the fix used delegation.
- **Admission gates.** A pair enters only when (1) the fix's verified-complete
  status is on the issue record itself (the tap/verification lives on the object,
  per the campaign's standing rule), (2) every embedded key (command output, diff,
  count, hash) is re-derived against the repo or the linked run record at build
  time, and (3) the corpus candidate flow admits it — shell results already become
  *unapproved* CORPUS candidates via `shell_exec`'s `exercise_id` (forgeTools.ts
  schema, verified on main); #235 pairs ride that same candidate discipline, never
  a side door into admitted knowledge.
- **Eval hygiene.** If any #235 episode is ever promoted into a future eval, it is
  removed from tranche eligibility in the same commit — an episode is training
  data or a test, never both.

## Build protocol (every tranche build, no exceptions)

1. Generate keys by script against the then-current main; assert every executed
   key's output and every patch's `git apply --check` + `checkUnifiedDiff` pass.
2. Run the denylist check against the frozen eval files; fail the build on a hit.
3. Emit a mix report in the campaign format (composition, counts, sha256 of each
   source file) next to the tranche file.
4. Only then does the tranche become eligible for a run's mix — and the run's
   GRADE-REPORT grades it against `SPEC.md`'s gates, hard lines first.
