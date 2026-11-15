#!/usr/bin/env node
/**
 * Pages-only UI patch: Corpus/NEXUS Browser WebGPU labels + status indicator.
 * Applied in GitHub Actions before build. Does not touch local runtime wiring.
 */
import fs from 'node:fs'

const path = 'src/App.tsx'
let app = fs.readFileSync(path, 'utf8')
const before = app
const replacements = [
  [
`  const getStatusIndicator = () => {
    if (activeProvider === 'local') return <span style={{ color: localEndpoint ? '#6b6b6b' : '#ef4444' }}>{localEndpoint ? activeModelLabel : 'Local endpoint missing'}</span>
    const keyPresent = activeProvider === 'anthropic' ? !!anthropicApiKey : activeProvider === 'nexus' ? !!nexusEndpoint : !!localEndpoint
    if (!keyPresent) return <span style={{ color: '#ef4444' }}>{activeProvider === 'anthropic' ? 'Anthropic: no API key' : 'Local endpoint missing'}</span>
    return <span style={{ color: lastSource === 'cloud' ? '#3b82f6' : '#6b6b6b', fontWeight: lastSource === 'cloud' ? 'bold' : 'normal' }}>{activeModelLabel}</span>
  }`,
`  const getStatusIndicator = () => {
    if (activeProvider === 'corpus' || activeProvider === 'nexus') {
      return <span style={{ color: '#a855f7' }}>{activeModelLabel}</span>
    }
    if (activeProvider === 'local') {
      return <span style={{ color: localEndpoint ? '#6b6b6b' : '#ef4444' }}>{localEndpoint ? activeModelLabel : 'Local endpoint missing'}</span>
    }
    return anthropicApiKey
      ? <span style={{ color: lastSource === 'cloud' ? '#3b82f6' : '#6b6b6b', fontWeight: lastSource === 'cloud' ? 'bold' : 'normal' }}>{activeModelLabel}</span>
      : <span style={{ color: '#ef4444' }}>Anthropic: no API key</span>
  }`,
  ],
  [`<option value="corpus" style={{ background: '#111' }}>Corpus / NEXUS Local</option>`, `<option value="corpus" style={{ background: '#111' }}>Corpus / NEXUS (Browser WebGPU)</option>`],
  [`<option value="nexus" style={{ background: '#111' }}>NEXUS/CORPUS (Termux local)</option>`, `<option value="nexus" style={{ background: '#111' }}>NEXUS/CORPUS (Browser WebGPU)</option>`],
  [`const normalizedActiveModel = activeProvider === 'corpus' || activeProvider === 'local' ? localModel : activeProvider === 'nexus' ? DEFAULT_NEXUS_MODEL : anthropicModel`, `const normalizedActiveModel = activeProvider === 'local' ? localModel : activeProvider === 'corpus' || activeProvider === 'nexus' ? DEFAULT_NEXUS_MODEL : anthropicModel`],
  [`keyPresent: activeProvider === 'local' ? !!localEndpoint : activeProvider === 'nexus' ? !!nexusEndpoint : activeProvider === 'anthropic' ? !!anthropicApiKey : !!localEndpoint,`, `keyPresent: activeProvider === 'corpus' || activeProvider === 'nexus' ? true : activeProvider === 'local' ? !!localEndpoint : !!anthropicApiKey,`],
  [`{(activeProvider === 'corpus' || activeProvider === 'local') && (`, `{(activeProvider === 'local') && (`],
  [`['runtime provider', activeProvider === 'corpus' ? 'Corpus Local' : activeProvider === 'nexus' ? 'NEXUS/CORPUS' : activeProvider === 'local' ? 'Local Inference' : 'Anthropic'],`, `['runtime provider', activeProvider === 'corpus' ? 'Corpus/NEXUS WebGPU' : activeProvider === 'nexus' ? 'NEXUS WebGPU' : activeProvider === 'local' ? 'Local Inference' : 'Anthropic'],`],
  [`['auth state', activeProvider === 'corpus' || activeProvider === 'local' ? (localEndpoint ? 'endpoint configured' : 'missing') : activeProvider === 'nexus' ? (nexusEndpoint ? 'endpoint configured' : 'missing') : anthropicApiKey ? 'present' : 'missing'],`, `['auth state', activeProvider === 'corpus' || activeProvider === 'nexus' ? 'browser WebGPU (no endpoint)' : activeProvider === 'local' ? (localEndpoint ? 'endpoint configured' : 'missing') : anthropicApiKey ? 'present' : 'missing'],`],
]

let applied = 0
for (const [from, to] of replacements) {
  if (app.includes(from)) {
    app = app.replace(from, to)
    applied++
  } else {
    console.warn('skip missing pattern:', from.slice(0, 70).replace(/\n/g, ' '))
  }
}

const currentRequestFrom = `    const currentApiKey = activeProvider === 'corpus' || activeProvider === 'local' ? localEndpoint : activeProvider === 'nexus' ? nexusEndpoint : anthropicApiKey
    const currentProviderLabel = activeProvider === 'corpus' ? 'Corpus Local' : activeProvider === 'nexus' ? 'NEXUS/CORPUS' : activeProvider === 'local' ? 'Local inference' : 'Anthropic'
    const currentKeyFormat = activeProvider === 'corpus' || activeProvider === 'local' ? 'http://127.0.0.1:11434/v1' : activeProvider === 'nexus' ? DEFAULT_NEXUS_ENDPOINT : 'sk-ant-...'

    if (!currentApiKey) {
      const missingKeyMessage = \`\${currentProviderLabel}: no API key — paste one in Settings (\${currentKeyFormat})\`\n`
