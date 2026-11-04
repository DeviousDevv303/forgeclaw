// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

/**
 * Where the spiders go, in the backdrop's own pixels (1536×1024, the same space ThroneRig's anchors use) and where a spider is at
 * a given moment. Pure geometry, no canvas, so it is unit-tested.
 *
 * The story the paths tell (owner's brief): a spider leaves the throne from the cable socket under the chair, runs the painted
 * cable out to its task cube on the floor, and — when its tool answers — climbs the chair's thigh-light line back to the circle
 * at the throne's chest, where it docks with a ring: green when it returned, red when it was flagged.
 * Every anchor sits on a feature of the painting. Each channel has a FAR node (a painted floor cube) and a NEAR node (a cable
 * junction close to the chair): on a phone the "cover" crop hides the outer cubes, so the near node is used when the far one is off-screen.
 */
import type { SpiderChannel, SpiderRun } from '../lib/spiderlings'

export interface Pt { x: number; y: number }

/** The seat, between the knees: the cable sockets start here. */
export const SEAT: Pt = { x: 770, y: 505 }
/** The circle at the throne's chest (the swirl): where every spider returns. */
export const CHEST: Pt = { x: 760, y: 298 }
/** The three painted cable sockets under the chair. One per channel. */
const SOCKET: Record<SpiderChannel, Pt> = { browser: { x: 572, y: 610 }, network: { x: 770, y: 540 }, sandbox: { x: 958, y: 610 } }
/** Glowing cable junctions on the painted floor. far = a floor cube, near = close to the chair (survives a phone's crop). */
export const NODES: Record<SpiderChannel, { far: Pt; near: Pt }> = {
  browser: { far: { x: 440, y: 655 }, near: { x: 548, y: 690 } },
  sandbox: { far: { x: 1104, y: 660 }, near: { x: 996, y: 692 } },
  network: { far: { x: 1335, y: 548 }, near: { x: 772, y: 648 } },
}
/** Thigh-light lines on the painted armour: the way back up to the chest. */
const HIP = { left: { x: 580, y: 548 } as Pt, right: { x: 955, y: 548 } as Pt }
const LOWER_CHEST: Pt = { x: 764, y: 372 }

/** Outbound is a stalk: a slow, low creep in bursts with statue freezes between them (owner's stealth pass), not a confident line. */
export const OUT_MS = 3600
export const BACK_MS = 2600
/** A flagged spider comes back fast and erratic (outcome-encoded movement); a clean one calm and direct over BACK_MS. */
export const FLAG_BACK_MS = Math.round(BACK_MS * 0.6)
export const DOCK_MS = 1700
/** An unresolved marker (the mission ended with no end event) fades over this long. */
export const UNRESOLVED_FADE_MS = 20_000

export type AnchorSet = Record<SpiderChannel, Pt>

/** Pick far or near per channel from what is on screen. `visible` takes a point in backdrop pixels. */
export function chooseAnchors(visible: (p: Pt) => boolean): AnchorSet {
  const pick = (c: SpiderChannel) => (visible(NODES[c].far) ? NODES[c].far : NODES[c].near)
  return { browser: pick('browser'), sandbox: pick('sandbox'), network: pick('network') }
}

/** Catmull-Rom through the points, sampled densely, with cumulative length for arc-length lookup. */
export interface Path { pts: Pt[]; cum: number[]; len: number }
export function buildPath(ctrl: Pt[]): Path {
  const P = [ctrl[0], ...ctrl, ctrl[ctrl.length - 1]]
  const pts: Pt[] = []
  for (let i = 1; i < P.length - 2; i++) {
    for (let s = 0; s < 24; s++) {
      const t = s / 24, t2 = t * t, t3 = t2 * t
      const f = (a: number, b: number, c: number, d: number) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
      pts.push({ x: f(P[i - 1].x, P[i].x, P[i + 1].x, P[i + 2].x), y: f(P[i - 1].y, P[i].y, P[i + 1].y, P[i + 2].y) })
    }
  }
  pts.push(ctrl[ctrl.length - 1])
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
  return { pts, cum, len: cum[cum.length - 1] }
}

/** Position and heading (radians) at fraction u (0..1) of the path's length. */
export function pathAt(path: Path, u: number): Pt & { heading: number } {
  const d = Math.min(1, Math.max(0, u)) * path.len
  let lo = 0, hi = path.cum.length - 1
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (path.cum[mid] <= d) lo = mid; else hi = mid }
  const a = path.pts[lo], b = path.pts[hi], span = path.cum[hi] - path.cum[lo] || 1, f = (d - path.cum[lo]) / span
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, heading: Math.atan2(b.y - a.y, b.x - a.x) }
}

/** The part of a path between two fractions, as points (for the thread). */
export function pathSlice(path: Path, u0: number, u1: number, step = 0.02): Pt[] {
  const out: Pt[] = []
  for (let u = u0; u < u1; u += step) out.push(pathAt(path, u))
  out.push(pathAt(path, u1))
  return out
}

export function outPath(channel: SpiderChannel, anchors: AnchorSet): Path {
  const s = SOCKET[channel], n = anchors[channel]
  const mid = { x: (s.x + n.x) / 2, y: (s.y + n.y) / 2 + 34 }
  return buildPath([SEAT, s, mid, n])
}

