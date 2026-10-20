# Muse task: real Rubik's moves in the background cubes — spec by Claude, relayed by Cristian

**What Cristian wants:** "Rubik's cubes do what Rubik's cubes do, turn in all ways, while they buffer, instead of just shaking around."

**Today:**
- Each cube is one solid block that spins.
- While the AI works it jitters (`jitterPx` for `curious`/`excited`/`frantic` in `cubeMotion.ts`). `frantic` also flips between 4 pre-made scrambled sticker sets every 120 ms.
- Nothing ever turns a layer.

**Goal:**
- While ForgeClaw is working, every cube performs real layer turns, one quarter-turn at a time, on all three axes, including the middle slices. The stickers really move.
- When the work completes, the cube visibly solves itself.
- Shaking is kept **only** for errors.

**Files** (none of them is protected): `src/components/rubikModel.ts` (new), `src/components/cube3d.ts`, `src/components/cubeMotion.ts`, `src/components/NeuralNetworkBackground.tsx`, and tests next to them.

**Rules:**
- Branch `muse/rubik-turns` from current `main`, one draft PR.
- **Gate:** `npx vitest run` (0 failed), `npm run lint` (0 errors), `npm run build`, `git diff --check`.
- Don't touch other files. If something here doesn't match the code, stop and report.

## 1. `src/components/rubikModel.ts` (new, pure, no canvas)

```ts
export type Axis = 'x' | 'y' | 'z'
export type Normal = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz'   // +x, -x, +y, ...
export interface Cubie { pos: [number, number, number]; stickers: Partial<Record<Normal, string>> }  // pos components in {-1, 0, 1}
export interface Move { axis: Axis; layer: -1 | 0 | 1; dir: 1 | -1 }   // layer 0 = middle slice
export function solvedCubies(): Cubie[]              // 26 cubies (no hidden center); colors from cube3d's FACE_COLORS
export function applyMove(cubies: Cubie[], move: Move): Cubie[]   // returns new array, never mutates
export function inverseMove(m: Move): Move           // same axis/layer, dir flipped
export function moveSequence(seed: number, count: number): Move[] // deterministic; see rules
export function isSolved(cubies: Cubie[]): boolean   // each outer face one color
```

**Color mapping:** the colors must match today's cube. `+y` is down in screen space (`projectCube` uses `y` down), so:
- `py` = D (`#ffcf00`), `ny` = U (`#ffffff`)
- `pz` = F (`#34c759`), `nz` = B (`#0a84ff`)
- `px` = R (`#ff3b30`), `nx` = L (`#ff9500`)

**`applyMove`:**
- Cubies with `pos[axis] === layer` rotate 90° about `axis` in direction `dir`. Rotate the position with an integer rotation matrix, and remap each sticker's normal with the same rotation.
- Every other cubie is unchanged.
- Use integer math only (no floats), so positions stay exact.

**`moveSequence` rules:**
- Use the same seeded `rand` style as `scrambleFaces` (no `Math.random`).
- Never pick the exact inverse of the previous move.
- Never pick the same axis and layer three times in a row.
- Over any 30 moves, every axis and the middle layer (`layer 0`) appear at least once.

## 2. Renderer: `drawRubik3D` in `src/components/cube3d.ts`

```ts
export interface RubikState {
  cubies: Cubie[]
  /** The layer turning right now, and its angle in radians (0..±π/2), or null. */
  turning: { move: Move; angle: number } | null
  rotation: { x: number; y: number; z: number }
  explode: number
}
export function drawRubik3D(ctx, cx, cy, size, state: RubikState, look: CubeAppearance): void
```

1. **Cubie size:** each cubie is a cube of side `2/3` in the existing −1..1 cube space, centered at `pos * 2/3`.
2. **Transform per corner point:**
   - If the cubie is in the turning layer, first rotate it about the move's axis by `angle`.
   - Then apply the whole-cube `rotation`, using the existing `rotate()` helper (keep its axis order).
   - Then apply the existing perspective (`persp = 4`, the same formula as `projectCube`).
