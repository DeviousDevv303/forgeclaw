// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
//
// Sign of life for a request that is still running. A DeepSeek answer takes minutes on the CPU
// runner; a bare "Processing…" for that long reads as a hang, and resending it used to discard the
// first answer (run 157, 2026-10-19). This ticks once a second on its own, so the rest of the chat
// does not re-render.
import { useEffect, useState } from 'react'
import { useI18n } from '../lib/i18n'
import { ELAPSED_NOTE_DELAY_MS, formatElapsed } from '../lib/elapsed'

export function ElapsedNote({ since, deepSeek }: { since: number; deepSeek: boolean }) {
  const { t } = useI18n()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const elapsed = now - since
  if (elapsed < ELAPSED_NOTE_DELAY_MS) return null
  return (
    <div role="status" style={{ marginTop: '6px', fontSize: '11px', fontStyle: 'normal', fontFamily: 'monospace', color: '#8a8a8a' }}>
      {t('chat.stillWorking', { time: formatElapsed(elapsed) })}
      {deepSeek ? ` · ${t('chat.deepSeekTypical')}` : ''}
    </div>
  )
}
