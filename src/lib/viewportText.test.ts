// @vitest-environment jsdom
// The TEXT button copies only what is on screen (owner, 2026-11-14). jsdom has no layout, so these tests place nodes by hand:
// a text node sits at (top, left) and wraps at `perLine` characters; an element has a rect and a computed style.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { describeScreen, viewportText, type ViewBox } from './screenText'

const CHAR_W = 10
const LINE_H = 20
const VIEW: ViewBox = { top: 0, left: 0, bottom: 600, right: 400 }

interface Placement { top: number; left?: number; perLine?: number }
const placements = new WeakMap<Node, Required<Placement>>()
const elementRects = new WeakMap<Element, ViewBox>()
const elementStyles = new WeakMap<Element, Record<string, string>>()

function charRect(node: Node, index: number): ViewBox {
  const p = placements.get(node)!
  const line = Math.floor(index / p.perLine)
  const left = p.left + (index % p.perLine) * CHAR_W
  const top = p.top + line * LINE_H
  return { top, bottom: top + LINE_H, left, right: left + CHAR_W }
}

beforeEach(() => {
  Range.prototype.selectNodeContents = function (this: Range & { _n?: Node; _s?: number; _e?: number }, node: Node) { this._n = node; this._s = 0; this._e = (node as Text).data.length }
  Range.prototype.setStart = function (this: Range & { _s?: number }, _node: Node, offset: number) { this._s = offset }
  Range.prototype.setEnd = function (this: Range & { _e?: number }, _node: Node, offset: number) { this._e = offset }
  Range.prototype.getBoundingClientRect = function (this: Range & { _n?: Node; _s?: number; _e?: number }) {
    const node = this._n!
    const rects = []
    for (let i = this._s!; i < this._e!; i++) rects.push(charRect(node, i))
    const box = { top: Math.min(...rects.map(r => r.top)), bottom: Math.max(...rects.map(r => r.bottom)), left: Math.min(...rects.map(r => r.left)), right: Math.max(...rects.map(r => r.right)) }
    return { ...box, width: box.right - box.left, height: box.bottom - box.top, x: box.left, y: box.top, toJSON: () => ({}) } as DOMRect
  }
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const r = elementRects.get(this) ?? { top: 0, bottom: 0, left: 0, right: 0 }
    return { ...r, width: r.right - r.left, height: r.bottom - r.top, x: r.left, y: r.top, toJSON: () => ({}) } as DOMRect
  }
  vi.spyOn(window, 'getComputedStyle').mockImplementation(el => ({ display: 'block', visibility: 'visible', opacity: '1', position: 'static', overflow: 'visible', overflowX: 'visible', overflowY: 'visible', ...(elementStyles.get(el) ?? {}) }) as unknown as CSSStyleDeclaration)
})
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })

/** Adds <parent><p>text</p></parent> and places the text node; returns the paragraph. */
function addText(parent: HTMLElement, text: string, at: Placement, tag = 'p'): HTMLElement {
  const el = document.createElement(tag)
  el.textContent = text
  parent.appendChild(el)
  placements.set(el.firstChild!, { top: at.top, left: at.left ?? 0, perLine: at.perLine ?? 100 })
  return el
}
const root = () => { const r = document.createElement('div'); document.body.appendChild(r); return r }

