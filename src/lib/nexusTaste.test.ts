import { describe, expect, it } from 'vitest'
import { describeTaste, emptyTaste, featuresFromPixels, loadTaste, MIN_TASTE_EVENTS, paletteFromPixels, recordTaste, resetTaste, tasteForImagePrompt, type TasteSample } from './nexusTaste'

const solid = (r: number, g: number, b: number, n = 16) => Uint8ClampedArray.from(Array.from({ length: n }, () => [r, g, b, 255]).flat())
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } } }
const sample = (data: Uint8ClampedArray): TasteSample => ({ features: featuresFromPixels(data), palette: paletteFromPixels(data) })

describe('NEXUS taste: measuring a picture', () => {
  it('reads brightness, saturation and warmth from pixels', () => {
    const white = featuresFromPixels(solid(255, 255, 255))
    expect(white.brightness).toBeGreaterThan(0.99)
    expect(white.saturation).toBe(0)
    expect(white.warmth).toBeCloseTo(0.5)
    const black = featuresFromPixels(solid(0, 0, 0))
    expect(black.brightness).toBe(0)
    const orange = featuresFromPixels(solid(255, 120, 20))
    expect(orange.warmth).toBeGreaterThan(0.8)
    expect(orange.saturation).toBeGreaterThan(0.9)
    expect(featuresFromPixels(solid(20, 80, 255)).warmth).toBeLessThan(0.2)
    // Contrast: half black, half white is far more contrasty than flat grey.
    const split = Uint8ClampedArray.from([...solid(0, 0, 0, 8), ...solid(255, 255, 255, 8)])
    expect(featuresFromPixels(split).contrast).toBeGreaterThan(0.9)
    expect(featuresFromPixels(solid(128, 128, 128)).contrast).toBe(0)
  })

  it('finds the dominant colors, ignores transparent pixels', () => {
    const data = Uint8ClampedArray.from([...solid(255, 0, 0, 10), ...solid(0, 0, 255, 4), 0, 255, 0, 0])
    expect(paletteFromPixels(data, 2)).toEqual(['#f80808', '#0808f8'])
  })
})

describe('NEXUS taste: learning from the owner’s reactions', () => {
  it('says nothing until there are enough reactions, then describes what is liked', () => {
    const store = mem()
    const warmDark = sample(solid(200, 90, 30))
    for (let i = 0; i < MIN_TASTE_EVENTS - 1; i++) recordTaste('up', warmDark, store)
    expect(tasteForImagePrompt(loadTaste(store))).toBe('')
    recordTaste('up', warmDark, store)
    const words = tasteForImagePrompt(loadTaste(store))
    expect(words).toContain('warm tones')
    expect(words).toContain('vivid, saturated colors')
  })

  it('counts a fire double, learns what to avoid from dislikes, keeps likes and dislikes apart', () => {
    const store = mem()
    for (let i = 0; i < 2; i++) recordTaste('fire', sample(solid(20, 80, 200)), store)
    expect(loadTaste(store).liked.n).toBe(4)
    for (let i = 0; i < 3; i++) recordTaste('down', sample(solid(250, 250, 240)), store)
    const d = describeTaste(loadTaste(store))
    expect(d.traits).toContain('cool tones')
    expect(d.avoid).toContain('bright, airy lighting')
    expect(loadTaste(store).disliked.n).toBe(3)
  })

  it('survives a reload and can be reset', () => {
    const store = mem()
    recordTaste('up', sample(solid(10, 10, 10)), store)
    expect(loadTaste(store).liked.n).toBe(1)
    expect(Object.keys(loadTaste(store).palette)).toHaveLength(1)
    resetTaste(store)
    expect(loadTaste(store)).toEqual(expect.objectContaining({ liked: emptyTaste().liked }))
    expect(loadTaste({ getItem: () => 'not json', setItem: () => {} }).liked.n).toBe(0)
  })
})
