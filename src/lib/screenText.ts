// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Screen as text: what is on the screen right now, for troubleshooting ─────────────
// A screenshot cannot be pasted into a chat as words. This reads the visible text of the page (not an image),
// adds the facts a bug report needs (time, address, screen size, model, request status, last error) and
// removes anything shaped like a credential before it can be copied anywhere.

/** A rectangle in the browser's client coordinates (what getBoundingClientRect reports). */
export interface ViewBox { top: number; bottom: number; left: number; right: number }

export interface ScreenTextMeta {
  /** When given, only the text inside this box is captured, like a phone screenshot (see viewportText). */
  view?: ViewBox
  now?: Date
  url?: string
  viewport?: string
  provider?: string
  model?: string
  requestStatus?: string
  lastError?: string
}

const MAX_CHARS = 60_000
// Also Google OAuth (ya29.), Meta/WhatsApp (EAA) and Brave (BSA) tokens: long enough to be real, so the placeholder hints in
// empty Settings fields ("ya29....", "EAAxx...", "BSA...") are left alone.
const SECRET_SHAPES = /\b(?:sk-[\w-]{8,}|gh[pousr]_\w{8,}|github_pat_\w{8,}|AIza[\w-]{20,}|eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{5,}|AKIA[0-9A-Z]{12,}|ya29\.[\w-]{20,}|EAA[A-Za-z0-9]{20,}|BSA[\w-]{20,})|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g

export function redactSecrets(text: string): string {
  return text.replace(SECRET_SHAPES, '[redacted]')
}

/** Visible text of an element: lines trimmed, blank runs collapsed (jsdom has no innerText, so it falls back to textContent). */
export function visibleText(root: { innerText?: string; textContent: string | null }): string {
  const raw = typeof root.innerText === 'string' ? root.innerText : (root.textContent ?? '')
  return raw.split('\n').map(line => line.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'OPTION'])
/** A text node longer than this that straddles the screen edge is kept or dropped by its middle, not cut by character. */
const MAX_CUT_CHARS = 30_000

function intersect(a: ViewBox, b: ViewBox): ViewBox | null {
  const top = Math.max(a.top, b.top), bottom = Math.min(a.bottom, b.bottom), left = Math.max(a.left, b.left), right = Math.min(a.right, b.right)
  return bottom > top && right > left ? { top, bottom, left, right } : null
}

/**
 * The part of the screen an element's content can really show: the view, cut by every ancestor that hides overflow (a chat
 * list that scrolls inside the page keeps scrolled-off messages inside the window's bounds, but not on screen). Null when
 * the element or an ancestor is not displayed, hidden or fully transparent. A fixed element escapes the overflow of its
 * ancestors, so clipping stops there. Known limit: an absolutely positioned element inside a non-positioned clipping
 * ancestor is still cut by it.
 */
function clipFor(element: Element, view: ViewBox): ViewBox | null {
  let clip: ViewBox | null = view
  let escaped = false
  for (let e: Element | null = element; e && clip; e = e.parentElement) {
    const style = e.ownerDocument.defaultView?.getComputedStyle(e)
    if (!style) continue
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || (style.opacity !== '' && Number(style.opacity) === 0)) return null
    if (style.position === 'fixed') escaped = true
    // Overflow clips only an element that has a block-level box: `display: contents` has no box at all and an inline box does not clip.
    const hidesOverflow = style.display !== 'contents' && style.display !== 'inline' && [style.overflow, style.overflowX, style.overflowY].some(v => !!v && v !== 'visible')
    if (hidesOverflow && !escaped && e !== e.ownerDocument.documentElement && e !== e.ownerDocument.body) {
      const r = e.getBoundingClientRect()
      clip = intersect(clip, { top: r.top, bottom: r.bottom, left: r.left, right: r.right })
    }
  }
  return clip
}

interface Fragment { text: string; top: number; bottom: number }

