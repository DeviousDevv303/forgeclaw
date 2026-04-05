import { useState, useRef, useEffect } from 'react'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  source?: 'local' | 'cloud'
}

interface CorpusEntry {
  prompt: string
  response: string
  source: 'claude-haiku' | 'ollama'
  timestamp: string
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

  const handleSendMessage = async () => {
    if (input.trim() === '') return
    if (!apiKey.trim()) {
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
      // Try Ollama first (Localhost:11434 or Localhost:3001)
      let ollamaSuccess = false;
      try {
        // First, check if we are on a secure context and trying to hit localhost
        // Mixed content policy usually blocks this, so we wrap it in a try-catch
        const ollamaResponse = await fetch('http://localhost:11434/api/generate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'qwen2.5:1.8b',
            prompt: input,
            stream: false,
          }),
          // Short timeout to detect unreachability quickly
          signal: AbortSignal.timeout(2000) 
        })

        if (ollamaResponse.ok) {
          const data = await ollamaResponse.json()
          responseText = data.response || 'No response received'
          source = 'local'
          setLastSource('local')
          logToCorpus(input, responseText, 'ollama')
          ollamaSuccess = true;
        }
      } catch (ollamaErr) {
        console.warn('Local Ollama unreachable or blocked by mixed content policy. Falling back to direct Anthropic API call.', ollamaErr);
      }

      if (!ollamaSuccess) {
        // Fallback to Direct Claude API Call (Bypassing Localhost)
        if (!apiKey.trim()) {
          throw new Error('Local engine unreachable and no Claude API key provided')
        }

        const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify({
            model: 'claude-3-5-haiku-20241022',
            max_tokens: 1024,
            messages: [
              {
                role: 'user',
                content: input,
              },
            ],
          }),
        })

        if (!claudeResponse.ok) {
          const errorData = await claudeResponse.json()
          throw new Error(`Claude API error: ${errorData.error?.message || claudeResponse.statusText}`)
        }

        const claudeData = await claudeResponse.json()
        responseText = claudeData.content[0]?.text || 'No response received'
        source = 'cloud'
        setLastSource('cloud')
        logToCorpus(input, responseText, 'claude-haiku')
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: responseText,
        timestamp: Date.now(),
        source,
      }

      setMessages((prev) => [...prev, assistantMessage])
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      setError(`Error: ${errorMessage}`)
      console.error('Error:', err)
    } finally {
      setLoading(false)
    }
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
          <p style={{ color: '#6b6b6b', fontSize: '14px' }}>Local AI powered by Ollama (with direct Claude fallback for mobile)</p>
        </div>

        {/* API Key Input */}
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
                    justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                    marginBottom: '8px',
                    alignItems: 'flex-end',
                    gap: '8px',
                  }}
                >
                  {msg.role === 'assistant' && msg.source && (
                    <span style={{ fontSize: '10px', color: msg.source === 'local' ? '#10b981' : '#3b82f6', marginBottom: '4px' }}>
                      {msg.source === 'local' ? 'LOCAL' : 'CLOUD'}
                    </span>
                  )}
                  <div
                    style={{
                      maxWidth: '70%',
                      padding: '12px 16px',
                      borderRadius: '6px',
                      background: msg.role === 'user' ? '#f97316' : '#2a2a2a',
                      color: msg.role === 'user' ? '#000' : '#e5e5e5',
                      wordWrap: 'break-word',
                      fontSize: '13px',
                      lineHeight: '1.5',
                    }}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}
              {loading && (
                <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '8px' }}>
                  <div
                    style={{
                      padding: '12px 16px',
                      borderRadius: '6px',
                      background: '#2a2a2a',
                      color: '#f97316',
                      fontSize: '13px',
                    }}
                  >
                    <span style={{ animation: 'pulse 1.5s infinite' }}>Thinking...</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {error && (
          <div style={{ background: '#3a1a1a', border: '1px solid #f97316', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', color: '#f97316', fontSize: '13px' }}>
            {error}
          </div>
        )}

        <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '8px', padding: '16px' }}>
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
              placeholder="Ask me anything... (Ctrl+Enter to send)"
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
                fontWeight: '600',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '13px',
                height: 'fit-content',
                whiteSpace: 'nowrap',
              }}
              onClick={handleSendMessage}
              disabled={loading}
            >
              {loading ? 'SENDING...' : 'SEND'}
            </button>
          </div>
        </div>
      </main>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  )
}

export default App