describe('viewportText: only what is on screen', () => {
  it('leaves out text scrolled above or below the screen and keeps what is on it', () => {
    const r = root()
    addText(r, 'old message scrolled away above', { top: -400 })
    addText(r, 'first visible message', { top: 100 })
    addText(r, 'second visible message', { top: 300 })
    addText(r, 'message far below the screen', { top: 900 })
    expect(viewportText(r, VIEW)).toBe('first visible message\nsecond visible message')
  })

  it('cuts a long message at the screen edge: only the lines that are on screen come back', () => {
    const r = root()
    // 30 characters, 10 per line, 20px lines: line 0 (-20..0) is above the screen, lines 1 and 2 (0..40) are on it.
    // A line counts when its middle is on screen.
    addText(r, 'AAAAAAAAAA' + 'BBBBBBBBBB' + 'CCCCCCCCCC', { top: -20, perLine: 10 })
    expect(viewportText(r, VIEW)).toBe('BBBBBBBBBBCCCCCCCCCC')
    // Same message running off the bottom edge (600): lines 0 and 1 (560..600) are on screen, line 2 (600..620) is below.
    const r2 = root()
    addText(r2, 'DDDDDDDDDD' + 'EEEEEEEEEE' + 'FFFFFFFFFF', { top: 560, perLine: 10 })
    expect(viewportText(r2, VIEW)).toBe('DDDDDDDDDDEEEEEEEEEE')
  })

  it('leaves out messages that a scrolling container has scrolled out of its own window, even inside the screen', () => {
    const r = root()
    const scroller = document.createElement('div')
    r.appendChild(scroller)
    elementRects.set(scroller, { top: 300, bottom: 500, left: 0, right: 400 })
    elementStyles.set(scroller, { overflowY: 'auto', overflow: 'auto' })
    addText(scroller, 'scrolled out of the list above', { top: 120 })   // inside the screen, outside the scroller's window
    addText(scroller, 'still showing in the list', { top: 340 })
    addText(scroller, 'scrolled out of the list below', { top: 560 })   // on screen too, below the scroller's window
    expect(viewportText(r, VIEW)).toBe('still showing in the list')
  })

  it('overflow set on a display: contents or inline element clips nothing (they have no clipping box)', () => {
    const r = root()
    const contents = document.createElement('div'); r.appendChild(contents)
    elementRects.set(contents, { top: 0, bottom: 0, left: 0, right: 0 })
    elementStyles.set(contents, { display: 'contents', overflow: 'hidden', overflowY: 'hidden' })
    addText(contents, 'inside display contents', { top: 100 })
    const inline = document.createElement('span'); r.appendChild(inline)
    elementRects.set(inline, { top: 0, bottom: 0, left: 0, right: 0 })
    elementStyles.set(inline, { display: 'inline', overflow: 'hidden', overflowY: 'hidden' })
    addText(inline, 'inside an inline box', { top: 140 })
    expect(viewportText(r, VIEW)).toBe('inside display contents\ninside an inline box')
  })

  it('a fixed panel is not clipped by the overflow of the container it sits in', () => {
    const r = root()
    const scroller = document.createElement('div')
    r.appendChild(scroller)
    elementRects.set(scroller, { top: 300, bottom: 400, left: 0, right: 400 })
    elementStyles.set(scroller, { overflowY: 'hidden', overflow: 'hidden' })
    const panel = document.createElement('div')
    scroller.appendChild(panel)
    elementStyles.set(panel, { position: 'fixed' })
    addText(panel, 'swarm panel line', { top: 550 })
    expect(viewportText(r, VIEW)).toBe('swarm panel line')
  })

  it('leaves out hidden, transparent and non-text content', () => {
    const r = root()
    const hidden = document.createElement('div'); r.appendChild(hidden); elementStyles.set(hidden, { display: 'none' })
    addText(hidden, 'display none', { top: 100 })
    const invisible = document.createElement('div'); r.appendChild(invisible); elementStyles.set(invisible, { visibility: 'hidden' })
    addText(invisible, 'visibility hidden', { top: 120 })
    const faded = document.createElement('div'); r.appendChild(faded); elementStyles.set(faded, { opacity: '0' })
    addText(faded, 'fully transparent', { top: 140 })
    addText(r, 'a draft the owner typed', { top: 160 }, 'textarea')
    addText(r, 'console.log("script body")', { top: 180 }, 'script')
    addText(r, 'what the owner can read', { top: 200 })
    expect(viewportText(r, VIEW)).toBe('what the owner can read')
  })

  it('applies CSS text-transform, so the capture reads as the screen does', () => {
    const r = root()
    const upper = addText(r, 'made in colorado', { top: 100 }); elementStyles.set(upper, { textTransform: 'uppercase' })
    const lower = addText(r, 'SHOUTING LABEL', { top: 140 }); elementStyles.set(lower, { textTransform: 'lowercase' })
    const cap = addText(r, 'the quick-brown fox', { top: 180 }); elementStyles.set(cap, { textTransform: 'capitalize' })
    expect(viewportText(r, VIEW)).toBe('MADE IN COLORADO\nshouting label\nThe Quick-Brown Fox')
  })

  it('keeps fragments on the same line together and starts a new line below', () => {
    const r = root()
    addText(r, 'LIVE', { top: 100, left: 0 }, 'span')
    addText(r, 'EXECUTION', { top: 100, left: 60 }, 'span')
    addText(r, 'next row', { top: 130, left: 0 }, 'span')
    expect(viewportText(r, VIEW)).toBe('LIVE EXECUTION\nnext row')
  })

  it('says nothing for a page with no laid-out text (jsdom default), never throws', () => {
    const r = root()
    const el = document.createElement('p'); el.textContent = 'not laid out'; r.appendChild(el)
    placements.set(el.firstChild!, { top: 5000, left: 0, perLine: 100 })
    expect(viewportText(r, VIEW)).toBe('')
  })
})

describe('describeScreen with a view', () => {
  it('names its scope, captures only the visible text and still redacts credentials', () => {
    const r = root()
    addText(r, 'earlier chat line', { top: -300 })
    addText(r, 'key ghp_abcdefghijklmnopqrstuvwxyz1234', { top: 200 })
    const text = describeScreen(r as unknown as { textContent: string | null }, { view: VIEW, viewport: '400×600', now: new Date('2026-11-14T12:00:00Z') })
    expect(text).toContain('Scope: only what is visible on screen')
    expect(text).toContain('key [redacted]')
    expect(text).not.toContain('earlier chat line')
    expect(text).not.toContain('ghp_')
  })

  it('without a view it behaves as before: the whole page text, no scope line', () => {
    const r = root()
    r.textContent = 'whole page text'
    const text = describeScreen(r, { now: new Date('2026-11-14T12:00:00Z') })
    expect(text).toContain('whole page text')
    expect(text).not.toContain('Scope:')
  })
})

describe('wiring in App.tsx (pinned: a source check; the behaviour was driven in a real browser)', () => {
  const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
  it('the TEXT button passes the visual viewport as the view, not the whole page', () => {
    const start = app.indexOf('const copyScreenText = async () => {')
    const block = app.slice(start, app.indexOf('const handleTabClick', start))
    expect(block).toContain('window.visualViewport')
    expect(block).toContain('view,')
  })
})
