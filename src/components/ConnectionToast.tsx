// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// A short pop-up for the connection to the model: shown while a step is being re-asked after the owner left the app,
// and briefly once it is back. It is not chat text: nothing here is saved to the conversation.

export type ConnectionNotice = 'reconnecting' | 'back'

export function ConnectionToast({ notice, reconnectingText, backText }: { notice: ConnectionNotice | null; reconnectingText: string; backText: string }) {
  if (!notice) return null
  const back = notice === 'back'
  return (
    <div
      role="status"
      aria-live="polite"
      data-connection-notice={notice}
      style={{
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top, 0px) + 8px)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        maxWidth: 'min(92vw, 340px)',
        boxSizing: 'border-box',
        padding: '6px 12px',
        borderRadius: '999px',
        fontSize: '11px',
        lineHeight: 1.3,
        textAlign: 'center',
        pointerEvents: 'none', // never blocks a tap underneath
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
        color: back ? '#bbf7d0' : '#fde68a',
        background: back ? 'rgba(5, 46, 22, 0.92)' : 'rgba(69, 39, 4, 0.92)',
        border: `1px solid ${back ? '#166534' : '#92400e'}`,
        boxShadow: '0 2px 10px rgba(0,0,0,0.4)',
      }}
    >
      {back ? '✓ ' : '↻ '}{back ? backText : reconnectingText}
    </div>
  )
}
