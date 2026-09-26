#!/usr/bin/env node
/**
 * Pages-only UI patch: Corpus/NEXUS Browser WebGPU labels + status indicator.
 * Applied in GitHub Actions before build. Does not touch Termux/Ollama runtime.
 */
import fs from 'node:fs'

const path = 'src/App.tsx'
let app = fs.readFileSync(path, 'utf8')
const before = app

const reps = [
  [
    `  const getStatusIndicator = () => {
    if (activeProvider === 'local') return <span style={{ color: localEndpoint ? '#6b6b6b' : '#ef4444' }}>{localEndpoint ? activeModelLabel : 'Local endpoint missing'}</span>
    const keyPresent = activeProvider === 'anthropic' ? !!anthropicApiKey : !!moonshotApiKey
    if (!keyPresent) return <span style={{ color: '#ef4444' }}>{activeProvider === 'anthropic' ? 'Anthropic: no API key' : 'Moonshot: no API key'}</span>
    return <span style={{ color: lastSource === 'cloud' ? '#3b82f6' : '#6b6b6b', fontWeight: lastSource === 'cloud' ? 'bold' : 'normal' }}>{activeModelLabel}</span>
  }`,
    `  const getStatusIndicator = () => {
    if (activeProvider === 'corpus' || activeProvider === 'nexus') {
      return <span style={{ color: '#a855f7' }}>{activeModelLabel}</span>
    }
    if (activeProvider === 'local') {
      return <span style={{ color: localEndpoint ? '#6b6b6b' : '#ef4444' }}>{localEndpoint ? activeModelLabel : 'Local endpoint missing'}</span>
    }
    if (activeProvider === 'anthropic') {
      return anthropicApiKey
        ? <span style={{ color: lastSource === 'cloud' ? '#3b82f6' : '#6b6b6b', fontWeight: lastSource === 'cloud' ? 'bold' : 'normal' }}>{activeModelLabel}</span>
        : <span style={{ color: '#ef4444' }}>Anthropic: no API key</span>
    }
    if (activeProvider === 'moonshot') {
      return moonshotApiKey
        ? <span style={{ color: lastSource === 'cloud' ? '#3b82f6' : '#6b6b6b', fontWeight: lastSource === 'cloud' ? 'bold' : 'normal' }}>{activeModelLabel}</span>
        : <span style={{ color: '#ef4444' }}>Moonshot: no API key</span>
    }
    return <span style={{ color: '#6b6b6b' }}>{activeModelLabel}</span>
  }`,
  ],
  [
    `<option value="corpus" style={{ background: '#111' }}>Corpus / NEXUS Local</option>`,
    `<option value="corpus" style={{ background: '#111' }}>Corpus / NEXUS (Browser WebGPU)</option>`,
  ],
  [
    `<option value="nexus" style={{ background: '#111' }}>NEXUS/CORPUS (Termux local)</option>`,
    `<option value="nexus" style={{ background: '#111' }}>NEXUS/CORPUS (Browser WebGPU)</option>`,
  ],
  [
    `const normalizedActiveModel = activeProvider === 'corpus' || activeProvider === 'local' ? localModel : activeProvider === 'nexus' ? DEFAULT_NEXUS_MODEL : activeProvider === 'anthropic' ? anthropicModel : moonshotModel`,
    `const normalizedActiveModel = activeProvider === 'local' ? localModel : activeProvider === 'corpus' || activeProvider === 'nexus' ? DEFAULT_NEXUS_MODEL : activeProvider === 'anthropic' ? anthropicModel : moonshotModel`,
  ],
  [
    `keyPresent: activeProvider === 'local' ? !!localEndpoint : activeProvider === 'nexus' ? !!nexusEndpoint : activeProvider === 'anthropic' ? !!anthropicApiKey : !!moonshotApiKey,`,
    `keyPresent: activeProvider === 'corpus' || activeProvider === 'nexus' ? true : activeProvider === 'local' ? !!localEndpoint : activeProvider === 'anthropic' ? !!anthropicApiKey : !!moonshotApiKey,`,
  ],
  [
    `{(activeProvider === 'corpus' || activeProvider === 'local') && (`,
    `{(activeProvider === 'local') && (`,
  ],
  [
    `['runtime provider', activeProvider === 'corpus' ? 'Corpus Local' : activeProvider === 'nexus' ? 'NEXUS/CORPUS' : activeProvider === 'local' ? 'Local Inference' : activeProvider === 'moonshot' ? 'Moonshot' : 'Anthropic'],`,
    `['runtime provider', activeProvider === 'corpus' ? 'Corpus/NEXUS WebGPU' : activeProvider === 'nexus' ? 'NEXUS WebGPU' : activeProvider === 'local' ? 'Local Inference' : activeProvider === 'moonshot' ? 'Moonshot' : 'Anthropic'],`,
  ],
  [
    `['auth state', activeProvider === 'corpus' || activeProvider === 'local' ? (localEndpoint ? 'endpoint configured' : 'missing') : activeProvider === 'nexus' ? (nexusEndpoint ? 'endpoint configured' : 'missing') : (activeProvider === 'moonshot' ? moonshotApiKey : anthropicApiKey) ? 'present' : 'missing'],`,
    `['auth state', activeProvider === 'corpus' || activeProvider === 'nexus' ? 'browser WebGPU (no endpoint)' : activeProvider === 'local' ? (localEndpoint ? 'endpoint configured' : 'missing') : (activeProvider === 'moonshot' ? moonshotApiKey : anthropicApiKey) ? 'present' : 'missing'],`,
  ],
]

