# Spiderlings on the throne rig (v1)

Built by the Claude lane at the owner's directive (2026-11-04). Spiders live on the existing `ThroneRig` (`?rig=1`), painted onto the
backdrop. They leave the chair, run the painted cables to their task cubes, and climb back to the circle at the throne's chest when the
tool answers. App path only: nothing under `.github/`, no workflow, no file the exam anchor pins.

## See it
- `?rig=1`: live. Spiders appear only for real tool events from the running app. Idle means nothing is drawn.
- `?rig=1&spiders=demo`: a **scripted demo**, labelled `DEMO · simulated events · not live` on the panel and `data-source=demo`.
  It feeds its own ledger and never reads, or mixes into, the live one.
- No `?rig=1`: the app is unchanged (no canvas, no panel).

## What a spider is
| Ledger line | Comes from (already emitted, `src/types/forgeOps.ts`) | On screen |
|---|---|---|
| `out` | `TOOL_START` | a spider leaves the seat, runs the cable to its node, works there |
| `returned` | `TOOL_SUCCESS` | climbs the thigh-light back to the chest circle; green ring on docking |
| `flagged` | `TOOL_FAILURE` | same journey trailing red thread; red ring |
| `unresolved` | `MISSION_COMPLETE` / `MISSION_BLOCKED` / `RESET` with the tool unanswered | grey marker that fades (not counted as returned) |
| unknown (derived, not stored) | a start unanswered past its tool's timeout | grey dashed marker, still; never drawn as working |

Channels: `browser_run` → browser; `shell_exec`, `shell_patch`, `sculpt_self`, `run_js` → sandbox; `qwen_reason`, `ask_qwen`,
`github_*`, `web_search`, `http_fetch`, … → network. Local tools (`memory_*`, `funds_*`, `spawn_agent`, …) get no spider.
Timeouts come from the repo's own limits (browser-agent 12 min, shell-exec 10 min, qwen3-8b 30 min).

## Surface laws
- **No decorative spiders.** A spider exists only for a ledger run; the canvas publishes what it drew (`data-spiders-drawn`,
  `data-spider-phases`) and the browser tests compare that with the ledger.
- **Every number traces to lines.** The counters are counted from the ledger lines (never a separate tally); the panel lists the
  lines with their times and says `showing the newest 12 of N lines` when it truncates.
- **"As of" and "since".** The panel states when it was computed and when counting started (this session).
- **Staleness.** An unanswered start past its timeout reads UNKNOWN, with the reason in its line.

## Anchors (backdrop pixels, 1536×1024)
Seat (770, 505) → cable sockets (572,610) browser / (770,540) network / (958,610) sandbox → task cube. Far nodes are painted floor cubes
(browser 440,655; sandbox 1104,660; network 1335,548); near nodes (548,690; 996,692; 772,648) are used when a phone's `cover` crop hides
the far one. Return: up the thigh-light (580,548 / 955,548) to the chest circle (760,298).

## Limits (said plainly)
- Events carry no run id yet (v2): an end event is paired with the OLDEST unanswered start of the same tool. Two concurrent runs of one
  tool can swap outcomes; counts stay correct.
- The rig canvas sits behind the chat, so during a real turn the message cards cover much of the painting (most of it on a phone); the
  panel and the node tags are the readout there. The demo shows the spiders unobstructed.
- Muse-runner feeds (grading, training) are v2; there is no event for them in the app.

## Tests
- Unit: `src/lib/spiderlings.test.ts` (ledger, counters, staleness, invariants), `src/components/spiderRoutes.test.ts` (anchors, paths, poses),
  `src/components/spiderPanel.test.tsx` (panel and rig wiring, idle canary, DEMO flag).
- Browser: `e2e.cjs` here, against the production build, desktop 1100×900 and phone 443×853, GitHub stubbed with the real runner result
  files; results in `e2e-results.json`, screenshots next to it (`1-idle` … `8-demo-final`, `-desktop` / `-phone`).
  `node docs/display-layer/spiderlings/e2e.cjs docs/display-layer/spiderlings` after `vite build && vite preview --port 4173`.
