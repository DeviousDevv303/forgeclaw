import { useState, useRef, useEffect } from 'react'
import { createManagedSession, sendManagedMessage, streamManagedSession } from '../lib/managedAgent'
import { useErrorBus } from '../hooks/useErrorBus'

interface CoachMessage {
  role: 'user' | 'assistant'
  content: string
}

interface Props {
  agentId: string
  apiKey: string
  onAgentIdSave: (id: string) => void
}

export function StrategicCoach({ agentId, apiKey, onAgentIdSave }: Props) {
  const [messages, setMessages] = useState<CoachMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [agentIdDraft, setAgentIdDraft] = useState(agentId)
  const streamBuffer = useRef('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const { emitFailure } = useErrorBus()

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, streaming])

  const send = async () => {
    const text = input.trim()
    if (!text || streaming || !agentId || !apiKey) return
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setStreaming(true)
    streamBuffer.current = ''

    try {
      let sid = sessionId
      if (!sid) {
        sid = await createManagedSession(agentId, apiKey)
        setSessionId(sid)
      }

      await sendManagedMessage(sid, text, apiKey)

      setMessages(prev => [...prev, { role: 'assistant', content: '' }])

      await streamManagedSession(
        sid,
        apiKey,
        (token) => {
          streamBuffer.current += token
          setMessages(prev => prev.map((m, i) =>
            i === prev.length - 1 && m.role === 'assistant'
              ? { ...m, content: streamBuffer.current }
              : m
          ))
        },
        () => { setStreaming(false) },
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      emitFailure({ source: 'coach', severity: 'error', message: msg })
      setMessages(prev => [...prev, { role: 'assistant', content: `[Error] ${msg}` }])
      setStreaming(false)
    }
  }

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  // ── Setup screen ─────────────────────────────────────────────────────────────
  if (!agentId) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '20px', padding: '40px', background: '#080808' }}>
        <div style={{ color: '#f97316', fontSize: '11px', letterSpacing: '3px', fontFamily: 'monospace' }}>STRATEGIC MIND COACH</div>
        <div style={{ color: '#555', fontSize: '12px', fontFamily: 'monospace' }}>Enter your Managed Agent ID to begin.</div>
        <div style={{ display: 'flex', gap: '10px', width: '100%', maxWidth: '480px' }}>
          <input
            value={agentIdDraft}
            onChange={e => setAgentIdDraft(e.target.value)}
            placeholder="agent_xxxxxxxxxx"
            style={{ flex: 1, background: '#111', border: '1px solid #2a2a2a', borderRadius: '6px', padding: '8px 12px', color: '#e5e5e5', fontFamily: 'monospace', fontSize: '12px', outline: 'none' }}
          />
          <button
            onClick={() => { if (agentIdDraft.trim()) onAgentIdSave(agentIdDraft.trim()) }}
            style={{ background: '#f97316', color: '#000', border: 'none', borderRadius: '6px', padding: '8px 16px', fontFamily: 'monospace', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '1px' }}
          >
            SAVE
          </button>
        </div>
      </div>
    )
  }

  // ── Chat panel ───────────────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>

      {/* Header */}
      <div style={{ padding: '10px 20px', borderBottom: '1px solid #111', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <span style={{ color: '#f97316', fontSize: '10px', letterSpacing: '3px', fontFamily: 'monospace' }}>STRATEGIC MIND COACH</span>
        <span style={{ color: '#333', fontSize: '9px', fontFamily: 'monospace', letterSpacing: '1px' }}>
          {sessionId ? `SESSION · ${sessionId.slice(-8)}` : 'NO SESSION'}
        </span>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {messages.length === 0 && (
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
              {msg.content || (streaming && i === messages.length - 1 ? <span style={{ color: '#444', animation: 'pulse 1.5s infinite' }}>●</span> : '')}
            </div>
          </div>
        ))}
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
            disabled={streaming}
            placeholder="Ask the Coach…"
            style={{ flex: 1, background: 'transparent', color: '#e5e5e5', border: 'none', outline: 'none', resize: 'none', fontSize: '13px', fontFamily: 'monospace', minHeight: '40px', WebkitAppearance: 'none' }}
          />
          <button
            onClick={send}
            disabled={streaming || !input.trim()}
            style={{ background: streaming || !input.trim() ? '#1a1a1a' : '#f97316', color: streaming || !input.trim() ? '#333' : '#000', padding: '0 16px', borderRadius: '6px', border: 'none', fontWeight: 'bold', cursor: streaming ? 'not-allowed' : 'pointer', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px' }}
          >
            {streaming ? '…' : 'SEND'}
          </button>
        </div>
      </div>
    </div>
  )
}