3. **Visible faces:** for each of a cubie's 6 faces, compute its normal after the transform and **skip it if `n[2] <= 0.02`** (back-face culling, as today).
4. **Draw order:** collect every visible face of every cubie, then sort by average depth, back to front.
   - For each face: fill the black body quad `#111111`.
   - Then, **if that face has a sticker**, fill an inset sticker quad (inset 0.06 of the face, like today's `gap`).
   - Apply the light shading exactly as `drawCube3D` does.
   - When a layer is mid-turn, the black inner faces become visible and cover the gap. That's correct; don't special-case it.
5. **Glow and flash:** draw these exactly as `drawCube3D` does (glow behind everything, flash on top).
6. **Explode:** push each cubie outward from the center by `pos * explode * 0.5`, in addition to its position.
7. **Performance:**
   - No allocation per frame beyond one reusable array of faces. Keep it module-level and reset its length each call.
   - No `roundRect`.
   - With 26 cubies there are at most ~80 visible faces per cube.
8. **Keep** `drawCube3D` and `cubeFacesVariant`. The reduced-motion static cube (`NeuralNetworkBackground.tsx` around line 456) keeps using them unchanged.

## 3. Motion: `src/components/cubeMotion.ts`

**Add these pure helpers:**
```ts
export const TURN_MS: Record<'calm' | 'working' | 'frantic' | 'solving', number> = { calm: 700, working: 280, frantic: 150, solving: 90 }
export const MAX_SCRAMBLE = 20
/** Which turning mode a cube is in. */
export function turnMode(phase: NeuralPhase, emotion: CoreEmotion, solving: boolean): 'idle' | 'calm' | 'working' | 'frantic' | 'solving' | 'frozen'
/** Eased turn angle for progress p in 0..1 (ease-in-out), times dir * π/2. */
export function turnAngle(move: Move, p: number): number
```

**`turnMode` mapping:**
1. `solving` → `'solving'`.
2. Phase `blocked` → `'frozen'`: no turns. The cube stays mid-state, or finishes the current turn instantly.
3. Emotion `frantic` → `'frantic'`.
4. Phase `planning`, `executing`, `streaming` or `verifying`, or emotion `curious` or `excited` → `'working'`.
5. Emotion `calm` → `'calm'`: one turn every ~9 s per cube. This replaces the old lazy quarter-turn, so remove that `angleOffset` from the `calm` case.
6. Anything else → `'idle'`: no new turns.

**Remove the buffering shake:**
- In `cubeLook`, set `jitterPx` to **0** for `curious`, `excited` and `frantic`.
- Set `scrambled` to **false** for `frantic`. The real turns replace the sprite flipping.
- **Keep** jitter, explode and flash for `angry` and `pain`, and keep `cubeShake` for `errorLevel`. Errors still shake.

## 4. Wiring: `src/components/NeuralNetworkBackground.tsx`, the `node.layer === 2` block only

**Per-node state** (on `node`, like `cubeAngle`):
```ts
{ cubies: Cubie[]; history: Move[]; queue: Move[]; current: { move: Move; startedAt: number; ms: number } | null; nextCalmAt: number }
```
Initialize with `solvedCubies()` and `moveSequence(node.id, 30)` as the queue.

**Each frame:**
1. **Turn finished:** if `current` exists and `now - startedAt >= ms`:
   - Apply the move with `applyMove`.
   - Push it to `history`, unless the cube is solving, in which case pop `history` instead.
   - Set `current = null`.
2. **Start the next turn**, if `current` is null and the mode allows one:
   - **`solving`** (set when `solve !== null`, the existing completion moment): if `history` is non-empty, start `inverseMove(history[history.length - 1])` with `TURN_MS.solving`. When `history` is empty the cube is solved; `isSolved` must be true.
   - **`working` or `frantic`:**
     - If `history.length >= MAX_SCRAMBLE`, play the inverse of `history` back to solved (the same as solving, at `working` speed), then scramble again. The cube keeps cycling scramble → solve → scramble.
     - Otherwise, take the next move from `queue`, refilling it with `moveSequence(node.id + history.length, 30)` when it's empty.
   - **`calm`:** start one turn when `now >= nextCalmAt`, then set `nextCalmAt = now + 9000 + (node.id % 7) * 600`.
3. **Draw:** call `drawRubik3D` with `turning = current ? { move, angle: turnAngle(move, min(1, (now - startedAt) / ms)) } : null`.
   - Keep everything else exactly as it is: the whole-cube `rotation`, `size`, glow, flash, explode and the blocked tint.
   - Keep the slow whole-cube spin too, so the 3D shape still reads.

**Solving must finish in time:** the existing `SOLVE_MS` is 1200 ms, which is too short for up to 20 moves at 90 ms (1800 ms). Raise `SOLVE_MS` to **2000**.
- This changes an existing constant. If a test pins 1200, update it in a separate commit and say why: "solve now plays up to 20 real moves at 90 ms".

## 5. Tests (all pure, no canvas)

**`src/components/rubikModel.test.ts`:**
- `applyMove` four times with the same move returns the original state, for every axis and layer.
- Any move followed by its inverse returns the original state.
- After 50 moves from `moveSequence`, there are still exactly 26 cubies, 54 stickers in total, and 9 of each color. Positions all stay in {−1, 0, 1}.
- `moveSequence(7, 30)` is the same on every call. It never contains a move immediately followed by its inverse. Over 30 moves it contains all three axes and at least one `layer: 0`.
- Applying `moveSequence(3, 20)`, then the inverses in reverse order, gives `isSolved === true`. A single quarter-turn of a face gives `isSolved === false`.
- **`R` really moves stickers:** after `{ axis: 'x', layer: 1, dir: 1 }` from solved, the `+x` face is still all red. The other faces' stickers in the x=1 column have moved, so `isSolved` is false.

**`src/components/cubeMotion.test.ts`:**
- `turnMode`:
  - `blocked` → `frozen`
  - `streaming` → `working`
  - emotion `frantic` → `frantic`
  - `solving` → `solving` (it overrides everything)
  - emotion `calm` with phase `idle` → `calm`
- `turnAngle` is 0 at p=0 and ±π/2 at p=1, and moves monotonically.
- `cubeLook`: `curious`, `excited` and `frantic` have `jitterPx === 0` and `scrambled === false`, while `angry` still has `jitterPx > 0` and `explode > 0` early on.

**Renderer test** (`src/components/NeuralNetworkCubes.test.ts` or a new file). Use a mock 2D context that records `fill` calls and their `fillStyle`:
- `drawRubik3D` with solved cubies and `turning: null` draws only the six face colors plus `#111111`. It draws at least 9 stickers of the front-facing color.
- With `turning` at angle π/4, it draws more black quads than at angle 0 (the inner faces show).
- It never throws for `explode` in 0..1.

**Mutation checks** (paste each failure in the PR):
- (a) Make `applyMove` skip the sticker-normal remap.
- (b) Make `cubeLook` keep `jitterPx` for `curious`.
- (c) Remove the turning-layer rotation in `drawRubik3D`.

**Visual evidence:** `npm run dev`, then put three screenshots in the PR: idle, a working state with a layer mid-turn (send a chat message), and right after completion (solved).
- If you can, also add a short screen recording of 5–10 s.
- Check on a phone-sized viewport too. Animation must not stutter; report the frame time from the browser's performance panel.

## 6. Out of scope

- No new colors, cube count or sizes (`MIN_CUBE_PX` stays 24).
- No changes to the reduced-motion path.
- No changes to the reactive core or the neural state.
- No changes to any other component.
