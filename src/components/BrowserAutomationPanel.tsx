// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). AGPL-3.0 License.
// Original work. Unauthorized commercial use prohibited. https://github.com/DeviousDevv303/forgeclaw
import { useState } from 'react'
import { useBrowserAutomation } from '../hooks/useBrowserAutomation'

export function BrowserAutomationPanel() {
  const { runAutomation, isRunning, result, error } = useBrowserAutomation()
  const [url, setUrl] = useState('https://example.com')
  const [task, setTask] = useState<'screenshot' | 'scrape' | 'test' | 'audit'>('screenshot')
  const [selector, setSelector] = useState('')

  const handleRun = async () => {
    try {
      await runAutomation({
        url,
        task,
        selector: selector || undefined,
        guardianToken: 'forge-guardian-' + 'x'.repeat(48),
      })
    } catch {
      // Error is captured in the hook's error state
    }
  }

  return (
    <div style={{ padding: '20px', color: '#ccc' }}>
      <div style={{ marginBottom: '16px' }}>
        <div style={{ color: '#f97316', fontSize: '10px', letterSpacing: '1px', marginBottom: '8px' }}>BROWSER AUTOMATION</div>
        <div style={{ color: '#555', fontSize: '10px' }}>Playwright-driven CI tasks</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="URL"
          style={{ background: '#111', border: '1px solid #222', borderRadius: '4px', color: '#ccc', padding: '8px', fontSize: '12px' }}
        />
        <select
          value={task}
          onChange={(e) => setTask(e.target.value as typeof task)}
          style={{ background: '#111', border: '1px solid #222', borderRadius: '4px', color: '#ccc', padding: '8px', fontSize: '12px' }}
        >
          <option value="screenshot">Screenshot</option>
          <option value="scrape">Scrape</option>
          <option value="test">Test</option>
          <option value="audit">Audit</option>
        </select>
        <input
          type="text"
          value={selector}
          onChange={(e) => setSelector(e.target.value)}
          placeholder="CSS selector (optional)"
          style={{ background: '#111', border: '1px solid #222', borderRadius: '4px', color: '#ccc', padding: '8px', fontSize: '12px' }}
        />
        <button
          onClick={handleRun}
          disabled={isRunning}
          style={{ background: '#f97316', color: '#000', padding: '8px 16px', borderRadius: '4px', border: 'none', fontWeight: 'bold', cursor: isRunning ? 'not-allowed' : 'pointer' }}
        >
          {isRunning ? 'Running...' : 'Run Automation'}
        </button>
      </div>

      {error && (
        <div style={{ background: '#1a0505', border: '1px solid #331111', borderRadius: '6px', padding: '10px', marginBottom: '16px' }}>
          <div style={{ color: '#ef4444', fontSize: '11px' }}>Error: {error}</div>
        </div>
      )}

      {result && (
        <div style={{ background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: '6px', padding: '10px' }}>
          <div style={{ color: '#f97316', fontSize: '9px', letterSpacing: '1px', marginBottom: '8px' }}>RESULT</div>
          <div style={{ fontSize: '11px', color: '#ccc', marginBottom: '8px' }}>
            <div>Run ID: {result.runId}</div>
            <div>Status: {result.status}</div>
            <div>Conclusion: {result.conclusion}</div>
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

          {!!result.artifact?.result && (
            <div style={{ background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: '6px', padding: '10px' }}>
              <div style={{ color: '#f97316', fontSize: '9px', letterSpacing: '1px', marginBottom: '8px' }}>DATA</div>
              <pre style={{ fontSize: '11px', color: '#ccc', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
                {typeof result.artifact.result === 'string' ? result.artifact.result : JSON.stringify(result.artifact.result, null, 2)}
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
