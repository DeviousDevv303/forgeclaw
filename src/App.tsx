import { useState, useRef, useEffect } from 'react'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

function App() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSendMessage = async () => {
    if (input.trim() === '') return

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

    try {
      const response = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'qwen2.5:1.8b',
          prompt: input,
          stream: false,
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.response || 'No response received',
        timestamp: Date.now(),
      }

      setMessages((prev) => [...prev, assistantMessage])
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      setError(`Failed to connect to Ollama: ${errorMessage}`)
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

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', color: '#e5e5e5', fontFamily: 'monospace', display: 'flex', flexDirection: 'column' }}>
      <header style={{ borderBottom: '1px solid #2a2a2a', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ color: '#f97316', fontSize: '20px' }}>⚙</span>
          <span style={{ color: '#f97316', fontWeight: 'bold', fontSize: '18px', letterSpacing: '2px' }}>FORGECLAW</span>
          <span style={{ color: '#6b6b6b', fontSize: '12px' }}>forgemind local ai</span>
        </div>
      </header>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', maxWidth: '800px', margin: '0 auto', width: '100%', padding: '24px' }}>
        <div style={{ marginBottom: '24px' }}>
          <h1 style={{ fontSize: '28px', fontWeight: 'bold', marginBottom: '8px' }}>ForgeMind Chat</h1>
          <p style={{ color: '#6b6b6b', fontSize: '14px' }}>Local AI powered by Ollama</p>
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
                  }}
                >
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
