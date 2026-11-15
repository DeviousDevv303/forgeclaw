# Shell census — counted 2026-10-31 (build step 2, traces-v1)

Definition used throughout: a **usable shell trace** is a record carrying an invoked command (or an executed verification run) **plus its outcome**, in a form a shaper can render without inventing either half. Prose that mentions a command, prescribes a command, or discusses the shell tool is counted separately and never upgraded.

| Source | Records examined | Usable (command + outcome) | Success / clean outcomes | Failure / divergence outcomes |
|---|---|---|---|---|
| nexus-intake.jsonl | 548 lines | **0** | — | — |
| watcher-proving.json | 10 graded reports, 2 divergences | **4** (git-fetch cross-checks recorded inside grade/divergence entries) | cross-check agreed with the first read in the clean grades | the Report 2 cross-check caught the stale head (f81aad4 vs live 4719bfdc) |
| fallacy-audit LEDGER.md | 39 findings (F-001..F-039) | **18** (table rows whose verification was an executed headless run) | verifications that confirmed the claim (see manifest verdict split) | F-014's executed re-read DENIED its claim; cleared suspects fill the pass log |
| cron.d job bodies | 21 files (5 live, 16 archived) | **0** | — | — |
| daily logs ~/memory/2026-10-*.md | 25 files | **0** | — | — |
| agent-channel/*.md | 383 files | **0** | — | — |
| Bank deploy/verify + watch scripts (.scratch, workspace root) | 39 deploy + 32 verify scripts (31 pairs), 3 watch shell scripts, 4 logs | **0 as journaled traces** (artifacts, shaping source for a later pass) | — | — |

**Headline total: 22 usable real shell episodes exist on disk** — every one of them buried in prose inside the fallacy ledger's findings or the Watcher's grading record. **Zero** exist in grammar-ready form, and zero exist in the intake stream the corpus actually reads. This is the shell domain's version of the admitted-data verdict: the loop *does* shell work constantly and journals almost none of it in consumable shape.

## Per-source detail
### intake
- total_lines: 548
- kinds census (548 lines): suspect-cleared 115, live-molding-record 105, molding-event 87, decision-outcome 80, suspect-new 64, strategy-calibration 27, finding-confirmed 26, campaign-mandate 12, build 5, decision 4, verified-research 3, watcher-grade 3, grade 3, verified-corpus 2, verified-corpus-candidates 2, owner-doctrine 2, verdict-dismissed 1, reasoning-principle 1, settlement 1, post-mortem 1, project-decision 1, owner-admission 1, live-trading-record 1, crew-lead-action 1
- lines_mentioning_shell: 1
- prose_lines_with_command_and_outcome_tokens: 21
- usable_shell_traces: 0
- note: No intake record is a shell-execution record: no kind carries an invoked command plus its structured outcome. The command+outcome lines are Bank/audit prose that mention commands inside narratives (e.g. the F-037..F-039 parser records).

### watcher_proving
- graded_reports: 10
- divergences: 2
- clean_grades: 7
- divergence_grades: 2
- records_of_git_fetch_crosscheck_command_plus_outcome: 4
- usable_shell_traces: 4
- note: Each git-fetch cross-check is a real (command + outcome) shell episode recorded in prose inside a grade/divergence entry: the command was run by the grader and its result decided the verdict. The remaining grade verifications were API/D1 reads (tool calls, not shell).

### fallacy_ledger
- finding_ids_total: 39
- finding_rows_in_table: 38
- finding_carried_in_pass_prose_only: ['F-017']
- table_rows_whose_verification_was_an_executed_headless_run: 18
- whole_file_headless_mentions: 64
- whole_file_vitest_mentions: 65
- whole_file_structured_N_over_N_outcome_strings: 355
- usable_shell_traces: 18
- note: A table row marked headless records at least one executed verification run (scratch vitest / real-code headless run) with its outcome deciding the verdict — e.g. F-039: real parseNexusIntake over the published 534-line file -> 511 records. Pass-log prose carries many more executed gate runs (the N/N strings), not individually trace-shaped.

### cron_bodies
- total_files: 21
- live_files: 5
- archived_files: 16
- bodies_with_verbatim_shell_commands: 1
- bodies_that_are_shell_scripts: 0
- usable_shell_traces: 0
- note: Job bodies are prose instructions to agents. Exactly one live body (fleet-watcher) prescribes verbatim shell commands (git fetch origin main + git log -1 in a scratch clone) as its freshness cross-check; a prescription is not an execution record.

### daily_logs
- files: 25
- shell_exec_mention_lines: 52
- mention_lines_also_carrying_an_outcome_token: 32
- usable_shell_traces: 0
- note: Daily logs journal shell_exec design decisions, wiring history and directives in prose. Even the lines that pair a mention with an outcome word do not carry the invoked command string plus its structured result, so none are trace-usable as recorded.

### agent_channel
- files: 383
- files_mentioning_shell_exec: 4
- shell_exec_mentions: 7
- usable_shell_traces: 0
- note: Mentions are directives/discussion about the shell tool (incl. the ForgeClaw shell_exec design thread), not executed (command + outcome) records.

### bank_scripts
- nb_deploy_scripts: 39
- nb_verify_deploy_scripts: 32
- deploy_verify_pairs: 31
- nb_python_files_in_scratch: 93
- watch_shell_scripts: 3
- watch_logs: 4
- usable_shell_traces: 0
- note: The deploy/verify scripts are codified shell operations (each deploy script posts a bundle, each verify script checks 10 bindings and deployment at 100%) and the watch scripts/logs are command+output streams, but none of them is journaled as a graded (command + outcome) episode in a corpus record; they are a shaping source for a later pass, counted here as artifacts, not traces.

## Context only — synthetic shell rows already in run 9 data (NOT census material)
- run9-combination/data.jsonl shell kinds: {'shell_check': 1000, 'shell_run': 1000} — all `synthetic: true`, the generator's shell_run/shell_check makers. They exist so the census's zero is not misread: the model has seen synthetic shell shapes; it has never seen a real one.

## What this means for the shell lane (program §9.3, promotion blocker)
- The perfection lane cannot be fed from a journal that does not exist. Two honest supply paths: (a) shape the ledger/proving prose episodes in a later pass (the same prose-join discipline as the trading shaper, `value_source: prose` disclosed per trace); (b) capture going forward — every graded shell episode journaled in consumer shape at the time it runs. Path (b) is the only one that scales, and it is a journaling change, not a training change.
