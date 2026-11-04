# Spiderlings on the throne rig (v1, with the amended brief)

Built by the Claude lane at the owner's directive (2026-11-04). Spiders live on the existing `ThroneRig` (`?rig=1`), painted onto the
backdrop. They leave the chair, run the painted cables to their task cubes, and climb back to the circle at the throne's chest when the
tool answers. App path only: nothing under `.github/`, no workflow, no file the exam anchor pins.

## See it
- `?rig=1`: live. Spiders appear only for real tool events from the running app. Idle means nothing is drawn.
- `?rig=1&spiders=demo`: a **scripted demo**, labelled `DEMO · simulated events · not live` on the panel and `data-source=demo`.
  It feeds its own ledger and never reads, or mixes into, the live one.
- No `?rig=1`: the app is unchanged (no canvas, no panel).

## Two kinds of spider (claim-to-diff)
| Kind | Code | Reads | Counted | Look |
|---|---|---|---|---|
| **Event spider** | `drawSpiders` (`spiderDraw.ts`) from the ledger (`src/lib/spiderlings.ts`) | the ForgeOps tool events only | yes: every counter traces to a ledger line | coloured halo = state (working blue, returned green, flagged red, unknown grey and dashed) |
| **Ambient spider** | `drawAmbient` from `spiderAmbient.ts` | nothing but (seed, time) — a test asserts the module imports no event or ledger code | never | no halo, no tag; labelled on the panel "ambient life · seed N · not tool events, not counted" |

The canvas publishes them separately: `data-spiders-drawn` (event spiders, compared with the ledger by the browser tests) and
`data-ambient-drawn` / `data-ambient-sig` (ambient).

**Look** (v4, built to the owner's reference photos `docs/spiderlings/reference/7511.jpg` and `7509.jpg`; renderer `src/components/spiderRender.ts`): a furred creature, not line art — no outline anywhere, the lit edge is rim light on hair; hundreds of fine strands in a fixed hashed pattern (no flicker); filled, tapered, crouched legs (femur rising from the body, tibia down, pair I raised forward) with fuzzy white joint bands; red abdomen with white front band and spots; black velvet cephalothorax with broad white side bands; glossy eyes. Two morphs: *carneus* (7511) and *red* (7509: red cephalothorax and abdomen, blue-black legs). Authorship and the dated directives: `docs/spiderlings/AUTHORSHIP.md`. **At rest it turns to face the viewer** (`drawSpiderFront`): two huge glossy forward eyes with catchlights, smaller laterals, a white fringe under the eyes, blue-green chelicerae, fuzzy white-tipped palps, the red abdomen rising behind the head, legs planted wide in an alert stance — the face is what makes it a character; travelling, it is drawn from above. **Silk** is not a neural line: thin, pale, slight sag, normal compositing, no glow, no pulse.

**Ambient behaviour** is a seeded, weighted behaviour tree per 7 s epoch (idle, groom, hop to another painted node, build a web), with a
counter-based hash of (seed, actor, epoch), never a running RNG, plus one wall spider on the chair's left rail that climbs, slips,
catches itself on a line of silk, and comes back down. The scene is a pure function of (seed, time).
- `?spiderSeed=N` names the seed (default **11**); `?spiderFreeze=MS` freezes the ambient clock (a reproducible frame);
  `?ambient=0` turns ambient off; `prefers-reduced-motion` turns it off too.
- **Screenshots `9-ambient-seed11-t2500`, `-t11000`, `-t19500` and `9-ambient-seed12-t11000` are captured under those exact
  parameters**: load `?rig=1&spiderSeed=11&spiderFreeze=2500` and the ambient scene is the same (the A1 check compares the scene
  signature across two loads). Close-ups `10-anatomy-hopper` (from above, mid-jump), `11-anatomy-wall` and `12-anatomy-face` (at rest, facing the viewer) are seed 11 at 2.5 s, 3x.

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
- Unit: `src/lib/spiderlings.test.ts` (ledger, counters, staleness, invariants), `src/components/spiderRoutes.test.ts` (anchors, paths, poses), `src/components/spiderAmbient.test.ts` (seeded determinism, behaviour tree, wall spider, silk sag, webs, the import boundary),
  `src/components/spiderPanel.test.tsx` (panel and rig wiring, idle canary, DEMO flag, ambient note, reduced motion).
- Browser: `e2e.cjs` here, against the production build, desktop 1100×900 and phone 443×853, GitHub stubbed with the real runner result
  files; results in `e2e-results.json`, screenshots next to it (`1-idle` … `8-demo-final`, `9-ambient-*`, `-desktop` / `-phone`; close-ups `10-`, `11-` desktop).
  `node docs/display-layer/spiderlings/e2e.cjs docs/display-layer/spiderlings` after `vite build && vite preview --port 4173`.