/** What the eye reads: CSS text-transform changes the letters on screen (the old innerText capture applied it too). */
function transformed(text: string, element: Element): string {
  const mode = element.ownerDocument.defaultView?.getComputedStyle(element).textTransform
  if (mode === 'uppercase') return text.toUpperCase()
  if (mode === 'lowercase') return text.toLowerCase()
  if (mode === 'capitalize') return text.replace(/(^|[\s\-(["'])(\p{L})/gu, (_m, lead: string, letter: string) => lead + letter.toUpperCase())
  return text
}

function visibleFragments(root: Node, view: ViewBox): Fragment[] {
  const doc = root.ownerDocument ?? (root as Document)
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */)
  const out: Fragment[] = []
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const data = node.data
    const parent = node.parentElement
    if (!data.trim() || !parent || SKIP_TAGS.has(parent.tagName)) continue
    const clip = clipFor(parent, view)
    if (!clip) continue
    const range = doc.createRange()
    range.selectNodeContents(node)
    const box = range.getBoundingClientRect()
    if (!intersect(clip, box)) continue   // off screen, clipped away, or has no box at all (not laid out)
    const inside = box.top >= clip.top && box.bottom <= clip.bottom && box.left >= clip.left && box.right <= clip.right
    if (inside) { out.push({ text: transformed(data, parent), top: box.top, bottom: box.bottom }); continue }
    // The node straddles an edge: keep the characters whose own box centre is on screen.
    if (data.length > MAX_CUT_CHARS) {
      const cy = (box.top + box.bottom) / 2
      if (cy >= clip.top && cy <= clip.bottom) out.push({ text: transformed(data, parent), top: box.top, bottom: box.bottom })
      continue
    }
    let first = -1, last = -1, top = 0, bottom = 0
    for (let i = 0; i < data.length; i++) {
      range.setStart(node, i)
      range.setEnd(node, i + 1)
      const r = range.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) continue   // collapsed whitespace has no box of its own
      const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2
      if (cx < clip.left || cx > clip.right || cy < clip.top || cy > clip.bottom) continue
      if (first < 0) { first = i; top = r.top; bottom = r.bottom }
      last = i
      bottom = Math.max(bottom, r.bottom)
    }
    if (first >= 0) out.push({ text: transformed(data.slice(first, last + 1), parent), top, bottom })
  }
  return out
}

/**
 * The text that is on screen inside `view`, as a screenshot would show it: nothing scrolled above or below, nothing clipped by a
 * scrolling container, nothing hidden. Text is taken in document order; a fragment that starts below the previous one's bottom edge
 * begins a new line, otherwise it continues the line. Owner's requirement (2026-11-14): "only what is visible on my screen".
 */
export function viewportText(root: Node, view: ViewBox): string {
  let text = ''
  let previous: Fragment | null = null
  for (const fragment of visibleFragments(root, view)) {
    if (previous) text += fragment.top >= previous.bottom - 2 ? '\n' : ' '
    text += fragment.text
    previous = fragment
  }
  return visibleText({ textContent: text })
}

export function describeScreen(root: { innerText?: string; textContent: string | null }, meta: ScreenTextMeta = {}): string {
  const header = [
    `ForgeClaw screen text · ${(meta.now ?? new Date()).toISOString()}`,
    meta.url && `Address: ${meta.url}`,
    meta.viewport && `Screen: ${meta.viewport}`,
    meta.view && 'Scope: only what is visible on screen',
    meta.provider && `Model: ${meta.provider}${meta.model ? ` · ${meta.model}` : ''}`,
    meta.requestStatus && `Request status: ${meta.requestStatus}`,
    meta.lastError && `Last error: ${meta.lastError}`,
  ].filter(Boolean).join('\n')
  // With a view, root must be a DOM node (viewportText reads layout from it).
  let body = redactSecrets(meta.view ? viewportText(root as unknown as Node, meta.view) : visibleText(root))
  // Keep the end: the newest messages are at the bottom and are what a bug report is about.
  if (body.length > MAX_CHARS) body = `[…earlier text cut…]\n${body.slice(body.length - MAX_CHARS)}`
  return `${header}\n${'─'.repeat(24)}\n${body}\n`
}
