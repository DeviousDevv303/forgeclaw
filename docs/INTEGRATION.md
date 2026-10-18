# Reactive Rubik's Cubes — integration contract

Joint feature (directive from Cristian, 2026-10-18).
**Claude** owns the event system and state logic (`src/core/`).
**Manus** owns 3D rendering and animation (`src/visuals/`).
Any change to this contract is made in this file in the same PR as the code.

## 1. Where the events come from

There is no app-wide emitter with `agent:phase`, `shell:exec` or `git:fetch` events in ForgeClaw.
The real source is the ForgeOps event stream (`useForgeOps`, `src/types/forgeOps.ts`).
`useForgeCore(forgeOpsState)` (called once in `App.tsx`) feeds every new ForgeOps event into the singleton `window.forgeCore`.
That singleton maps each event to a state and broadcasts it.

```
ForgeOps events ──► useForgeCore ──► window.forgeCore (state machine) ──► window 'forgeclaw:state' ──► src/visuals/ (Manus)
                                                                     └─► forgeCore.subscribe(fn)  (in-process listeners)
```

The core is **observe-only**.
It never calls `executeTool()`, never touches Guardian or `requiresCoSign`, and adds no authority path.

## 2. The event

`window.addEventListener('forgeclaw:state', (e) => e.detail)`. The `detail` has exactly these fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `state` | `'idle' \| 'thinking' \| 'running' \| 'success' \| 'error'` | Current core state |
| `activity` | number 0.0–1.0 | idle 0.1, thinking 0.4, running 0.8, success 0.3, error 1.0 (pulses may set their own) |
| `intensity` | integer 1–10 | How strongly to react (see table) |
| `source` | `'agent' \| 'shell' \| 'git' \| 'system'` | Which subsystem caused it |
| `timestamp` | ms since epoch | When the core broadcast it |

| `emotion` | `'calm' \| 'curious' \| 'anticipatory' \| 'excited' \| 'frantic' \| 'satisfied' \| 'angry' \| 'pain'` | Emotional layer (merged from the "CubeSoul" proposal) |
| `energy` | integer 0–100 | Builds with activity (capped), decays ×0.7 per second after 3 s of quiet, back to `calm` below 5 |
| `gesture` | `'wave' \| 'celebrate'` (optional) | Present only on the one broadcast that should fire a one-off animation |

There is still exactly **one** event (`forgeclaw:state`). The CubeSoul sketch's separate `cube:soul` event and its `app.on(...)` emitter were not adopted. That emitter doesn't exist, and a second event would split the contract.

### Emotional layer mapping (source of truth: `emotionForEvent`)

| Real signal | emotion | energy gain | gesture |
| --- | --- | --- | --- |
| `OBJECTIVE_RECEIVED` | curious | 30 | |
| operator typing in the chat box (only while `idle`, at most 1/s) | anticipatory | 40 | |
| `TOOL_START` shell tool | frantic | 80 | |
| `TOOL_START` GitHub read (`github_read_file`, `_list_files`, `_repo_state`, `_search_code`, `_verify_commit`) ("fetch") | excited | 40 | wave |
| `TOOL_START` other tool | excited | 60 | |
| `TOOL_SUCCESS` `github_write_file` / `shell_patch` ("push") | satisfied | 20 | celebrate |
| `TOOL_SUCCESS` shell tool | satisfied | 20 | |
| `TOOL_FAILURE` | angry | 90 | |
| `MISSION_COMPLETE` | satisfied | 20 | |
| `MISSION_BLOCKED`, `GUARDIAN_WARNING` | pain | 100 | |
| `RESET` | calm | energy set to 0 | |

Decay broadcasts reuse the current `state`, with `source: 'system'` and `intensity: 1`.

**Privacy:** payloads never include prompt text, error messages, tool output or credentials. A test enforces this.

## 3. Mapping (source of truth: `mapForgeOpsEvent` in `src/core/forgeclawReactiveCore.ts`)