let applied = 0
for (const [a, b] of reps) {
  if (app.includes(a)) {
    app = app.replace(a, b)
    applied++
  } else {
    console.warn('skip missing pattern', a.slice(0, 60).replace(/\n/g, ' '))
  }
}

const keyOld = `    const currentApiKey = activeProvider === 'corpus' || activeProvider === 'local' ? localEndpoint : activeProvider === 'nexus' ? nexusEndpoint : activeProvider === 'anthropic' ? anthropicApiKey : moonshotApiKey
    const currentProviderLabel = activeProvider === 'corpus' ? 'Corpus Local' : activeProvider === 'nexus' ? 'NEXUS/CORPUS' : activeProvider === 'local' ? 'Local inference' : activeProvider === 'anthropic' ? 'Anthropic' : 'Moonshot'
    const currentKeyFormat = activeProvider === 'corpus' || activeProvider === 'local' ? 'http://127.0.0.1:11434/v1' : activeProvider === 'nexus' ? DEFAULT_NEXUS_ENDPOINT : activeProvider === 'anthropic' ? 'sk-ant-...' : 'sk-...'

    if (!currentApiKey) {
      const missingKeyMessage = \`\${currentProviderLabel}: no API key — paste one in Settings (\${currentKeyFormat})\``
const keyNew = `    const currentApiKey = activeProvider === 'corpus' || activeProvider === 'nexus'
      ? ''
      : activeProvider === 'local'
        ? localEndpoint
        : activeProvider === 'anthropic'
          ? anthropicApiKey
          : moonshotApiKey
    const currentProviderLabel = activeProvider === 'corpus' ? 'Corpus/NEXUS WebGPU' : activeProvider === 'nexus' ? 'NEXUS WebGPU' : activeProvider === 'local' ? 'Local inference' : activeProvider === 'anthropic' ? 'Anthropic' : 'Moonshot'
    const currentKeyFormat = activeProvider === 'local' ? 'http://127.0.0.1:11434/v1' : activeProvider === 'anthropic' ? 'sk-ant-...' : 'sk-...'

    if (!currentApiKey && activeProvider !== 'corpus' && activeProvider !== 'nexus') {
      const missingKeyMessage = \`\${currentProviderLabel}: no API key — paste one in Settings (\${currentKeyFormat})\``
if (app.includes(keyOld)) {
  app = app.replace(keyOld, keyNew)
  applied++
} else console.warn('skip key gate')

const testsOld = `  const testLocalEndpoint = async () => {
    setTestingKey(true)
    setTestKeyError('')
    try {
      await testProviderKey(localEndpoint, 'local')
      setTestKeyError('Local llama.cpp endpoint is reachable')
    } catch (err) {
      setTestKeyError(err instanceof Error ? err.message : String(err))
    } finally {
      setTestingKey(false)
    }
  }

  const testNexusEndpoint = async () => {
    setTestingKey(true)
    setTestKeyError('')
    try {
      await testProviderKey(nexusEndpoint, 'nexus')
      setTestKeyError('NEXUS runtime is reachable and offline-ready')
    } catch (err) {
      setTestKeyError(err instanceof Error ? err.message : String(err))
    } finally {
      setTestingKey(false)
    }
  }`
const testsNew = `  const testLocalEndpoint = async () => {
    setTestingKey(true)
    setTestKeyError('')
    try {
      await testProviderKey(localEndpoint, 'local')
      setTestKeyError('Local llama.cpp endpoint is reachable')
    } catch (err) {
      setTestKeyError(err instanceof Error ? err.message : String(err))
    } finally {
      setTestingKey(false)
    }
  }

  const testCorpusWebGpu = async () => {
    setTestingKey(true)
    setTestKeyError('')
    try {
      await testProviderKey('', 'corpus')
      setTestKeyError('Corpus/NEXUS WebGPU is available in this browser')
    } catch (err) {
      setTestKeyError(err instanceof Error ? err.message : String(err))
    } finally {
      setTestingKey(false)
    }
  }

  const testNexusEndpoint = async () => {
    setTestingKey(true)
    setTestKeyError('')
    try {
      await testProviderKey('', 'nexus')
      setTestKeyError('NEXUS WebGPU is available in this browser')
    } catch (err) {
      setTestKeyError(err instanceof Error ? err.message : String(err))
    } finally {
      setTestingKey(false)
    }
  }`
