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
}

interface CorpusEntry {
  prompt: string
  response: string
  source: 'claude-haiku' | 'ollama'
  timestamp: string
}

const FORGEMIND_SYSTEM_PROMPT = `
You are ForgeMind, a high-performance cyberpunk AI assistant.
You MUST process every user request through the ForgeMind 5-Phase Cognitive Scaffold before providing a final response.
Format your response exactly as follows, including the tags:

[FM:PHASE_1]
(Your assumptions about the query)

[FM:PHASE_2]
(Heuristic patterns and rules applied)

[FM:PHASE_3]
(Breakdown to first principles)

[FM:PHASE_4]
(Extensions and connections)

[FM:PHASE_5]
(Your final synthesized response)

[FM:STORE] (Optional: Use if critical for logging)
[FM:RECALL] (Optional: Use if referencing history)
[FM:TRAIN] (Optional: Use if high quality)
`

const TAG_MAP: Record<string, string> = {
  '[FM:PHASE_1]': '⚡ Assumptions phase activated',
  '[FM:PHASE_2]': '⚡ Heuristics phase activated',
  '[FM:PHASE_3]': '⚡ First Principles phase activated',
  '[FM:PHASE_4]': '⚡ Extension phase activated',
  '[FM:PHASE_5]': '⚡ Convergence phase activated',
  '[FM:STORE]': '💾 Response logged to corpus',
  '[FM:RECALL]': '🔍 Searching chat history',
  '[FM:TRAIN]': '💎 High-quality data flagged',
}

