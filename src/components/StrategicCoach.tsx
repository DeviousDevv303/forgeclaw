// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
import { useState, useRef, useEffect, useCallback } from 'react'
import { callProvider } from '../lib/modelProviders'
import type { ProviderId } from '../lib/modelProviders'
import { useErrorBus } from '../hooks/useErrorBus'

const COACH_SYSTEM = `You are the Strategic Mind Coach — a sharp, direct advisor embedded in ForgeClaw. Your role is to help the user think clearly, make better decisions, set goals, and execute. You ask powerful questions when the user is stuck, offer concrete frameworks when useful, and push back respectfully on weak reasoning. Keep responses tight and actionable. No corporate speak. No filler.`

interface CoachMessage {
  role: 'user' | 'assistant'
  content: string
}

interface Props {
  provider: ProviderId
  model: string
  apiKey: string
}

export function StrategicCoach({ provider, model, apiKey }: Props) {
  const [messages, setMessages] = useState<CoachMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const { emitFailure } = useErrorBus()

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || loading) return
    if (!apiKey) {
      setMessages(prev => [...prev, { role: 'user', content: text }, { role: 'assistant', content: '[Error] No API key configured. Open Settings and add a key.' }])
      setInput('')
      return
    }
    setInput('')
    const next: CoachMessage[] = [...messages, { role: 'user', content: text }]
    setMessages(next)
    setLoading(true)
    try {
      const result = await callProvider(
        provider, model, COACH_SYSTEM,
        next.map(m => ({ role: m.role, content: m.content })),
        apiKey,
      )
      setMessages(prev => [...prev, { role: 'assistant', content: result.text || '(no response)' }])
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      emitFailure({ source: 'coach', severity: 'error', message: msg })
      setMessages(prev => [...prev, { role: 'assistant', content: `[Error] ${msg}` }])
    } finally {
      setLoading(false)
    }
  }, [input, loading, messages, provider, model, apiKey, emitFailure])

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>

      {/* Header */}
      <div style={{ padding: '10px 20px', borderBottom: '1px solid #111', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <span style={{ color: '#f97316', fontSize: '10px', letterSpacing: '3px', fontFamily: 'monospace' }}>STRATEGIC MIND COACH</span>
        <span style={{ color: '#333', fontSize: '9px', fontFamily: 'monospace', letterSpacing: '1px' }}>
          {provider.toUpperCase()} · {model.split('-').slice(-1)[0].toUpperCase()}
        </span>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {messages.length === 0 && !loading && (
          <div style={{ color: '#333', fontSize: '11px', textAlign: 'center', marginTop: '60px', fontFamily: 'monospace', letterSpacing: '2px' }}>
            ASK THE COACH
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '82%',
              background: msg.role === 'user' ? '#1a1200' : '#0a0a0a',
              border: `1px solid ${msg.role === 'user' ? '#f9731622' : '#1e1e1e'}`,
              borderRadius: '8px',
              padding: '12px 16px',
              fontFamily: msg.role === 'assistant' ? "'Georgia', 'Times New Roman', serif" : 'monospace',
              fontSize: msg.role === 'assistant' ? '14px' : '13px',
              color: msg.role === 'user' ? '#f97316' : '#c8c8c8',
              lineHeight: '1.7',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{ background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '12px 16px' }}>
              <span style={{ color: '#444', animation: 'pulse 1.5s infinite', fontFamily: 'monospace', fontSize: '12px' }}>● thinking…</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid #111', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: '10px', background: '#111', border: '1px solid #222', borderRadius: '8px', padding: '8px 12px' }}>
          <textarea
            rows={2}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            disabled={loading}
            placeholder="Ask the Coach…"
            style={{ flex: 1, background: 'transparent', color: '#e5e5e5', border: 'none', outline: 'none', resize: 'none', fontSize: '13px', fontFamily: 'monospace', minHeight: '40px', WebkitAppearance: 'none' }}
          />
          <button
            onClick={() => void send()}
            disabled={loading || !input.trim()}
            style={{ background: loading || !input.trim() ? '#1a1a1a' : '#f97316', color: loading || !input.trim() ? '#333' : '#000', padding: '0 16px', borderRadius: '6px', border: 'none', fontWeight: 'bold', cursor: loading ? 'not-allowed' : 'pointer', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px' }}
          >
            {loading ? '…' : 'SEND'}
          </button>
        </div>
      </div>
    </div>
  )
}
