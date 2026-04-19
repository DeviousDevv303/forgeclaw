import { useState, useRef } from 'react'

const ACCEPTED_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf',
  'text/plain', 'text/markdown', 'text/csv',
  'application/json', 'application/typescript',
  'text/javascript', 'text/typescript', 'text/x-python',
]

const ENGINE_URL = 'http://localhost:3001'

type UploadState = 'idle' | 'uploading' | 'success' | 'error'

export function FileUpload() {
  const [file, setFile] = useState<File | null>(null)
  const [prompt, setPrompt] = useState('')
  const [result, setResult] = useState('')
  const [route, setRoute] = useState('')
  const [state, setState] = useState<UploadState>('idle')
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = (f: File) => {
    if (f.size > 5 * 1024 * 1024) {
      setError('File exceeds 5MB limit')
      return
    }
    setFile(f)
    setError('')
    setResult('')
    setRoute('')
    setState('idle')
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  const handleSubmit = async () => {
    if (!file) return
    setState('uploading')
    setError('')
    setResult('')

    const formData = new FormData()
    formData.append('file', file)
    formData.append('prompt', prompt || 'Analyze this file.')

    try {
      const res = await fetch(`${ENGINE_URL}/upload`, {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Upload failed')
        setState('error')
        return
      }
      setResult(data.result || '')
      setRoute(data.route || '')
      setState('success')
    } catch (_err) {
      setError('Engine unreachable — is ForgeMind running on port 3001?')
      setState('error')
    }
  }

  const reset = () => {
    setFile(null)
    setPrompt('')
    setResult('')
    setRoute('')
    setError('')
    setState('idle')
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div style={{
      background: '#1a1a1a',
      border: '1px solid #333',
      borderRadius: '8px',
      padding: '20px',
      marginTop: '20px',
      fontFamily: 'monospace',
    }}>
      <h3 style={{ color: '#f97316', margin: '0 0 16px 0', fontSize: '14px', letterSpacing: '0.1em' }}>
        FILE ANALYSIS
      </h3>

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${file ? '#f97316' : '#444'}`,
          borderRadius: '6px',
          padding: '24px',
          textAlign: 'center',
          cursor: 'pointer',
          color: file ? '#f97316' : '#666',
          fontSize: '13px',
          marginBottom: '12px',
          transition: 'all 0.2s',
        }}
      >
        {file ? `📎 ${file.name} (${(file.size / 1024).toFixed(1)}KB)` : 'Drop file here or click to select'}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(',')}
          style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
        />
      </div>

      {/* Prompt input */}
      <input
        type="text"
        placeholder="Analysis prompt (optional)"
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        style={{
          width: '100%',
          background: '#111',
          border: '1px solid #333',
          borderRadius: '4px',
          padding: '8px 12px',
          color: '#ccc',
          fontSize: '13px',
          marginBottom: '12px',
          boxSizing: 'border-box',
          fontFamily: 'monospace',
        }}
      />

      {/* Buttons */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <button
          onClick={handleSubmit}
          disabled={!file || state === 'uploading'}
          style={{
            background: file && state !== 'uploading' ? '#f97316' : '#333',
            color: file && state !== 'uploading' ? '#000' : '#666',
            border: 'none',
            borderRadius: '4px',
            padding: '8px 20px',
            cursor: file && state !== 'uploading' ? 'pointer' : 'not-allowed',
            fontSize: '13px',
            fontFamily: 'monospace',
            fontWeight: 'bold',
          }}
        >
          {state === 'uploading' ? 'ANALYZING...' : 'ANALYZE'}
        </button>
        {file && (
          <button
            onClick={reset}
            style={{
              background: 'transparent',
              color: '#666',
              border: '1px solid #333',
              borderRadius: '4px',
              padding: '8px 16px',
              cursor: 'pointer',
              fontSize: '13px',
              fontFamily: 'monospace',
            }}
          >
            CLEAR
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div style={{
          background: '#1f0000',
          border: '1px solid #600',
          borderRadius: '4px',
          padding: '10px 14px',
          color: '#f87171',
          fontSize: '12px',
          marginBottom: '12px',
        }}>
          ⚠ {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div>
          <div style={{ color: '#555', fontSize: '11px', marginBottom: '6px' }}>
            via {route}
          </div>
          <div style={{
            background: '#111',
            border: '1px solid #333',
            borderRadius: '4px',
            padding: '14px',
            color: '#ccc',
            fontSize: '13px',
            lineHeight: '1.6',
            whiteSpace: 'pre-wrap',
            maxHeight: '300px',
            overflowY: 'auto',
          }}>
            {result}
          </div>
        </div>
      )}
    </div>
  )
}
