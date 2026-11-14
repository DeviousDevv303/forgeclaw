# Display layer: event sources for the throne spiders (DRAFT inventory; builds nothing)

Written by the Claude lane on 2026-11-03 at the owner's word ("Write the event-source inventory — spiders on the existing ThroneRig, per-channel start/end/flagged events, counters from the journal."). Spec being served: the owner's "spiders live in the throne scene" rule on #235 (comment 6615517798): a spider's destination is the task's real channel, it shows only while a run is genuinely in flight, it returns to the throne, a flagged one returns with red thread, and no motion exists without a recorded line behind it. Visual targets: `agents-tab-throne.png` (the real AGENTS tab) and `spider-sketch.png` (the simulated sketch; its browser, terminal and network boxes are NOT on the painting).

## 1. Correction to my first note on #235
I said the display layer had "no journal entry" for browser, sandbox and training. That was true of the **run journal** (`src/lib/runRollback.ts`, a rollback ledger with four kinds) but it was the wrong place to look. The app already has an **event stream** (`emitForge`, `src/types/forgeOps.ts`) with `TOOL_START`, `TOOL_SUCCESS` and `TOOL_FAILURE`, each carrying the tool name, plus `MISSION_COMPLETE` and `MISSION_BLOCKED`. `ThroneRig` already reads that stream, through `useNeuralState`. Start, end and flagged exist today for every tool; what is missing is listed in section 4.

## 2. What exists today
| Source | What it gives | Where |
|---|---|---|
| ForgeOps stream | `TOOL_START {tool, iter}`, `TOOL_SUCCESS {tool}`, `TOOL_FAILURE {tool, failClass}`, `PHASE_CHANGE`, `MISSION_COMPLETE`, `MISSION_BLOCKED {reason}` | `src/types/forgeOps.ts`; emitted in `src/App.tsx` (about 15 sites) |
| `useNeuralState` | folds the stream into `{phase, provider, activeToolCount, tokenVelocity, errorLevel, completedAt}` | `src/hooks/useNeuralState.ts` |
| `ThroneRig` | draws the cube and light on cables, pinned to the 1536×1024 backdrop; reads only `NeuralState`; mounted by default (the `?rig=1` preview flag was removed 2026-11-10) | `src/components/ThroneRig.tsx` (anchors: `CUBE`, `CABLES`, `HANDS`, `HEAD`) |
| Run journal | dispatch ledger for rollback: `workflow_dispatch {workflow, needle(invocation id), since, label}`, `branch_created`, `branch_advanced`, `irreversible` | `src/lib/runRollback.ts`; recorded in `forgeTools.ts` for `qwen_reason`, `shell_exec`, `shell_patch`, `sculpt_self`, `github_run_workflow` |

## 3. Channel by channel
| Spider destination (owner's rule) | Real channel in the code | Start / end / flagged available today | Gap |
|---|---|---|---|
| Web-form firing → browser | tool `browser_run` → `runBrowserRound` → workflow `browser-agent.yml` | stream: yes (`TOOL_*` with `tool: 'browser_run'`). Journal: **none** (`runBrowserRound` records no dispatch) | no run id on the event; concurrent browser sessions cannot be told apart |
| API conversion → network node | `qwen_reason` / `ask_qwen` → `qwen3-8b.yml`; `github_run_workflow` for any workflow | stream: yes. Journal: yes (`workflow_dispatch` with the invocation id as `needle`) | the stream event has no id, so it cannot be matched to the journal line it belongs to |
| Sandbox execution → terminal | `shell_exec` → `shell-exec.yml`; `shell_patch`, `sculpt_self` | stream: yes. Journal: yes | same id gap |
| Runner grading → terminal/console | swarm and exam grading run on Muse's runner and VM, **outside the app** | none in the app | needs a feed from Muse's runner (its journal or the `qwen-results` / `deepseek-results` mirror) |
| Nexus training → neural net | Run 18 and later runs on Muse's VM | none in the app | needs start, checkpoint and end lines from Muse's runner |
| Return to the throne | `MISSION_COMPLETE` (already sets `completedAt`, which drives the cube's solve moment) | yes | none |
| Flagged, returns with red thread | `TOOL_FAILURE` and `MISSION_BLOCKED` (already raise `errorLevel`) | yes | none |

## 4. What the "no decorative spiders" rule needs that does not exist
1. **A run id on every tool event.** Add `runId` (the invocation id the tool already generates) and `channel` to `TOOL_START`, `TOOL_SUCCESS` and `TOOL_FAILURE`. Additive fields; no existing reader breaks. Without it, two same-tool runs in flight draw one spider, and an end event cannot be paired with its start.
2. **A persisted activity log.** The stream is in memory; the run journal is cleared per run. "Bound to a journal line" means each spider and each counter must trace to a stored line. An append-only log of `{runId, channel, startedAt, endedAt, outcome}` gives the counters ("returned 45", "flagged 2") a source; the sketch's numbers are simulated.
3. **A staleness rule.** A start with no end must not show "occupied" forever: after the tool's own timeout, show unknown, never working.
4. **Feeds from outside the app** (grading runner, training): only Muse's side can emit them; the app can read a mirror file, as it already reads `qwen-results`.
5. **Where the surfaces sit.** The painted backdrop has the throne, the cube, three cable sockets and two armrest cuffs. The sketch's browser, terminal and network boxes are not on it, so they need either new anchor regions on the rig or a small overlay panel. That is a design decision for the owner.

## 5. Proposed contract and tests (not built)
- A spider exists for every `runId` that has a start and no end, positioned at its channel's surface; it is removed on `TOOL_SUCCESS` (returns to the throne, count up) or `TOOL_FAILURE` (returns with red thread, flagged count up).
- Tests, from a scripted event list: no events → no spiders; N starts → N spiders; start then success → 0 spiders and `returned` +1; start then failure → 0 spiders and `flagged` +1; a start past its timeout → no occupied state; counters equal the stored log, never an independent tally.
- A canary for the rule itself: render with the log empty and assert every surface reads idle.

## 6. Open questions
1. Owner: where do the surfaces sit (new anchors on the painting, or an overlay)?
2. Seat: will Muse's runner emit start, checkpoint and end lines for training and grading, and in what form?
3. Seat: build slot and acceptance bar for the display layer.


## 7. Status update (2026-11-04): v1 built
The spiders are built on `ThroneRig` from the events in section 2 (no new event infrastructure), with the ledger, staleness rule, DEMO flag and tests described in `docs/display-layer/spiderlings/README.md`. Section 4 items 1 (run id), 2 (persisted log) and 4 (runner feeds) remain v2.
