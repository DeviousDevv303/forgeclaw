import { useState } from 'react'
import { useBrowserAutomation } from '../hooks/useBrowserAutomation'

export function BrowserAutomationPanel() {
  const { runAutomation, isRunning, result, error } = useBrowserAutomation()
  const [url, setUrl] = useState('https://example.com')
  const [task, setTask] = useState<'screenshot' | 'scrape' | 'test' | 'audit'>('screenshot')
  const [selector, setSelector] = useState('')
  const [guardianToken, setGuardianToken] = useState('')
  const [runError, setRunError] = useState<string | null>(null)

  const handleRun = async () => {
    setRunError(null)
    try {
      await runAutomation({ url, task, selector: selector || undefined, guardianToken })
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px', minHeight: 0 }}>
      <div style={{ marginBottom: '4px' }}>
        <span style={{ color: '#f97316', fontSize: '10px', letterSpacing: '1px' }}>BROWSER AUTOMATION</span>
        <span style={{ color: '#555', fontSize: '10px', marginLeft: '8px' }}>Screenshot · Scrape · Test · Audit</span>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: '6px', padding: '12px' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://example.com"
            style={{ flex: 2, background: '#111', border: '1px solid #222', borderRadius: '4px', color: '#ccc', padding: '6px 8px', fontSize: '11px', fontFamily: 'monospace', outline: 'none' }}
          />
          <select
            value={task}
            onChange={e => setTask(e.target.value as any)}
            style={{ flex: 1, background: '#111', border: '1px solid #222', borderRadius: '4px', color: '#f97316', padding: '6px 8px', fontSize: '11px', fontFamily: 'monospace', outline: 'none' }}
          >
            <option value="screenshot">screenshot</option>
            <option value="scrape">scrape</option>
            <option value="test">test</option>
            <option value="audit">audit</option>
          </select>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            value={selector}
            onChange={e => setSelector(e.target.value)}
            placeholder="CSS selector (optional, e.g. #content)"
            style={{ flex: 1, background: '#111', border: '1px solid #222', borderRadius: '4px', color: '#ccc', padding: '6px 8px', fontSize: '11px', fontFamily: 'monospace', outline: 'none' }}
          />
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            value={guardianToken}
            onChange={e => setGuardianToken(e.target.value)}
            placeholder="Guardian token (forge-guardian-...)"
            type="password"
            style={{ flex: 1, background: '#111', border: '1px solid #222', borderRadius: '4px', color: '#ccc', padding: '6px 8px', fontSize: '11px', fontFamily: 'monospace', outline: 'none' }}
          />
          <button
            onClick={handleRun}
            disabled={isRunning || !url || !guardianToken}
            style={{
              background: isRunning ? '#333' : '#f97316',
              color: '#000',
              border: 'none',
              borderRadius: '4px',
              padding: '6px 16px',
              cursor: isRunning ? 'wait' : 'pointer',
              fontSize: '11px',
              fontWeight: 'bold',
              fontFamily: 'monospace',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            }}
          >
            {isRunning ? 'RUNNING...' : 'RUN'}
          </button>
        </div>

        {(error || runError) && (
          <div style={{ color: '#ef4444', fontSize: '11px', fontFamily: 'monospace' }}>
            [ERROR]: {error || runError}
          </div>
        )}
      </div>

      {/* Results */}
      {result && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto', minHeight: 0 }}>
          <div style={{ background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: '6px', padding: '10px' }}>
            <div style={{ color: '#f97316', fontSize: '9px', letterSpacing: '1px', marginBottom: '8px' }}>RESULT</div>
            <div style={{ fontSize: '11px', color: '#ccc', fontFamily: 'monospace' }}>
              <div>Run ID: {result.runId}</div>
              <div>Status: {result.status}</div>
              <div>Conclusion: {result.conclusion}</div>
            </div>
          </div>

          {result.artifact?.screenshot && (
            <div style={{ background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: '6px', padding: '10px' }}>
              <div style={{ color: '#f97316', fontSize: '9px', letterSpacing: '1px', marginBottom: '8px' }}>SCREENSHOT</div>
              <img
                src={`data:image/png;base64,${result.artifact.screenshot}`}
                alt="Screenshot"
                style={{ maxWidth: '100%', borderRadius: '4px', border: '1px solid #222' }}
              />
            </div>
          )}

          {result.artifact?.result && (
            <div style={{ background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: '6px', padding: '10px' }}>
              <div style={{ color: '#f97316', fontSize: '9px', letterSpacing: '1px', marginBottom: '8px' }}>DATA</div>
              <pre style={{ fontSize: '11px', color: '#ccc', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
                {JSON.stringify(result.artifact.result, null, 2)}
              </pre>
            </div>
          )}

          {result.artifact?.logs && (
            <div style={{ background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: '6px', padding: '10px' }}>
              <div style={{ color: '#f97316', fontSize: '9px', letterSpacing: '1px', marginBottom: '8px' }}>LOGS</div>
              <pre style={{ fontSize: '10px', color: '#888', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0, maxHeight: '200px', overflowY: 'auto' }}>
                {result.artifact.logs}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
