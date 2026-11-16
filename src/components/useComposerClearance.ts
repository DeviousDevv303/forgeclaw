// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

import { useEffect, useState } from 'react'

/** The panel's old fixed clearance, still used when no composer bar is on the page (see SpiderPanel.tsx). */
const FALLBACK_BOTTOM_PX = 92

/** Space kept between the panel's bottom edge and the composer bar's top edge. */
export const SPIDER_PANEL_GAP_PX = 8
/** The composer bar carries this attribute (App.tsx); the panel is placed from its measured position, not a guess. */
export const COMPOSER_BAR_SELECTOR = '[data-composer-bar]'

/**
 * Where the panel sits: its bottom edge is SPIDER_PANEL_GAP_PX above the composer bar's measured top, so it never covers the
 * composer however tall the composer is (a multi-line draft, an attached file, a wrapped control row, a phone). Owner's report
 * 2026-11-13: on mobile the open panel covered the input and he could not type. The fixed 92px above assumed a ~70px bar; the
 * bar is taller than that on a phone and grows with the draft. Re-measured when the bar resizes, the window or the visual
 * viewport resizes, or anything scrolls. With no bar on the page, the old constant applies. `listMaxPx` caps the expanded list
 * so the panel cannot run off the top of a short screen.
 */
export function useComposerClearance(): { bottom: number; listMaxPx: number } {
  const [clearance, setClearance] = useState({ bottom: FALLBACK_BOTTOM_PX, listMaxPx: 0 })
  useEffect(() => {
    let observed: Element | null = null
    let frame = 0
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => schedule())
    const measure = () => {
      frame = 0
      const bar = document.querySelector(COMPOSER_BAR_SELECTOR)
      // The panel mounts with the app, but the composer bar only exists on the chat tab: follow it as it comes and goes.
      if (bar !== observed) {
        if (observed) resizeObserver?.unobserve(observed)
        if (bar) resizeObserver?.observe(bar)
        observed = bar
      }
      if (!bar) { setClearance(prev => (prev.bottom === FALLBACK_BOTTOM_PX && prev.listMaxPx === 0 ? prev : { bottom: FALLBACK_BOTTOM_PX, listMaxPx: 0 })); return }
      const top = bar.getBoundingClientRect().top
      const bottom = Math.max(SPIDER_PANEL_GAP_PX, Math.round(window.innerHeight - top + SPIDER_PANEL_GAP_PX))
      // Room above the panel's header and counters (about 130px with the gap) and the top of the screen, never below 60px.
      const listMaxPx = Math.max(60, Math.min(Math.round(window.innerHeight * 0.38), Math.round(top - SPIDER_PANEL_GAP_PX - 130)))
      setClearance(prev => (prev.bottom === bottom && prev.listMaxPx === listMaxPx ? prev : { bottom, listMaxPx }))
    }
    // Coalesce bursts (typing grows the textarea, scrolling fires many events) into one measurement per frame.
    const schedule = () => {
      if (frame) return
      frame = typeof requestAnimationFrame === 'undefined' ? (measure(), 0) : requestAnimationFrame(measure)
    }
    measure()
    const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(schedule)
    mutations?.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    window.visualViewport?.addEventListener('resize', schedule)
    return () => {
      if (frame && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(frame)
      resizeObserver?.disconnect()
      mutations?.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      window.visualViewport?.removeEventListener('resize', schedule)
    }
  }, [])
  return clearance
}
