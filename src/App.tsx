import { useState, useRef, useEffect } from 'react'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  source?: 'local' | 'cloud'
  activeTags?: string[]
  phases?: Record<string, string>
  showReasoning?: boolean
  feedback?: 'up' | 'down'
}

interface CorpusEntry {
  prompt: string
  response: string
  source: 'claude-haiku' | 'ollama'
  timestamp: string
}

const FORGEMIND_SYSTEM_PROMPT = `
You are operating as ForgeMind, a structured reasoning interface built on Claude by Anthropic. You are Claude — this context simply provides a reasoning framework for responses.

When responding, use this 5-phase scaffold as a thinking framework:

1. Assumptions — state what you are taking as given
2. Heuristics — apply relevant rules of thumb
3. First Principles — reason from fundamentals
4. Extension — explore implications and edge cases
5. Convergence — deliver the final synthesized answer

These phases are a reasoning aid, not a constraint. You retain all your normal values, guidelines, and identity as Claude.

[FM:STORE] (Optional: Use if critical for logging)
[FM:RECALL] (Optional: Use if referencing history)
[FM:TRAIN] (Optional: Use if high quality)
`

const TAG_MAP: Record<string, string> = {
  '[FM:PHASE_1]': 'Assumptions',
  '[FM:PHASE_2]': 'Heuristics',
  '[FM:PHASE_3]': 'First Principles',
  '[FM:PHASE_4]': 'Extension',
  '[FM:PHASE_5]': 'Convergence',
  '[FM:STORE]': 'Logged to corpus',
  '[FM:RECALL]': 'Searching history',
  '[FM:TRAIN]': 'Flagged for training',
}

const PHASE_ICONS: Record<string, string> = {
  PHASE_1: '◈',
  PHASE_2: '◈',
  PHASE_3: '◈',
  PHASE_4: '◈',
  PHASE_5: '◈',
}

function cleanOutput(text: string): string {
  return text
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/#{1,6}\s/g, '')
    .replace(/__|_/g, '')
    .replace(/\s+\n/g, '\n')
    .trim();
}

function cleanForSpeech(text: string): string {
  return text
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[\u{2600}-\u{26FF}]/gu, '')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .trim();
}