const currentRequestTo = `    const currentApiKey = activeProvider === 'corpus' || activeProvider === 'nexus'
      ? ''
      : activeProvider === 'local'
        ? localEndpoint
        : anthropicApiKey
    const currentProviderLabel = activeProvider === 'corpus' ? 'Corpus/NEXUS WebGPU' : activeProvider === 'nexus' ? 'NEXUS WebGPU' : activeProvider === 'local' ? 'Local inference' : 'Anthropic'
    const currentKeyFormat = activeProvider === 'local' ? 'http://127.0.0.1:11434/v1' : 'sk-ant-...'

    if (!currentApiKey && activeProvider !== 'corpus' && activeProvider !== 'nexus') {
      const missingKeyMessage = \`\${currentProviderLabel}: no API key — paste one in Settings (\${currentKeyFormat})\`
`
if (app.includes(currentRequestFrom)) {
  app = app.replace(currentRequestFrom, currentRequestTo)
  applied++
} else {
  console.warn('skip current request patch')
}

const testsFrom = `  const testLocalEndpoint = async () => {
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
const testsTo = `  const testLocalEndpoint = async () => {
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
if (app.includes(testsFrom)) {
  app = app.replace(testsFrom, testsTo)
  applied++
} else console.warn('skip provider test patch')

const bridgeFrom = `              {activeProvider === 'nexus' && (
                <div style={{ marginBottom: '14px' }}>
                  <label style={{ display: 'block', color: '#888', fontSize: '10px', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>NEXUS HTTP Bridge Endpoint</label>
                  <input type="url" placeholder={DEFAULT_NEXUS_ENDPOINT} value={nexusEndpoint} onChange={e => setNexusEndpoint(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', background: '#0a0a0a', color: '#ccc', border: '1px solid #222', borderRadius: '4px', padding: '8px', fontSize: '12px', fontFamily: 'monospace', outline: 'none' }} />
                  <button onClick={testNexusEndpoint} disabled={testingKey} style={{ width: '100%', marginTop: '8px', background: testingKey ? '#333' : '#22c55e', color: '#000', border: 'none', borderRadius: '4px', padding: '8px', cursor: testingKey ? 'wait' : 'pointer', fontSize: '12px', fontWeight: 'bold' }}>{testingKey ? 'Testing...' : 'TEST NEXUS RUNTIME'}</button>
                  {testKeyError && <div style={{ color: testKeyError.includes('reachable') ? '#22c55e' : '#eab308', fontSize: '10px', marginTop: '6px', fontFamily: 'monospace', wordBreak: 'break-word' }}>{testKeyError}</div>}
                  <div style={{ color: '#777', fontSize: '10px', marginTop: '6px', fontFamily: 'monospace', lineHeight: 1.5 }}>Loopback-only NEXUS text-protocol bridge at {DEFAULT_NEXUS_ENDPOINT}. Tool authority is disabled.</div>
                </div>
              )}`
const bridgeTo = `              {activeProvider === 'corpus' && (
                <div style={{ marginBottom: '14px' }}>
                  <button onClick={testCorpusWebGpu} disabled={testingKey} style={{ width: '100%', marginTop: '8px', background: testingKey ? '#333' : '#a855f7', color: '#000', border: 'none', borderRadius: '4px', padding: '8px', cursor: testingKey ? 'wait' : 'pointer', fontSize: '12px', fontWeight: 'bold' }}>{testingKey ? 'Testing...' : 'TEST CORPUS WEBGPU'}</button>
                  {testKeyError && <div style={{ color: testKeyError.toLowerCase().includes('available') ? '#22c55e' : '#eab308', fontSize: '10px', marginTop: '6px', fontFamily: 'monospace', wordBreak: 'break-word' }}>{testKeyError}</div>}
                  <div style={{ color: '#777', fontSize: '10px', marginTop: '6px', fontFamily: 'monospace', lineHeight: 1.5 }}>Browser WebGPU + corpus memory. No local server required.</div>
                </div>
              )}
              {activeProvider === 'nexus' && (
                <div style={{ marginBottom: '14px' }}>
                  <button onClick={testNexusEndpoint} disabled={testingKey} style={{ width: '100%', marginTop: '8px', background: testingKey ? '#333' : '#a855f7', color: '#000', border: 'none', borderRadius: '4px', padding: '8px', cursor: testingKey ? 'wait' : 'pointer', fontSize: '12px', fontWeight: 'bold' }}>{testingKey ? 'Testing...' : 'TEST NEXUS WEBGPU'}</button>
                  {testKeyError && <div style={{ color: testKeyError.toLowerCase().includes('available') ? '#22c55e' : '#eab308', fontSize: '10px', marginTop: '6px', fontFamily: 'monospace', wordBreak: 'break-word' }}>{testKeyError}</div>}
                  <div style={{ color: '#777', fontSize: '10px', marginTop: '6px', fontFamily: 'monospace', lineHeight: 1.5 }}>Browser-local WebGPU/WebLLM. No local server required.</div>
                </div>
              )}`
if (app.includes(bridgeFrom)) {
  app = app.replace(bridgeFrom, bridgeTo)
  applied++
} else console.warn('skip WebGPU panel patch')

for (const from of [
  'const [nexusEndpoint, setNexusEndpoint] = useState',
  'const [nexusEndpoint, _setNexusEndpoint] = useState',
]) {
  if (app.includes(from)) {
    app = app.replace(from, 'const [nexusEndpoint] = useState')
    applied++
  }
}

if (app === before) {
  console.error('No Pages patches applied')
  process.exit(1)
}
fs.writeFileSync(path, app)
console.log('Applied', applied, 'Pages patches; bytes', app.length)
