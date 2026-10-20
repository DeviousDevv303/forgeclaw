// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── NEXUS taste: what the owner likes to look at, learned from his own 🔥 👍 👎 ─────────
// This used to be a separate service on a computer (127.0.0.1:8377) that the owner had to point the app at.
// It is part of NEXUS now: no port, no key, nothing to run. A picture's look is measured in the browser
// (brightness, contrast, saturation, warmth, dominant colors); each reaction moves the owner's taste profile;
// the profile is turned into words that steer image generation. Everything stays in this browser, and only the
// owner's own reactions teach it (the NEXUS tab is owner-only).
//
// Honest scope: these are measurable visual qualities, not a model's judgement of "style" or subject.

export type TasteSignal = 'fire' | 'up' | 'down'
export const TASTE_FEATURES = ['brightness', 'contrast', 'saturation', 'warmth'] as const
export type TasteFeature = typeof TASTE_FEATURES[number]
export type TasteFeatures = Record<TasteFeature, number>

export interface TasteSample { features: TasteFeatures; palette: string[] }

interface Centroid { n: number; mean: TasteFeatures }
export interface TasteProfile {
  liked: Centroid
  disliked: Centroid
  /** Dominant colors of liked pictures, with how often each showed up. */
  palette: Record<string, number>
  updatedAt: string
}

const STORAGE_KEY = 'nexus_taste_v1'
/** Reactions needed before taste starts steering image prompts. */
export const MIN_TASTE_EVENTS = 3
const SIGNAL_WEIGHT: Record<TasteSignal, number> = { fire: 2, up: 1, down: 1 }
const HIGH = 0.62
const LOW = 0.38
/** A disliked trait is only worth avoiding when it differs this much from what is liked. */
const AVOID_GAP = 0.2

const emptyCentroid = (): Centroid => ({ n: 0, mean: { brightness: 0.5, contrast: 0.5, saturation: 0.5, warmth: 0.5 } })
export const emptyTaste = (): TasteProfile => ({ liked: emptyCentroid(), disliked: emptyCentroid(), palette: {}, updatedAt: '' })

/** Measured qualities of an RGBA pixel buffer, each 0..1. */
export function featuresFromPixels(data: ArrayLike<number>): TasteFeatures {
  const pixels = Math.floor(data.length / 4)
  if (!pixels) return { brightness: 0.5, contrast: 0.5, saturation: 0.5, warmth: 0.5 }
  let sumL = 0, sumL2 = 0, sumS = 0, sumW = 0, counted = 0
  for (let i = 0; i < pixels; i++) {
    const a = data[i * 4 + 3]
    if (a < 16) continue // transparent
    const r = data[i * 4] / 255, g = data[i * 4 + 1] / 255, b = data[i * 4 + 2] / 255
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    sumL += l; sumL2 += l * l
    sumS += max === 0 ? 0 : (max - min) / max
    sumW += (r - b + 1) / 2
    counted += 1
  }
  if (!counted) return { brightness: 0.5, contrast: 0.5, saturation: 0.5, warmth: 0.5 }
  const meanL = sumL / counted
  const std = Math.sqrt(Math.max(0, sumL2 / counted - meanL * meanL))
  return { brightness: meanL, contrast: Math.min(1, std * 2.5), saturation: sumS / counted, warmth: sumW / counted }
}

/** The most common colors (4 bits per channel), as #rrggbb, most common first. */
export function paletteFromPixels(data: ArrayLike<number>, count = 4): string[] {
  const bins = new Map<number, number>()
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 16) continue
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4)
    bins.set(key, (bins.get(key) ?? 0) + 1)
  }
  return [...bins.entries()].sort((a, b) => b[1] - a[1]).slice(0, count)
    .map(([key]) => '#' + [(key >> 8) & 15, (key >> 4) & 15, key & 15].map(v => ((v << 4) | 8).toString(16).padStart(2, '0')).join(''))
}