function App() {
  const [messages, setMessages] = useState<Message[]>(() => {
    const saved = localStorage.getItem('forgemind_history')
    return saved ? JSON.parse(saved) : []
  })
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showApiKey, setShowApiKey] = useState(false)
  const [apiKey, setApiKey] = useState(() => {
    return localStorage.getItem('fm_api_key') || ''
  })
  const [corpus, setCorpus] = useState<CorpusEntry[]>(() => {
    const saved = localStorage.getItem('forgemind_corpus')
    return saved ? JSON.parse(saved) : []
  })
  const [lastSource, setLastSource] = useState<'local' | 'cloud' | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [selectedVoice, setSelectedVoice] = useState<string>('')
  const [rate, setRate] = useState<number>(1.0)
  // Per-message inline reasoning open state (replaces old drawer)
  const [openReasoningIds, setOpenReasoningIds] = useState<Set<string>>(new Set())
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => { scrollToBottom() }, [messages])
  useEffect(() => { localStorage.setItem('forgemind_history', JSON.stringify(messages)) }, [messages])
  useEffect(() => { localStorage.setItem('forgemind_corpus', JSON.stringify(corpus)) }, [corpus])
  useEffect(() => { localStorage.setItem('fm_api_key', apiKey) }, [apiKey])

  useEffect(() => {
    const loadVoices = () => {
      const availableVoices = window.speechSynthesis.getVoices()
      setVoices(availableVoices)
      if (availableVoices.length > 0 && !selectedVoice) {
        setSelectedVoice(availableVoices[0].name)
      }
    }
    loadVoices()
    window.speechSynthesis.onvoiceschanged = loadVoices
  }, [selectedVoice])

  const logToCorpus = (prompt: string, response: string, source: 'claude-haiku' | 'ollama') => {
    const entry: CorpusEntry = { prompt, response, source, timestamp: new Date().toISOString() }
    setCorpus((prev) => [...prev, entry])
  }

  const parseAndExecuteTags = (text: string, prompt: string, source: 'claude-haiku' | 'ollama') => {
    const tagsFound: string[] = []
    const phases: Record<string, string> = {}
    let finalContent = ''

    const phaseRegex = /\[FM:PHASE_([1-5])\]([\s\S]*?)(?=\[FM:PHASE_|$|\[FM:STORE|\[FM:RECALL|\[FM:TRAIN)/g
    let match
    while ((match = phaseRegex.exec(text)) !== null) {
      const phaseNum = match[1]
      const phaseContent = match[2].trim()
      phases[`PHASE_${phaseNum}`] = phaseContent
      tagsFound.push(`[FM:PHASE_${phaseNum}]`)
      if (phaseNum === '5') finalContent = phaseContent
    }

    if (!phases['PHASE_5']) finalContent = text

    ;['[FM:STORE]', '[FM:RECALL]', '[FM:TRAIN]'].forEach(tag => {
      if (text.includes(tag)) {
        tagsFound.push(tag)
        if (tag === '[FM:STORE]') logToCorpus(prompt, finalContent, source)
        if (tag === '[FM:TRAIN]') console.log('%c[FORGEMIND] Flagged for training', 'color: #f97316; font-weight: bold;')
        if (tag === '[FM:RECALL]') console.log('%c[FORGEMIND] Recalling context...', 'color: #3b82f6; font-weight: bold;')
      }
    })

    return { cleanText: cleanOutput(finalContent), tagsFound, phases }
  }

  const handleSendMessage = async () => {
    if (input.trim() === '') return
    if (!apiKey) {
      setError('Claude API key required. Please enter your API key.')
      return
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: Date.now(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setLoading(true)
    setError(null)

    let responseText = ''
    let source: 'local' | 'cloud' = 'cloud'

    try {
      let ollamaSuccess = false

      try {
        const ollamaResponse = await fetch('http://localhost:11434/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'qwen2.5:1.8b',
            system: FORGEMIND_SYSTEM_PROMPT,
            prompt: input,
            stream: false,
          }),
          signal: AbortSignal.timeout(1500)
        })
        if (ollamaResponse.ok) {
          const data = await ollamaResponse.json()
          responseText = data.response || 'No response received'
          source = 'local'
          setLastSource('local')
          ollamaSuccess = true
        }
      } catch (ollamaErr) {
        console.warn('Local engine unreachable, switching to Cloud...', ollamaErr)
      }

      if (!ollamaSuccess) {
        const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1024,
            system: FORGEMIND_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: input }],
          }),
        })

        if (!claudeResponse.ok) {
          const errorData = await claudeResponse.json().catch(() => ({}))
          throw new Error(errorData.error?.message || `Claude API returned ${claudeResponse.status}: ${claudeResponse.statusText}`)
        }

        const claudeData = await claudeResponse.json()
        responseText = claudeData.content[0]?.text || 'No response received'
        source = 'cloud'
        setLastSource('cloud')
      }

      const { cleanText, tagsFound, phases } = parseAndExecuteTags(responseText, input, source === 'local' ? 'ollama' : 'claude-haiku')

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: cleanText,
        timestamp: Date.now(),
        source,
        activeTags: tagsFound,
        phases,
        showReasoning: false
      }

      setMessages((prev) => [...prev, assistantMessage])
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      setError(`System Alert: ${errorMessage}`)
      console.error('ForgeMind Error:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleSpeak = (id: string, text: string) => {
    if (speakingId === id) {
      window.speechSynthesis.cancel()
      setSpeakingId(null)
      return
    }
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(cleanForSpeech(text))
    const voice = voices.find(v => v.name === selectedVoice)
    if (voice) utterance.voice = voice
    utterance.rate = rate
    utterance.onend = () => setSpeakingId(null)
    setSpeakingId(id)
    window.speechSynthesis.speak(utterance)
  }

  const handleFeedback = (id: string, type: 'up' | 'down') => {
    setMessages(prev => prev.map(msg =>
      msg.id === id ? { ...msg, feedback: type } : msg
    ))
  }

  // Toggle inline reasoning dropdown per message
  const toggleReasoning = (id: string) => {
    setOpenReasoningIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleClearMemory = () => {
    if (window.confirm('CRITICAL: WIPE ALL SESSION MEMORY AND API KEY?')) {
      localStorage.removeItem('forgemind_history')
      localStorage.removeItem('forgemind_corpus')
      localStorage.removeItem('fm_api_key')
      setMessages([])
      setCorpus([])
      setApiKey('')
      setLastSource(null)
      setOpenReasoningIds(new Set())
      setError('Memory purged. System reset.')
      setTimeout(() => setError(null), 3000)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const handleExportCorpus = () => {
    if (corpus.length === 0) {
      setError('No interactions to export yet.')
      return
    }
    const jsonlContent = corpus.map((entry) => JSON.stringify(entry)).join('\n')
    const blob = new Blob([jsonlContent], { type: 'application/jsonl' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'forge-mind-corpus.jsonl'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const getStatusIndicator = () => {
    if (lastSource === 'local') return <span style={{ color: '#10b981', fontWeight: 'bold' }}>● Local</span>
    if (lastSource === 'cloud') return <span style={{ color: '#3b82f6', fontWeight: 'bold' }}>● Cloud</span>
    return <span style={{ color: '#6b6b6b' }}>● Idle</span>
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#e5e5e5', fontFamily: 'monospace', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <header style={{ borderBottom: '1px solid #1a1a1a', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#0a0a0a' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ color: '#f97316', fontSize: '18px' }}>⚙</span>
          <span style={{ color: '#f97316', fontWeight: 'bold', fontSize: '16px', letterSpacing: '1px' }}>FORGECLAW</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ fontSize: '11px' }}>{getStatusIndicator()}</div>
          <button onClick={handleClearMemory} style={{ ...headerBtnStyle, opacity: 0.6 }}>WIPE</button>
          <button onClick={handleExportCorpus} style={headerBtnStyle}>EXPORT</button>
        </div>
      </header>

      {/* Main */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', maxWidth: '800px', margin: '0 auto', width: '100%', padding: '16px', position: 'relative' }}>

        {/* API Key + Voice controls */}
        <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
          <div style={{ flex: 1, background: '#111', border: '1px solid #222', borderRadius: '6px', padding: '8px 12px' }}>
            <input
              type={showApiKey ? 'text' : 'password'}
              placeholder="Claude API Key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onDoubleClick={() => setShowApiKey(!showApiKey)}
              style={{ width: '100%', background: 'transparent', color: '#ccc', border: 'none', outline: 'none', fontSize: '12px', fontFamily: 'monospace' }}
            />
          </div>
          <div style={{ flex: 1, background: '#111', border: '1px solid #222', borderRadius: '6px', padding: '6px 10px', display: 'flex', gap: '8px', alignItems: 'center' }}>
            <select
              value={selectedVoice}
              onChange={(e) => setSelectedVoice(e.target.value)}
              style={{ background: 'transparent', color: '#f97316', border: 'none', outline: 'none', fontSize: '10px', flex: 1, fontFamily: 'monospace' }}
            >
              {voices.map(v => <option key={v.name} value={v.name} style={{ background: '#111' }}>{v.name}</option>)}
            </select>
            <input
              type="range" min="0.5" max="2" step="0.1" value={rate}
              onChange={(e) => setRate(parseFloat(e.target.value))}
              style={{ width: '50px', accentColor: '#f97316' }}
            />
          </div>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px', paddingBottom: '20px' }}>
          {messages.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#444' }}>
              <p>System initialized. Awaiting input...</p>
            </div>
          ) : (
            messages.map((msg) => {
              const reasoningOpen = openReasoningIds.has(msg.id)
              return (
                <div
                  key={msg.id}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start', gap: '4px' }}
                >
                  {/* Source badge */}
                  {msg.role === 'assistant' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                      <span style={{ fontSize: '14px' }}>🧠</span>
                      {msg.source && (
                        <span style={{ fontSize: '9px', color: msg.source === 'local' ? '#10b981' : '#3b82f6', opacity: 0.7 }}>
                          {msg.source === 'local' ? 'LOCAL' : 'CLOUD'}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Bubble */}
                  <div
                    style={{
                      maxWidth: '90%',
                      padding: '10px 14px',
                      borderRadius: '8px',
                      background: msg.role === 'user' ? '#f97316' : '#1a1a1a',
                      color: msg.role === 'user' ? '#000' : '#e5e5e5',
                      fontSize: '13px',
                      lineHeight: '1.5',
                      border: msg.role === 'assistant' ? '1px solid #222' : 'none',
                      boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
                      width: msg.role === 'assistant' ? '100%' : undefined,
                    }}
                  >
                    {msg.content}

                    {/* Action bar */}
                    {msg.role === 'assistant' && (
                      <div style={{ marginTop: '10px', display: 'flex', gap: '8px', borderTop: '1px solid #222', paddingTop: '8px', alignItems: 'center' }}>
                        <button onClick={() => handleCopy(msg.id, msg.content)} style={actionButtonStyle}>
                          {copiedId === msg.id ? '✓' : 'COPY'}
                        </button>
                        <button onClick={() => handleSpeak(msg.id, msg.content)} style={actionButtonStyle}>
                          {speakingId === msg.id ? '■' : 'READ'}
                        </button>

                        {/* Thumbs — blue accent */}
                        <button
                          onClick={() => handleFeedback(msg.id, 'up')}
                          title="Helpful"
                          style={{
                            ...actionButtonStyle,
                            fontSize: '13px',
                            padding: '2px 5px',
                            border: msg.feedback === 'up' ? '1px solid #3b82f6' : '1px solid #222',
                            color: msg.feedback === 'up' ? '#60a5fa' : '#4a7ab5',
                            textShadow: msg.feedback === 'up' ? '0 0 8px #3b82f6' : 'none',
                            transition: 'all 0.2s',
                          }}
                        >👍</button>
                        <button
                          onClick={() => handleFeedback(msg.id, 'down')}
                          title="Not helpful"
                          style={{
                            ...actionButtonStyle,
                            fontSize: '13px',
                            padding: '2px 5px',
                            border: msg.feedback === 'down' ? '1px solid #3b82f6' : '1px solid #222',
                            color: msg.feedback === 'down' ? '#60a5fa' : '#4a7ab5',
                            textShadow: msg.feedback === 'down' ? '0 0 8px #3b82f6' : 'none',
                            transition: 'all 0.2s',
                          }}
                        >👎</button>

                        {/* Reasoning toggle — same spot, now inline dropdown */}
                        {msg.phases && Object.keys(msg.phases).length > 0 && (
                          <button
                            onClick={() => toggleReasoning(msg.id)}
                            style={{
                              ...actionButtonStyle,
                              marginLeft: 'auto',
                              border: reasoningOpen ? '1px solid #f97316' : '1px solid #444',
                              color: reasoningOpen ? '#f97316' : '#888',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            <span style={{ fontSize: '8px', transition: 'transform 0.2s', display: 'inline-block', transform: reasoningOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                            REASONING
                          </button>
                        )}
                      </div>
                    )}

                    {/* Inline reasoning dropdown — same bubble, below action bar */}
                    {msg.role === 'assistant' && msg.phases && reasoningOpen && (
                      <div style={{
                        marginTop: '12px',
                        borderTop: '1px solid #2a2a2a',
                        paddingTop: '12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '14px',
                        animation: 'fadeSlideDown 0.2s ease',
                      }}>
                        <div style={{
                          fontSize: '9px',
                          letterSpacing: '2px',
                          color: '#f97316',
                          opacity: 0.6,
                          textTransform: 'uppercase',
                          marginBottom: '2px',
                        }}>
                          5-Phase Cognitive Scaffold
                        </div>
                        {(['PHASE_1', 'PHASE_2', 'PHASE_3', 'PHASE_4', 'PHASE_5'] as const).map((phase) => {
                          const content = msg.phases?.[phase]
                          if (!content) return null
                          const label = TAG_MAP[`[FM:${phase}]`]
                          const icon = PHASE_ICONS[phase]
                          return (
                            <div key={phase} style={{
                              borderLeft: '2px solid #f9731640',
                              paddingLeft: '12px',
                              position: 'relative',
                            }}>
                              {/* Phase label — script font */}
                              <div style={{
                                fontFamily: "'Crimson Pro', 'Palatino Linotype', 'Book Antiqua', Georgia, serif",
                                fontStyle: 'italic',
                                fontSize: '15px',
                                color: '#f97316',
                                marginBottom: '5px',
                                letterSpacing: '0.3px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                              }}>
                                <span style={{ fontSize: '10px', opacity: 0.7 }}>{icon}</span>
                                {label}
                              </div>
                              {/* Phase content — script font, lighter */}
                              <div style={{
                                fontFamily: "'Crimson Pro', 'Palatino Linotype', 'Book Antiqua', Georgia, serif",
                                fontStyle: 'italic',
                                fontSize: '14px',
                                color: '#c8c0b8',
                                lineHeight: '1.65',
                                whiteSpace: 'pre-wrap',
                              }}>
                                {content}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )
            })
          )}

          {loading && (
            <div style={{ color: '#f97316', fontSize: '11px', display: 'flex', gap: '4px' }}>
              <span className="pulse-text">EXECUTING COGNITIVE SCAFFOLD...</span>
            </div>
          )}
          {error && (
            <div style={{ color: '#f97316', fontSize: '11px', padding: '8px', background: '#200', borderRadius: '4px', border: '1px solid #400' }}>
              [SYSTEM_ERROR]: {error}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input bar */}
        <div style={{ background: '#0a0a0a', borderTop: '1px solid #1a1a1a', padding: '12px 0' }}>
          <div style={{ display: 'flex', gap: '10px', background: '#111', border: '1px solid #222', borderRadius: '8px', padding: '8px 12px' }}>
            <textarea
              style={{ flex: 1, background: 'transparent', color: '#e5e5e5', border: 'none', outline: 'none', resize: 'none', fontSize: '13px', fontFamily: 'monospace', minHeight: '40px' }}
              rows={2}
              placeholder="Query ForgeMind..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              disabled={loading}
            />
            <button
              style={{ background: '#f97316', color: '#000', padding: '0 16px', borderRadius: '6px', border: 'none', fontWeight: 'bold', cursor: loading ? 'not-allowed' : 'pointer', fontSize: '12px', textTransform: 'uppercase' }}
              onClick={handleSendMessage}
              disabled={loading}
            >
              SEND
            </button>
          </div>
        </div>
      </main>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@1,400;1,500;1,600&display=swap');
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        @keyframes fadeSlideDown {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .pulse-text { animation: pulse 1.5s infinite; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0a0a0a; }
        ::-webkit-scrollbar-thumb { background: #222; border-radius: 2px; }
        ::-webkit-scrollbar-thumb:hover { background: #333; }
      `}</style>
    </div>
  )
}

const headerBtnStyle: React.CSSProperties = {
  background: 'transparent',
  color: '#f97316',
  padding: '4px 10px',
  borderRadius: '4px',
  border: '1px solid #f97316',
  fontWeight: 'bold',
  cursor: 'pointer',
  fontSize: '10px',
  textTransform: 'uppercase',
}

const actionButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #222',
  color: '#666',
  fontSize: '9px',
  padding: '2px 6px',
  cursor: 'pointer',
  borderRadius: '3px',
  fontWeight: 'bold',
  letterSpacing: '0.5px',
  transition: 'all 0.2s',
}

export default App