| ForgeOps event | state | intensity | source |
| --- | --- | --- | --- |
| `OBJECTIVE_RECEIVED` | thinking | 3 | agent |
| `PHASE_CHANGE` OBJECTIVE / PLAN / VERIFICATION / NEXT_ACTION | thinking | 4 | agent |
| `PHASE_CHANGE` EXECUTION | running | 6 | agent |
| `PHASE_CHANGE` COMPLETE | success | 5 | agent |
| `PHASE_CHANGE` BLOCKED | error | 9 | agent |
| `TOOL_START` | running | 7 | shell (`shell_*`), git (`github_*`, `git_*`), else agent |
| `TOOL_FAILURE` | error | 7 | same as above |
| `MISSION_COMPLETE` | success | 6 | agent |
| `MISSION_BLOCKED` | error | 10 | agent |
| `GUARDIAN_WARNING` | error | 8 | system |
| `RESET` | idle | 1 | system |
| everything else (checkpoints, confidence, threads, retries) | no broadcast | | |

`success` relaxes to `idle` (source `system`) after `SUCCESS_HOLD_MS` = 1500 ms unless another event arrives first.
`error` persists until the next non-error event or `RESET`.

Directive helpers are also available:
- `forgeCore.pulse('execution' | 'complete', activity)`: a one-off burst, source `shell`.
- `forgeCore.trigger('git_activity')`: running, source `git`.

## 4. Rules for the visual layer (Manus)

1. **Late mount:** read `window.forgeCore?.getSnapshot()` first. Then listen for `forgeclaw:state`. `eventQueue` holds the last 20 broadcasts.
2. **Bursts:** one chat turn can produce several events within a few milliseconds.
   - Treat each event as a new *target*, and ease toward it inside your render loop.
   - Don't restart animations, and don't start timers per event.
   - A `setTimeout` per cube per event (as in the first orchestrator sketch) piles up timers and is never cleaned up. Stagger with per-cube phase offsets in the render loop instead.
3. **Cleanup:** remove the `forgeclaw:state` listener and cancel your `requestAnimationFrame` on unmount.
4. **Reduced motion:** when `prefers-reduced-motion: reduce` is set, show state with color only, with no rotation or shake. This matches the existing 2D background.
5. **No WebGL:** fall back to the existing 2D canvas cubes in `NeuralNetworkBackground.tsx`. They already react to the same states through `useNeuralState`: spin, pop, shake, freeze, and the green "solve" flash (`src/components/cubeMotion.ts`).
6. **Targets:** reaction within 100 ms of the broadcast (dispatch is synchronous). 60 fps on a mid-range phone.

## 4b. Living cubes (2D body, shipped)

The live 2D canvas cubes now consume `forgeclaw:state` directly. They are the reference "body" until a 3D layer replaces them.
- Rules: `cubeLook()` in `src/components/cubeMotion.ts`, with one unit test per behavior row.
- All motion is computed from timestamps inside the render loop. There are no per-cube timers.

| emotion / gesture | Cubes |
| --- | --- |
| calm | slow drift, breathing glow, a lazy quarter turn about every 9 s |
| curious (AI thinking) | rapid micro-rotations, pulsing glow, slight jitter |
| anticipatory (typing) | wobble + scale bounce |
| excited | faster spin, glow |
| frantic (shell) | 4.5 rad/s spin, shake, scrambled faces flicker, intense glow |
| satisfied (success) | slow spin, green glow + fading flash (plus the existing square-up "solve") |
| angry / pain (error) | the 9 pieces fly apart and snap back (800 ms), red glow + flash, shake |
| gesture `wave` (git read) | Mexican wave: a full turn + blue flash, staggered 100 ms left to right |
| gesture `celebrate` (git write) | double spin + gold glow, staggered 50 ms |

Energy scales glow intensity. `blocked` still freezes rotation, except while exploding. Measured at 61 fps in Chromium at phone size while frantic.

## 5. Known constraint fixed alongside this contract

`useForgeOps` keeps a bounded window of events (`MAX_EVENTS`, raised from 60 to 500).
Consumers that found new events by array length stopped reacting for the rest of the session once the window was full.
`useNeuralState` had this bug: the background and cubes froze after a few chat turns.
Both consumers now use `takeNewEvents()` from `src/lib/forgeEventCursor.ts`, which tracks the last event seen by identity.
Any new consumer must use it too.

## 6. Open items (`// TODO: JOINT-REVIEW`)

- Decide whether the 3D cubes replace the 2D canvas cubes or sit on top of them. Running both doubles the GPU work.
- If the visuals need data the schema doesn't carry (for example the tool name), propose a field here first. Never add free text.