/** Measure a picture (data URL or https URL) in the browser: downscaled to 48 px, so it is cheap. */
export async function imageTasteSample(image: string, size = 48): Promise<TasteSample> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') throw new Error('this browser cannot read pictures')
  const blob = await (await fetch(image)).blob()
  const bitmap = await createImageBitmap(blob)
  const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) { bitmap.close(); throw new Error('this browser cannot read pictures') }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
  return { features: featuresFromPixels(data), palette: paletteFromPixels(data) }
}

type Store = Pick<Storage, 'getItem' | 'setItem'> | undefined

export function loadTaste(storage: Store = globalThis.localStorage): TasteProfile {
  try {
    const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null') as Partial<TasteProfile> | null
    const ok = (c: unknown): c is Centroid => !!c && typeof (c as Centroid).n === 'number' && TASTE_FEATURES.every(f => typeof (c as Centroid).mean?.[f] === 'number')
    if (parsed && ok(parsed.liked) && ok(parsed.disliked)) return { liked: parsed.liked, disliked: parsed.disliked, palette: parsed.palette ?? {}, updatedAt: parsed.updatedAt ?? '' }
  } catch { /* unreadable: start fresh */ }
  return emptyTaste()
}

function save(profile: TasteProfile, storage: Store): void {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(profile)) } catch { /* not persisted */ }
}

/** One reaction to one picture. 🔥 counts double; 👎 teaches what to avoid. Returns the new profile. */
export function recordTaste(signal: TasteSignal, sample: TasteSample, storage: Store = globalThis.localStorage, now: Date = new Date()): TasteProfile {
  const profile = loadTaste(storage)
  const weight = SIGNAL_WEIGHT[signal]
  const target = signal === 'down' ? profile.disliked : profile.liked
  const total = target.n + weight
  for (const f of TASTE_FEATURES) target.mean[f] += (sample.features[f] - target.mean[f]) * (weight / total)
  target.n = total
  if (signal !== 'down') for (const hex of sample.palette) profile.palette[hex] = (profile.palette[hex] ?? 0) + weight
  // Keep the palette small: the 12 most-reinforced colors.
  profile.palette = Object.fromEntries(Object.entries(profile.palette).sort((a, b) => b[1] - a[1]).slice(0, 12))
  profile.updatedAt = now.toISOString()
  save(profile, storage)
  return profile
}

export function resetTaste(storage: Store = globalThis.localStorage): TasteProfile {
  const fresh = emptyTaste()
  save(fresh, storage)
  return fresh
}

const WORDS: Record<TasteFeature, { high: string; low: string }> = {
  brightness: { high: 'bright, airy lighting', low: 'dark, moody lighting' },
  contrast: { high: 'high contrast', low: 'soft, low contrast' },
  saturation: { high: 'vivid, saturated colors', low: 'muted, desaturated colors' },
  warmth: { high: 'warm tones', low: 'cool tones' },
}

export interface TasteDescription { traits: string[]; avoid: string[]; confidence: number; reactions: number }

/** The profile in words. Empty until there are enough reactions to mean anything. */
export function describeTaste(profile: TasteProfile): TasteDescription {
  const reactions = profile.liked.n + profile.disliked.n
  const confidence = Math.min(1, profile.liked.n / 20)
  if (profile.liked.n < MIN_TASTE_EVENTS) return { traits: [], avoid: [], confidence, reactions }
  const traits: string[] = []
  const avoid: string[] = []
  for (const f of TASTE_FEATURES) {
    const v = profile.liked.mean[f]
    if (v >= HIGH) traits.push(WORDS[f].high)
    else if (v <= LOW) traits.push(WORDS[f].low)
    if (profile.disliked.n >= MIN_TASTE_EVENTS) {
      const d = profile.disliked.mean[f]
      if (d - v >= AVOID_GAP && d >= HIGH) avoid.push(WORDS[f].high)
      else if (v - d >= AVOID_GAP && d <= LOW) avoid.push(WORDS[f].low)
    }
  }
  return { traits, avoid, confidence, reactions }
}

/** Words that steer an image prompt toward the owner's taste, or '' when there is nothing to say yet. */
export function tasteForImagePrompt(profile: TasteProfile = loadTaste()): string {
  const { traits } = describeTaste(profile)
  return traits.join(', ')
}
