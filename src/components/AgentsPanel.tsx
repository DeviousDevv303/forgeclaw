// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
import { useState, useRef, useCallback } from 'react'
import { safeGetItem, safeSetItem, safeJsonParse } from '../lib/storage'
import { callProvider } from '../lib/modelProviders'
import type { ProviderId } from '../lib/modelProviders'

interface CustomAgent {
  id: string
  name: string
  systemPrompt: string
}

interface AgentMessage {
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}

interface AgentsPanelProps {
  activeProvider: ProviderId
  activeModel: string
  apiKey: string
}

const STORAGE_KEY = 'fc_custom_agents'

function loadAgents(): CustomAgent[] {
  return safeJsonParse(safeGetItem(STORAGE_KEY), [])
}

function saveAgents(agents: CustomAgent[]) {
  safeSetItem(STORAGE_KEY, JSON.stringify(agents))
}

export function AgentsPanel({ activeProvider, activeModel, apiKey }: AgentsPanelProps) {
  const [agents, setAgents] = useState<CustomAgent[]>(loadAgents)
  const [activeAgent, setActiveAgent] = useState<CustomAgent | null>(null)
  const [editing, setEditing] = useState<CustomAgent | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftPrompt, setDraftPrompt] = useState('')
  const [chatMessages, setChatMessages] = useState<AgentMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  const openNew = () => {
    setEditing({ id: '', name: '', systemPrompt: '' })
    setDraftName('')
    setDraftPrompt('')
  }

  const openEdit = (agent: CustomAgent) => {
    setEditing(agent)
    setDraftName(agent.name)
    setDraftPrompt(agent.systemPrompt)
  }

  const saveAgent = () => {
    if (!draftName.trim() || !draftPrompt.trim()) return
    const updated = editing!.id
      ? agents.map(a => a.id === editing!.id ? { ...a, name: draftName.trim(), systemPrompt: draftPrompt.trim() } : a)
      : [...agents, { id: `agent_${Date.now()}`, name: draftName.trim(), systemPrompt: draftPrompt.trim() }]
    setAgents(updated)
    saveAgents(updated)
    setEditing(null)
  }

  const deleteAgent = (id: string) => {
    const updated = agents.filter(a => a.id !== id)
    setAgents(updated)
    saveAgents(updated)
    if (activeAgent?.id === id) setActiveAgent(null)
  }

  const launchAgent = (agent: CustomAgent) => {
    setActiveAgent(agent)
    setChatMessages([])
    setInput('')
  }

  const sendMessage = useCallback(async () => {
    if (!input.trim() || loading || !activeAgent) return
    const text = input.trim()
    setInput('')
    const userMsg: AgentMessage = { role: 'user', content: text }
    setChatMessages(prev => [...prev, userMsg, { role: 'assistant', content: '', streaming: true }])
    setLoading(true)

    try {
      const history = chatMessages.map(m => ({ role: m.role, content: m.content }))
      let buf = ''
      await callProvider(activeProvider, activeModel, activeAgent.systemPrompt,
        [...history, { role: 'user', content: text }],
        apiKey,
        {
          onToken: (token: string) => {
            buf += token
            setChatMessages(prev => prev.map((m, i) => i === prev.length - 1 ? { ...m, content: buf, streaming: true } : m))
          },
        }
      )
      setChatMessages(prev => prev.map((m, i) => i === prev.length - 1 ? { ...m, content: buf || '(no response)', streaming: false } : m))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error'
      setChatMessages(prev => prev.map((m, i) => i === prev.length - 1 ? { ...m, content: `[ERROR]: ${msg}`, streaming: false } : m))
    } finally {
      setLoading(false)
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    }
  }, [input, loading, activeAgent, chatMessages, activeProvider, activeModel, apiKey])

  const inputStyle: React.CSSProperties = {
    background: '#0a0a0a', color: '#ccc', border: '1px solid #222',
    borderRadius: '4px', padding: '8px', fontSize: '12px', fontFamily: 'monospace',
    outline: 'none', width: '100%', boxSizing: 'border-box',
  }
  const btnStyle = (accent = false): React.CSSProperties => ({
    background: accent ? '#f97316' : '#1a1a1a', color: accent ? '#000' : '#888',
    border: `1px solid ${accent ? '#f97316' : '#333'}`, borderRadius: '4px',
    padding: '6px 12px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold',
    fontFamily: 'monospace',
  })

  // ── Editor view ─────────────────────────────────────────────────────────────
  if (editing !== null) {
    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        <div style={{ maxWidth: '480px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button onClick={() => setEditing(null)} style={{ ...btnStyle(), padding: '4px 10px' }}>← BACK</button>
            <span style={{ color: '#f97316', fontSize: '11px', fontFamily: 'monospace', letterSpacing: '2px', fontWeight: 'bold' }}>
              {editing.id ? 'EDIT AGENT' : 'NEW AGENT'}
            </span>
          </div>
          <div>
            <label style={{ display: 'block', color: '#888', fontSize: '10px', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Name</label>
            <input style={inputStyle} placeholder="e.g. Legal Analyst, Code Reviewer…" value={draftName} onChange={e => setDraftName(e.target.value)} />
          </div>
          <div>
            <label style={{ display: 'block', color: '#888', fontSize: '10px', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>System Prompt</label>
            <textarea
              style={{ ...inputStyle, height: '220px', resize: 'vertical' }}
              placeholder="You are a specialist in… Be concise. Use plain prose."
              value={draftPrompt}
              onChange={e => setDraftPrompt(e.target.value)}
            />
          </div>
          <button onClick={saveAgent} disabled={!draftName.trim() || !draftPrompt.trim()} style={{ ...btnStyle(true), opacity: (!draftName.trim() || !draftPrompt.trim()) ? 0.4 : 1 }}>
            SAVE AGENT
          </button>
        </div>
      </div>
    )
  }

  // ── Chat view ────────────────────────────────────────────────────────────────
  if (activeAgent !== null) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ padding: '8px 16px', borderBottom: '1px solid #1a1a1a', display: 'flex', alignItems: 'center', gap: '10px', background: '#0a0a0a' }}>
          <button onClick={() => setActiveAgent(null)} style={{ ...btnStyle(), padding: '3px 10px', fontSize: '10px' }}>← AGENTS</button>
          <span style={{ color: '#f97316', fontSize: '11px', fontFamily: 'monospace', fontWeight: 'bold', letterSpacing: '1px' }}>{activeAgent.name}</span>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {chatMessages.length === 0 && (
            <div style={{ color: '#333', fontSize: '10px', fontFamily: 'monospace', textAlign: 'center', marginTop: '40px' }}>
              {activeAgent.name} is ready. Send a message.
            </div>
          )}
          {chatMessages.map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '85%', padding: '8px 12px', borderRadius: '8px', fontSize: '13px', lineHeight: '1.5',
                background: m.role === 'user' ? '#f97316' : '#111',
                color: m.role === 'user' ? '#000' : '#ccc',
                border: m.role === 'assistant' ? '1px solid #1a1a1a' : 'none',
                fontFamily: 'system-ui, sans-serif',
                opacity: m.streaming ? 0.85 : 1,
              }}>
                {m.content || (m.streaming ? '▋' : '')}
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
        <div style={{ padding: '10px 16px', borderTop: '1px solid #1a1a1a', display: 'flex', gap: '8px', background: '#0a0a0a' }}>
          <input
            style={{ flex: 1, background: '#111', color: '#ccc', border: '1px solid #222', borderRadius: '6px', padding: '10px 12px', fontSize: '13px', outline: 'none' }}
            placeholder="Message…"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
            disabled={loading}
          />
          <button onClick={sendMessage} disabled={loading || !input.trim()} style={{ ...btnStyle(true), padding: '10px 18px', opacity: (loading || !input.trim()) ? 0.5 : 1 }}>
            {loading ? '…' : 'SEND'}
          </button>
        </div>
      </div>
    )
  }

  // ── Agent list view ──────────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
      <div style={{ maxWidth: '480px', margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <span style={{ color: '#f97316', fontSize: '11px', fontFamily: 'monospace', letterSpacing: '2px', fontWeight: 'bold' }}>AGENTS</span>
          <button onClick={openNew} style={btnStyle(true)}>+ NEW AGENT</button>
        </div>

        {agents.length === 0 && (
          <div style={{ textAlign: 'center', color: '#333', fontSize: '11px', fontFamily: 'monospace', marginTop: '60px', lineHeight: '2' }}>
            No agents yet.<br />
            Create one with a custom system prompt<br />and launch it for a dedicated chat.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {agents.map(agent => (
            <div key={agent.id} style={{ background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: '6px', padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ color: '#ccc', fontSize: '13px', fontWeight: 'bold', fontFamily: 'system-ui' }}>{agent.name}</span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button onClick={() => openEdit(agent)} style={{ ...btnStyle(), padding: '3px 8px', fontSize: '10px' }}>EDIT</button>
                  <button onClick={() => deleteAgent(agent.id)} style={{ ...btnStyle(), padding: '3px 8px', fontSize: '10px', color: '#555' }}>✕</button>
                </div>
              </div>
              <div style={{ color: '#444', fontSize: '10px', fontFamily: 'monospace', marginBottom: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {agent.systemPrompt.slice(0, 90)}{agent.systemPrompt.length > 90 ? '…' : ''}
              </div>
              <button onClick={() => launchAgent(agent)} style={{ ...btnStyle(true), width: '100%', padding: '7px' }}>
                LAUNCH CHAT
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
