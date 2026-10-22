// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.
//
// Hold-to-confirm for destructive actions (owner directive, 2026-10-21): a plain click is too
// easy to land by accident on REMOVE / REJECT / RESET TASTE / CLEAR / WIPE, and window.confirm
// cannot be trusted — in-app browsers silently return false from it (the #221 lesson). Holding
// the button for the full duration is the guard; releasing early cancels, and the fill shows
// how much longer to hold, so the control never leaves the user guessing.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

// 600ms because: shorter and a stray tap or double-click can still complete it; longer and a
// deliberate action starts to feel broken. Long enough to prove intent, short enough to use.
export const HOLD_CONFIRM_MS = 600
// 20ms steps: ~30 frames over the hold — smooth enough for a fill bar, cheap enough to ignore.
const TICK_MS = 20

interface HoldToConfirmButtonProps {
  onConfirm: () => void
  children: ReactNode
  style?: CSSProperties
  title?: string
  disabled?: boolean
  holdMs?: number
}

export function HoldToConfirmButton({ onConfirm, children, style, title, disabled, holdMs = HOLD_CONFIRM_MS }: HoldToConfirmButtonProps) {
  const [progress, setProgress] = useState(0)
  const startedAt = useRef<number | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const fired = useRef(false)

  const cancel = () => {
    if (timer.current) { clearInterval(timer.current); timer.current = null }
    startedAt.current = null
    setProgress(0)
  }

  // A control that unmounts mid-hold must not leave its timer running behind it.
  useEffect(() => cancel, [])

  const begin = () => {
    if (disabled || timer.current) return
    fired.current = false
    startedAt.current = Date.now()
    timer.current = setInterval(() => {
      if (startedAt.current === null) return
      const elapsed = Date.now() - startedAt.current
      setProgress(Math.min(1, elapsed / holdMs))
      if (elapsed >= holdMs && !fired.current) {
        fired.current = true
        cancel()
        onConfirm()
      }
    }, TICK_MS)
  }

  const isKeyHold = (key: string) => key === ' ' || key === 'Enter'

  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      style={{ ...style, position: 'relative', overflow: 'hidden', touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' }}
      onPointerDown={e => { e.preventDefault(); begin() }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={e => e.preventDefault()}
      onKeyDown={e => { if (isKeyHold(e.key)) { e.preventDefault(); if (!e.repeat) begin() } }}
      onKeyUp={e => { if (isKeyHold(e.key)) { e.preventDefault(); cancel() } }}
      onClick={e => e.preventDefault()}
    >
      <span aria-hidden="true" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${progress * 100}%`, background: 'rgba(239, 68, 68, 0.28)', pointerEvents: 'none' }} />
      <span style={{ position: 'relative' }}>{children}</span>
    </button>
  )
}
