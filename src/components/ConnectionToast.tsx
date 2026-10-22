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
        top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        maxWidth: 'min(92vw, 420px)',
        boxSizing: 'border-box',
        padding: '12px 18px',
        borderRadius: '10px',
        fontSize: '15px',
        lineHeight: 1.4,
        textAlign: 'center',
        pointerEvents: 'none', // never blocks a tap underneath
        color: back ? '#bbf7d0' : '#fde68a',
        background: back ? 'rgba(5, 46, 22, 0.96)' : 'rgba(69, 39, 4, 0.96)',
        border: `1px solid ${back ? '#166534' : '#92400e'}`,
        boxShadow: '0 4px 18px rgba(0,0,0,0.5)',
      }}
    >
      {back ? '✓ ' : '↻ '}{back ? backText : reconnectingText}
    </div>
  )
}
