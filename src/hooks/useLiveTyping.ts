import { useEffect, useRef, useState } from 'react'

interface Options {
  text: string
  speed?: number
  instant?: boolean
}

function charDelay(ch: string | undefined, base: number): number {
  const jitter = Math.random() * 20  // 0–20ms organic variation
  if (ch == null) return base + jitter
  if ('.!?'.includes(ch)) return 320
  if (',;:–—'.includes(ch)) return 70
  if (/[\d[\]{}()]/.test(ch)) return 14
  return base + jitter
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' &&
    (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
}

export function useLiveTyping({ text, speed = 35, instant = false }: Options) {
  const spanRef = useRef<HTMLSpanElement>(null)
  const rafRef = useRef(0)
  const indexRef = useRef(0)
  const lastTimeRef = useRef(0)
  const [done, setDone] = useState(instant || prefersReducedMotion())

  useEffect(() => {
    let doneTimer = 0

    if (instant || prefersReducedMotion()) {
      if (spanRef.current) spanRef.current.textContent = text
      doneTimer = window.setTimeout(() => setDone(true), 0)
      return () => window.clearTimeout(doneTimer)
    }

    indexRef.current = 0
    lastTimeRef.current = 0
    if (spanRef.current) spanRef.current.textContent = ''
    doneTimer = window.setTimeout(() => setDone(false), 0)

    function tick(ts: number) {
      if (!spanRef.current) return
      if (ts - lastTimeRef.current >= charDelay(text[indexRef.current], speed)) {
        spanRef.current.textContent = text.slice(0, indexRef.current + 1)
        lastTimeRef.current = ts
        indexRef.current++
      }
      if (indexRef.current < text.length) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        doneTimer = window.setTimeout(() => setDone(true), 0)
      }
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      window.clearTimeout(doneTimer)
      cancelAnimationFrame(rafRef.current)
    }
  }, [text, speed, instant])

  return { spanRef, done }
}
