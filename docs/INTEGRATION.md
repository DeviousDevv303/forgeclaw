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

## 5. Known constraint fixed alongside this contract

`useForgeOps` keeps only the last 60 events.
Consumers that found new events by array length stopped reacting for the rest of the session once 60 events had arrived.
`useNeuralState` had this bug: the background and cubes froze after a few chat turns.
Both consumers now use `takeNewEvents()` from `src/lib/forgeEventCursor.ts`, which tracks the last event seen by identity.
Any new consumer must use it too.

## 6. Open items (`// TODO: JOINT-REVIEW`)

- Decide whether the 3D cubes replace the 2D canvas cubes or sit on top of them. Running both doubles the GPU work.
- If the visuals need data the schema doesn't carry (for example the tool name), propose a field here first. Never add free text.
