// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
import { useState } from 'react'
import { useWhatsApp } from '../hooks/useWhatsApp'
import type { WACredentials } from '../hooks/useWhatsApp'
import { useI18n } from '../lib/i18n'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(ts: number, locale: string): string {
  return new Date(ts).toLocaleTimeString(locale, {
    hour12: false, hour: '2-digit', minute: '2-digit',
  })
}

// ─── Setup screen shown when credentials are missing ─────────────────────────

function SetupScreen({ credentials, onUpdate }: {
  credentials: WACredentials
  onUpdate: (patch: Partial<WACredentials>) => void
}) {
  const [show, setShow] = useState(false)
  const { t } = useI18n()
  const fields: { key: keyof WACredentials; label: string; placeholder: string; secret?: boolean }[] = [
    { key: 'phoneNumberId',    label: t('wa.phoneNumberId'),   placeholder: '123456789012345' },
    { key: 'accessToken',      label: t('wa.accessToken'),      placeholder: 'EAAxx...', secret: true },
    { key: 'recipientNumber',  label: t('wa.recipient'), placeholder: '+13055551234' },
    { key: 'verifyToken',      label: t('wa.verifyToken'),      placeholder: 'any-random-secret', secret: true },
    { key: 'inboxOwner',       label: t('wa.ghOwner'),      placeholder: 'DeviousDevv303' },
    { key: 'inboxRepo',        label: t('wa.ghRepo'),       placeholder: 'forgeclaw' },
    { key: 'ghToken',          label: t('wa.ghToken'),      placeholder: 'ghp_...', secret: true },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '480px', margin: '0 auto', paddingTop: '16px' }}>
      <div style={{ color: '#f97316', fontSize: '11px', letterSpacing: '1px' }}>{t('wa.setupTitle')}</div>
      <div style={{ color: '#555', fontSize: '11px', lineHeight: '1.6' }}>
        {t('wa.introBefore')}<code style={{ color: '#f97316' }}>src/scripts/whatsappWebhookRelay.js</code>{t('wa.introAfter')}
      </div>

      {fields.map(f => (
        <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ color: '#888', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{f.label}</label>
          <input
            type={f.secret && !show ? 'password' : 'text'}
            value={credentials[f.key]}
            onChange={e => onUpdate({ [f.key]: e.target.value })}
            placeholder={f.placeholder}
            style={inputStyle}
          />
        </div>
      ))}

      <button onClick={() => setShow(s => !s)} style={{ ...ghostBtn, fontSize: '10px', alignSelf: 'flex-start' }}>
        {show ? t('wa.hideSecrets') : t('wa.showSecrets')}
      </button>

      <div style={{ background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: '6px', padding: '12px', fontSize: '10px', color: '#555', lineHeight: '1.7' }}>
        <div style={{ color: '#f97316', marginBottom: '6px', letterSpacing: '1px' }}>{t('wa.relayTitle')}</div>
        <div>{t('wa.step1Before')}<code style={{ color: '#ccc' }}>src/scripts/whatsappWebhookRelay.js</code>{t('wa.step1After')}</div>
        <div>{t('wa.step2')}<code style={{ color: '#ccc' }}>VERIFY_TOKEN</code>, <code style={{ color: '#ccc' }}>GH_TOKEN</code>, <code style={{ color: '#ccc' }}>GH_OWNER</code>, <code style={{ color: '#ccc' }}>GH_REPO</code></div>
        <div>{t('wa.step3')}</div>
        <div>{t('wa.step4')}</div>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function WhatsAppConnector() {
  const { t, locale } = useI18n()
  const {
    credentials, updateCredentials,
    messages, sending, sendError,
    sendMessage, isPolling, connected, clearMessages,
  } = useWhatsApp()

  const [input, setInput] = useState('')
  const [showSettings, setShowSettings] = useState(!connected)

  const handleSend = async () => {
    if (!input.trim() || sending) return
    const text = input.trim()
    setInput('')
    await sendMessage(text)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '0' }}>

      {/* Sub-header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingBottom: '10px', borderBottom: '1px solid #1a1a1a' }}>
        <span style={{ color: '#25d366', fontSize: '16px' }}>●</span>
        <span style={{ color: '#f97316', fontSize: '10px', letterSpacing: '1px' }}>WHATSAPP</span>
        <span style={{ color: '#555', fontSize: '10px' }}>
          {connected ? `→ ${credentials.recipientNumber}` : t('wa.notConfigured')}
        </span>
        {isPolling && <span style={{ color: '#555', fontSize: '9px', marginLeft: 'auto' }}>{t('wa.polling')}</span>}
        <div style={{ marginLeft: isPolling ? '0' : 'auto', display: 'flex', gap: '6px' }}>
          <button onClick={() => setShowSettings(s => !s)} style={ghostBtn}>
            {showSettings ? t('wa.chat') : t('wa.setup')}
          </button>
          <button onClick={clearMessages} style={{ ...ghostBtn, opacity: 0.5 }}>{t('wa.clear')}</button>
        </div>
      </div>

      {showSettings ? (
        <div style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain' }}>
          <SetupScreen credentials={credentials} onUpdate={updateCredentials} />
        </div>
      ) : (
        <>
          {/* Message list */}
          <div style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain', display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '12px', paddingBottom: '8px', minHeight: 0 }}>
            {messages.length === 0 ? (
              <div style={{ color: '#333', fontSize: '12px', textAlign: 'center', marginTop: '40px' }}>
                {connected ? t('wa.noMessages') : t('wa.configureFirst')}
              </div>
            ) : (
              messages.map(msg => {
                const isOut = msg.direction === 'outbound'
                const statusColor = msg.status === 'failed' ? '#ef4444' : msg.status === 'sent' ? '#25d366' : '#555'
                return (
                  <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isOut ? 'flex-end' : 'flex-start', gap: '2px' }}>
                    <div style={{
                      maxWidth: '80%',
                      padding: '8px 12px',
                      borderRadius: isOut ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                      background: isOut ? '#25d36620' : '#1a1a1a',
                      border: `1px solid ${isOut ? '#25d36640' : '#222'}`,
                      fontSize: '13px',
                      color: '#e5e5e5',
                      lineHeight: '1.4',
                    }}>
                      {msg.text}
                    </div>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      {!isOut && <span style={{ color: '#555', fontSize: '9px' }}>{msg.from}</span>}
                      <span style={{ color: '#444', fontSize: '9px' }}>{formatTime(msg.timestamp, locale)}</span>
                      {isOut && (
                        <span style={{ color: statusColor, fontSize: '9px' }}>
                          {msg.status === 'sending' ? '○' : msg.status === 'failed' ? '✗' : '✓'}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Error strip */}
          {sendError && (
            <div style={{ color: '#ef4444', fontSize: '10px', padding: '4px 0' }}>{t('wa.error')} {sendError}</div>
          )}

          {/* Input */}
          <div style={{ position: 'sticky', bottom: 0, background: '#0a0a0a', borderTop: '1px solid #1a1a1a', paddingTop: '10px' }}>
            <div style={{ display: 'flex', gap: '8px', background: '#111', border: '1px solid #222', borderRadius: '8px', padding: '8px 12px' }}>
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={connected ? t('wa.messagePlaceholder') : t('wa.configurePlaceholder')}
                disabled={!connected || sending}
                rows={2}
                style={{ flex: 1, background: 'transparent', color: '#e5e5e5', border: 'none', outline: 'none', resize: 'none', fontSize: '13px', fontFamily: 'monospace', minHeight: '40px', WebkitAppearance: 'none' }}
              />
              <button
                onClick={handleSend}
                disabled={!connected || !input.trim() || sending}
                style={{ background: connected ? '#25d366' : '#333', color: '#000', padding: '0 16px', borderRadius: '6px', border: 'none', fontWeight: 'bold', cursor: connected && !sending ? 'pointer' : 'not-allowed', fontSize: '12px', textTransform: 'uppercase', opacity: !connected || sending ? 0.5 : 1 }}
              >
                {sending ? '...' : t('wa.send')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  background: '#111',
  border: '1px solid #222',
  borderRadius: '4px',
  color: '#ccc',
  padding: '6px 10px',
  fontSize: '12px',
  fontFamily: 'monospace',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
}

const ghostBtn: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #333',
  color: '#f97316',
  padding: '3px 10px',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '10px',
  fontWeight: 'bold',
  letterSpacing: '0.5px',
  fontFamily: 'monospace',
}
