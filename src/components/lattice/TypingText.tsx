import type { CSSProperties } from 'react'
import { useRef, useEffect } from 'react'
import { useLiveTyping } from '../../hooks/useLiveTyping'

interface Props {
  text: string
  color: string
  speed?: number
  instant?: boolean
  /** 'typing-only' (default): cursor disappears on completion | 'always': cursor blinks when idle */
  cursorMode?: 'typing-only' | 'always'
  style?: CSSProperties
}

export function TypingText({ text, color, speed, instant, cursorMode = 'typing-only', style }: Props) {
  const { spanRef, done } = useLiveTyping({ text, speed, instant })
  const cursorRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!done || cursorMode !== 'always' || !cursorRef.current) return
    const el = cursorRef.current
    let visible = true
    const id = setInterval(() => {
      el.style.opacity = (visible = !visible) ? '1' : '0'
    }, 530)
    return () => { clearInterval(id) }
  }, [done, cursorMode])

  return (
    <span style={{ color, ...style }}>
      <span ref={spanRef} />
      {!done && (
        <span style={{ color, textShadow: `0 0 8px ${color}` }}>▌</span>
      )}
      {done && cursorMode === 'always' && (
        <span ref={cursorRef} style={{ color, textShadow: `0 0 6px ${color}`, opacity: 1 }}>▌</span>
      )}
    </span>
  )
}