function App() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [corpus, setCorpus] = useState<CorpusEntry[]>([])
  const [lastSource, setLastSource] = useState<'local' | 'cloud' | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const logToCorpus = (prompt: string, response: string, source: 'claude-haiku' | 'ollama') => {
    const entry: CorpusEntry = {
      prompt,
      response,
      source,
      timestamp: new Date().toISOString(),
    }
    setCorpus((prev) => [...prev, entry])
  }

  const parseAndExecuteTags = (text: string, prompt: string, source: 'claude-haiku' | 'ollama') => {
    const tagsFound: string[] = []
    const phases: Record<string, string> = {}
    let finalContent = ''
    
    // Extract phases using regex
    const phaseRegex = /\[FM:PHASE_([1-5])\]([\s\S]*?)(?=\[FM:PHASE_|$|\[FM:STORE|\[FM:RECALL|\[FM:TRAIN)/g
    let match
    while ((match = phaseRegex.exec(text)) !== null) {
      const phaseNum = match[1]
      const phaseContent = match[2].trim()
      phases[`PHASE_${phaseNum}`] = phaseContent
      tagsFound.push(`[FM:PHASE_${phaseNum}]`)
      if (phaseNum === '5') {
        finalContent = phaseContent
      }
    }

    // If no phases found (fallback for non-compliant AI), use whole text as Phase 5
    if (!phases['PHASE_5']) {
      finalContent = text
    }

    // Handle other tags
    ['[FM:STORE]', '[FM:RECALL]', '[FM:TRAIN]'].forEach(tag => {
      if (text.includes(tag)) {
        tagsFound.push(tag)
        if (tag === '[FM:STORE]') {
          logToCorpus(prompt, finalContent, source)
        }
        if (tag === '[FM:TRAIN]') {
          console.log('%c[FORGEMIND] Interaction flagged for training', 'color: #f97316; font-weight: bold;')
        }
        if (tag === '[FM:RECALL]') {
          console.log('%c[FORGEMIND] Recalling past context...', 'color: #3b82f6; font-weight: bold;')
        }
      }
    })

    return { cleanText: finalContent, tagsFound, phases }
  }

  const handleSendMessage = async () => {
    if (input.trim() === '') return
    if (!apiKey) {
      setError('Claude API key required for fallback. Please enter your API key.')
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
      let ollamaSuccess = false;
      
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
          ollamaSuccess = true;
        }
      } catch (ollamaErr) {
        console.warn('Local engine unreachable, switching to Cloud...', ollamaErr);
      }

      if (!ollamaSuccess) {
        try {
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
            const errorData = await claudeResponse.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `Claude API returned ${claudeResponse.status}: ${claudeResponse.statusText}`);
          }

          const claudeData = await claudeResponse.json()
          responseText = claudeData.content[0]?.text || 'No response received'
          source = 'cloud'
          setLastSource('cloud')
        } catch (fetchErr) {
          if (fetchErr instanceof Error && fetchErr.name === 'TypeError' && fetchErr.message.includes('fetch')) {
             throw new Error("Cloud Network Error: The browser blocked the request. Ensure your API key is correct and you have an active internet connection.");
          }
          throw fetchErr;
        }
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

  const toggleReasoning = (msgId: string) => {
    setMessages(prev => prev.map(msg => 
      msg.id === msgId ? { ...msg, showReasoning: !msg.showReasoning } : msg
    ))
  }

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && e.ctrlKey) {
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
    if (lastSource === 'local') {
      return <span style={{ color: '#10b981', fontWeight: 'bold' }}>● Local</span>
    } else if (lastSource === 'cloud') {
      return <span style={{ color: '#3b82f6', fontWeight: 'bold' }}>● Cloud</span>
    }
    return <span style={{ color: '#6b6b6b' }}>● Idle</span>
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', color: '#e5e5e5', fontFamily: 'monospace', display: 'flex', flexDirection: 'column' }}>
      <header style={{ borderBottom: '1px solid #2a2a2a', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ color: '#f97316', fontSize: '20px' }}>⚙</span>
          <span style={{ color: '#f97316', fontWeight: 'bold', fontSize: '18px', letterSpacing: '2px' }}>FORGECLAW</span>
          <span style={{ color: '#6b6b6b', fontSize: '12px' }}>forgemind local ai</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ fontSize: '12px' }}>{getStatusIndicator()}</div>
          <button
            onClick={handleExportCorpus}
            style={{
              background: '#2a2a2a',
              color: '#f97316',
              padding: '6px 12px',
              borderRadius: '4px',
              border: '1px solid #f97316',
              fontWeight: '600',
              cursor: 'pointer',
              fontSize: '11px',
              whiteSpace: 'nowrap',
            }}
          >
            Export Corpus
          </button>
        </div>
      </header>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', maxWidth: '800px', margin: '0 auto', width: '100%', padding: '24px' }}>
        <div style={{ marginBottom: '16px' }}>
          <h1 style={{ fontSize: '28px', fontWeight: 'bold', marginBottom: '8px' }}>ForgeMind Chat</h1>
          <p style={{ color: '#6b6b6b', fontSize: '14px' }}>5-Phase Cognitive Scaffold Enabled</p>
        </div>

        <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px' }}>
            <input
            type="password"
            placeholder="Claude API Key (required for mobile/fallback)"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            style={{
              width: '100%',
              background: 'transparent',
              color: '#e5e5e5',
              border: 'none',
              outline: 'none',
              fontSize: '13px',
              fontFamily: 'monospace',
              padding: '12px 0',
              margin: '-12px 0',
              cursor: 'text',
              WebkitAppearance: 'none',
            }}
          />
        </div>

        <div style={{ flex: 1, background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '8px', padding: '16px', marginBottom: '16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', minHeight: '400px' }}>
          {messages.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6b6b6b' }}>
              <p>Start a conversation...</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                    marginBottom: '8px',
                    gap: '4px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {msg.role === 'assistant' && msg.source && (
                      <span style={{ fontSize: '10px', color: msg.source === 'local' ? '#10b981' : '#3b82f6' }}>
                        {msg.source === 'local' ? 'LOCAL' : 'CLOUD'}
                      </span>
                    )}
                  </div>
                  
                  <div
                    style={{
                      maxWidth: '85%',
                      padding: '12px 16px',
                      borderRadius: '6px',
                      background: msg.role === 'user' ? '#f97316' : '#2a2a2a',
                      color: msg.role === 'user' ? '#000' : '#e5e5e5',
                      wordWrap: 'break-word',
                      fontSize: '13px',
                      lineHeight: '1.5',
                      border: msg.role === 'assistant' ? '1px solid #333' : 'none',
                      position: 'relative',
                    }}
                  >
                    {msg.role === 'assistant' && msg.phases && (
                      <div style={{ marginBottom: '12px', borderBottom: '1px solid #333', paddingBottom: '8px' }}>
                        <button 
                          onClick={() => toggleReasoning(msg.id)}
                          style={{
                            background: 'transparent',
                            border: '1px solid #f97316',
                            color: '#f97316',
                            fontSize: '10px',
                            padding: '2px 6px',
                            cursor: 'pointer',
                            borderRadius: '2px',
                            marginBottom: '8px'
                          }}
                        >
                          {msg.showReasoning ? 'HIDE REASONING' : 'VIEW REASONING'}
                        </button>
                        
                        {msg.showReasoning && (
                          <div style={{ fontSize: '11px', color: '#999', marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {['PHASE_1', 'PHASE_2', 'PHASE_3', 'PHASE_4'].map(phase => (
                              msg.phases?.[phase] && (
                                <div key={phase} style={{ borderLeft: '2px solid #f97316', paddingLeft: '8px' }}>
                                  <div style={{ color: '#f97316', fontWeight: 'bold', fontSize: '9px', marginBottom: '2px' }}>{TAG_MAP[`[FM:${phase}]`]}</div>
                                  <div>{msg.phases[phase]}</div>
                                </div>
                              )
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {msg.content}
                    
                    {msg.role === 'assistant' && msg.activeTags && msg.activeTags.length > 0 && (
                      <div style={{ marginTop: '12px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {msg.activeTags.filter(tag => !tag.startsWith('[FM:PHASE_')).map(tag => (
                          <div 
                            key={tag}
                            style={{
                              fontSize: '10px',
                              background: '#000',
                              color: '#f97316',
                              padding: '4px 8px',
                              borderRadius: '2px',
                              border: '1px solid #f97316',
                              textTransform: 'uppercase',
                              letterSpacing: '1px',
                              boxShadow: '0 0 5px rgba(249, 115, 22, 0.3)',
                              animation: 'glitch 2s infinite'
                            }}
                          >
                            {TAG_MAP[tag]}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {loading && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', marginBottom: '8px', gap: '8px' }}>
                  <div
                    style={{
                      padding: '12px 16px',
                      borderRadius: '6px',
                      background: '#2a2a2a',
                      color: '#f97316',
                      fontSize: '13px',
                      border: '1px dashed #f97316',
                      width: 'fit-content'
                    }}
                  >
                    <span className="pulse-text">EXECUTING 5-PHASE COGNITIVE SCAFFOLD...</span>
                  </div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {[1, 2, 3, 4, 5].map(i => (
                      <div 
                        key={i} 
                        style={{ 
                          width: '20px', 
                          height: '4px', 
                          background: '#333', 
                          position: 'relative',
                          overflow: 'hidden'
                        }}
                      >
                        <div 
                          style={{ 
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            height: '100%',
                            width: '100%',
                            background: '#f97316',
                            animation: `phase-pulse 2s infinite ${i * 0.2}s`
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {error && (
          <div style={{ background: '#3a1a1a', border: '1px solid #f97316', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', color: '#f97316', fontSize: '13px', textTransform: 'uppercase' }}>
            [SYSTEM CRITICAL]: {error}
          </div>
        )}

        <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '8px', padding: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}>
          <div style={{ display: 'flex', gap: '12px' }}>
            <textarea
              style={{
                flex: 1,
                background: 'transparent',
                color: '#e5e5e5',
                border: 'none',
                outline: 'none',
                resize: 'none',
                fontSize: '14px',
                lineHeight: '1.6',
                fontFamily: 'monospace',
                minHeight: '60px',
              }}
              rows={3}
              placeholder="Inject command... (Ctrl+Enter to fire)"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              disabled={loading}
            />
            <button
              style={{
                background: loading ? '#7c3316' : '#f97316',
                color: 'white',
                padding: '12px 24px',
                borderRadius: '4px',
                border: 'none',
                fontWeight: 'bold',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '13px',
                height: 'fit-content',
                whiteSpace: 'nowrap',
                letterSpacing: '1px',
                boxShadow: loading ? 'none' : '0 0 10px rgba(249, 115, 22, 0.4)'
              }}
              onClick={handleSendMessage}
              disabled={loading}
            >
              {loading ? 'PROCESSING...' : 'TRANSMIT'}
            </button>
          </div>
        </div>
      </main>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .pulse-text {
          animation: pulse 1.5s infinite;
        }
        @keyframes glitch {
          0% { transform: translate(0) }
          20% { transform: translate(-1px, 1px) }
          40% { transform: translate(-1px, -1px) }
          60% { transform: translate(1px, 1px) }
          80% { transform: translate(1px, -1px) }
          100% { transform: translate(0) }
        }
        @keyframes phase-pulse {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(0); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  )
}

export default App