if (app.includes(testsOld)) { app = app.replace(testsOld, testsNew); applied++ }
else console.warn('skip tests')

const nexusOld = `              {activeProvider === 'nexus' && (
                <div style={{ marginBottom: '14px' }}>
                  <label style={{ display: 'block', color: '#888', fontSize: '10px', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>NEXUS HTTP Bridge Endpoint</label>
                  <input type="url" placeholder={DEFAULT_NEXUS_ENDPOINT} value={nexusEndpoint} onChange={e => setNexusEndpoint(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', background: '#0a0a0a', color: '#ccc', border: '1px solid #222', borderRadius: '4px', padding: '8px', fontSize: '12px', fontFamily: 'monospace', outline: 'none' }} />
                  <button onClick={testNexusEndpoint} disabled={testingKey} style={{ width: '100%', marginTop: '8px', background: testingKey ? '#333' : '#22c55e', color: '#000', border: 'none', borderRadius: '4px', padding: '8px', cursor: testingKey ? 'wait' : 'pointer', fontSize: '12px', fontWeight: 'bold' }}>{testingKey ? 'Testing...' : 'TEST NEXUS RUNTIME'}</button>
                  {testKeyError && <div style={{ color: testKeyError.includes('reachable') ? '#22c55e' : '#eab308', fontSize: '10px', marginTop: '6px', fontFamily: 'monospace', wordBreak: 'break-word' }}>{testKeyError}</div>}
                  <div style={{ color: '#777', fontSize: '10px', marginTop: '6px', fontFamily: 'monospace', lineHeight: 1.5 }}>Loopback-only NEXUS text-protocol bridge at {DEFAULT_NEXUS_ENDPOINT}. Tool authority is disabled.</div>
                </div>
              )}`
const nexusNew = `              {activeProvider === 'corpus' && (
                <div style={{ marginBottom: '14px' }}>
                  <button onClick={testCorpusWebGpu} disabled={testingKey} style={{ width: '100%', marginTop: '8px', background: testingKey ? '#333' : '#a855f7', color: '#000', border: 'none', borderRadius: '4px', padding: '8px', cursor: testingKey ? 'wait' : 'pointer', fontSize: '12px', fontWeight: 'bold' }}>{testingKey ? 'Testing...' : 'TEST CORPUS WEBGPU'}</button>
                  {testKeyError && <div style={{ color: testKeyError.toLowerCase().includes('available') ? '#22c55e' : '#eab308', fontSize: '10px', marginTop: '6px', fontFamily: 'monospace', wordBreak: 'break-word' }}>{testKeyError}</div>}
                  <div style={{ color: '#777', fontSize: '10px', marginTop: '6px', fontFamily: 'monospace', lineHeight: 1.5 }}>Browser WebGPU + corpus memory. No Termux/Ollama required.</div>
                </div>
              )}
              {activeProvider === 'nexus' && (
                <div style={{ marginBottom: '14px' }}>
                  <button onClick={testNexusEndpoint} disabled={testingKey} style={{ width: '100%', marginTop: '8px', background: testingKey ? '#333' : '#a855f7', color: '#000', border: 'none', borderRadius: '4px', padding: '8px', cursor: testingKey ? 'wait' : 'pointer', fontSize: '12px', fontWeight: 'bold' }}>{testingKey ? 'Testing...' : 'TEST NEXUS WEBGPU'}</button>
                  {testKeyError && <div style={{ color: testKeyError.toLowerCase().includes('available') ? '#22c55e' : '#eab308', fontSize: '10px', marginTop: '6px', fontFamily: 'monospace', wordBreak: 'break-word' }}>{testKeyError}</div>}
                  <div style={{ color: '#777', fontSize: '10px', marginTop: '6px', fontFamily: 'monospace', lineHeight: 1.5 }}>Browser-local WebGPU/WebLLM. No Termux, Ollama, or nexusd required.</div>
                </div>
              )}`
if (app.includes(nexusOld)) { app = app.replace(nexusOld, nexusNew); applied++ }
else console.warn('skip nexus panel')

// Drop unused setter after removing endpoint input
const setterPatterns = [
  'const [nexusEndpoint, setNexusEndpoint] = useState',
  'const [nexusEndpoint, _setNexusEndpoint] = useState',
]
for (const p of setterPatterns) {
  if (app.includes(p)) {
    app = app.replaceAll(p, 'const [nexusEndpoint] = useState')
    applied++
  }
}

if (app === before) {
  console.error('No patches applied')
  process.exit(1)
}
fs.writeFileSync(path, app)
console.log('Applied', applied, 'patches; bytes', app.length)