/** From wherever the spider is, up the nearer thigh-light line to the chest circle. */
export function backPath(from: Pt): Path {
  const hip = from.x < SEAT.x ? HIP.left : HIP.right
  return buildPath([from, { x: (from.x + hip.x) / 2, y: (from.y + hip.y) / 2 + 10 }, hip, LOWER_CHEST, CHEST])
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

export type Surface = 'floor' | 'chair' | 'wall'
/** What a spider is standing on, from where it is on the painting: the throne's front faces, or the floor of the network. */
export function surfaceAt(p: Pt): Surface {
  return p.x > 470 && p.x < 1070 && p.y > 150 && p.y < 640 ? 'chair' : 'floor'
}

/**
 * Saccadic progress: `bursts` segments, each a freeze (it holds still and scans) then a burst (it moves). Pure, monotonic,
 * exact at both ends; `moving` is false while it freezes so the legs stop too. Never constant speed.
 */
export function saccade(x: number, bursts: number, freezeFrac = 0.45): { u: number; moving: boolean } {
  const c = Math.min(1, Math.max(0, x))
  if (c >= 1) return { u: 1, moving: false }
  const k = Math.floor(c * bursts), f = c * bursts - k
  if (f < freezeFrac) return { u: k / bursts, moving: false }
  return { u: (k + ease((f - freezeFrac) / (1 - freezeFrac))) / bursts, moving: true }
}
/** A stable 0..1 number per run id, so each spider has its own rhythm. */
const runHash = (id: string) => { let h = 2166136261; for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296 }

export type PosePhase = 'out' | 'working' | 'back' | 'dock' | 'unknown'
export type PoseTone = 'work' | 'ok' | 'flag' | 'unknown'
export interface Pose extends Pt {
  phase: PosePhase
  tone: PoseTone
  heading: number
  /** 0..1 progress within the current phase. */
  progress: number
  alpha: number
  /** Silk thread behind the spider, oldest first. */
  thread: Pt[]
  /** False while it freezes mid-journey (saccadic stop) or works in place: the legs stop with it. */
  moving: boolean
  /** Body pitch while hauling up (or down) a face of the throne; 0 on the floor. */
  pitch: number
  surface: Surface
}

/** Where a spider is at `now`, or null when it has finished docking (its lines stay in the ledger). */
export function poseOf(run: SpiderRun, now: number, anchors: AnchorSet): Pose | null {
  const out = outPath(run.channel, anchors)
  const node = anchors[run.channel]
  const h = runHash(run.id)
  const bursts = 3 + Math.floor(h * 3)
  const outAt = (at: number) => saccade((at - run.startedAt) / OUT_MS, bursts)
  const terrain = (p: Pt & { heading: number }, moving: boolean) => {
    const surface = surfaceAt(p)
    // climbing a face of the throne: the body pitches as it hauls up (or lets itself down), legs reaching over the edge
    const pitch = surface === 'chair' && Math.abs(Math.sin(p.heading)) > 0.6 ? 0.55 : 0
    return { surface, pitch, moving }
  }

  if (run.endedAt === undefined) {
    if (now - run.startedAt > run.timeoutMs) return { ...node, heading: 0, phase: 'unknown', tone: 'unknown', progress: 0, alpha: 0.9, thread: pathSlice(out, 0, 1, 0.05), ...terrain({ ...node, heading: 0 }, false) }
    const t = now - run.startedAt
    if (t < OUT_MS) {
      const { u, moving } = outAt(now), p = pathAt(out, u)
      return { ...p, phase: 'out', tone: 'work', progress: u, alpha: 1, thread: pathSlice(out, 0, u), ...terrain(p, moving) }
    }
    return { ...node, heading: 0, phase: 'working', tone: 'work', progress: ((t - OUT_MS) % 2400) / 2400, alpha: 1, thread: pathSlice(out, 0, 1, 0.05), ...terrain({ ...node, heading: 0 }, true) }
  }

  const sinceEnd = now - run.endedAt
  const u0 = outAt(run.endedAt).u
  const here = pathAt(out, u0)
  if (run.outcome === 'unresolved') {
    if (sinceEnd > UNRESOLVED_FADE_MS) return null
    return { ...here, phase: 'unknown', tone: 'unknown', progress: 0, alpha: 0.9 * (1 - sinceEnd / UNRESOLVED_FADE_MS), thread: pathSlice(out, 0, u0, 0.05), ...terrain(here, false) }
  }
  const flagged = run.outcome === 'failed'
  const tone: PoseTone = flagged ? 'flag' : 'ok'
  const back = backPath(here)
  const backMs = flagged ? FLAG_BACK_MS : BACK_MS
  if (sinceEnd < backMs) {
    if (!flagged) { // clean: calm and direct
      const u = ease(sinceEnd / BACK_MS), p = pathAt(back, u)
      return { ...p, phase: 'back', tone, progress: u, alpha: 1, thread: pathSlice(back, Math.max(0, u - 0.4), u), ...terrain(p, true) }
    }
    // flagged: fast, short jerky bursts, and an erratic weave across the line
    const { u, moving } = saccade(sinceEnd / FLAG_BACK_MS, 5, 0.18), p = pathAt(back, u)
    const wobble = Math.sin(sinceEnd / 45 + h * 20) * 7 * (1 - u)
    const q = { x: p.x - Math.sin(p.heading) * wobble, y: p.y + Math.cos(p.heading) * wobble, heading: p.heading + Math.sin(sinceEnd / 60 + h * 9) * 0.5 }
    return { ...q, phase: 'back', tone, progress: u, alpha: 1, thread: pathSlice(back, Math.max(0, u - 0.4), u), ...terrain(q, moving) }
  }
  if (sinceEnd < backMs + DOCK_MS) {
    const d = (sinceEnd - backMs) / DOCK_MS
    return { ...CHEST, heading: -Math.PI / 2, phase: 'dock', tone, progress: d, alpha: 1 - Math.max(0, d - 0.55) / 0.45, thread: pathSlice(back, 0.6, 1), surface: 'chair', pitch: 0, moving: false }
  }
  return null
}
