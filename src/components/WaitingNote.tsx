// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

import { useEffect, useState } from 'react'
import { useI18n } from '../lib/i18n'
import { formatElapsed, WAITING_NOTE_DELAY_S } from '../lib/waitingNote'

/**
 * Shown under a still-streaming assistant bubble. A DeepSeek answer runs on a GitHub CPU runner and
 * takes minutes, and a bare "Processing…" looks like a hang. This shows real elapsed time and, for
 * DeepSeek only, what to expect and that STOP cancels the run.
 */
export function WaitingNote({ startedAt, deepseek }: { startedAt: number; deepseek: boolean }) {
  const { t } = useI18n()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const elapsed = (now - startedAt) / 1000
  if (elapsed < WAITING_NOTE_DELAY_S) return null
  return (
    <div data-testid="waiting-note" style={{ marginTop: '8px', fontSize: '11px', fontStyle: 'normal', fontFamily: 'monospace', color: '#8a8a8a', lineHeight: 1.5 }}>
      <div aria-live="off">{t('wait.elapsed', { time: formatElapsed(elapsed) })}</div>
      {deepseek && <div role="status">{t('wait.deepseekHint')}</div>}
    </div>
  )
}
