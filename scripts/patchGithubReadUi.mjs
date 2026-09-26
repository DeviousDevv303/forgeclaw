#!/usr/bin/env node
import fs from 'node:fs'

const path = 'src/App.tsx'
let app = fs.readFileSync(path, 'utf8')
const before = app
let n = 0
const once = (label, a, b) => {
  if (!app.includes(a)) { console.warn('skip', label); return }
  app = app.replace(a, b)
  n++
  console.log('ok', label)
}

once(
  'import',
  "import type { ProviderId } from './lib/modelProviders'",
  `import type { ProviderId } from './lib/modelProviders'
import { readRepoSnapshot, formatRepoSnapshotForContext, isExplicitRepoInspectRequest } from './lib/githubReadOnly'`,
)

once(
  'state',
  'const [ghTokenSaved, setGhTokenSaved] = useState(false)',
  `const [ghTokenSaved, setGhTokenSaved] = useState(false)
  const [githubReadStatus, setGithubReadStatus] = useState('')
  const [testingGithubRead, setTestingGithubRead] = useState(false)`,
)

if (!app.includes('const testGithubRead = async') && app.includes('const testLocalEndpoint = async')) {
  app = app.replace(
    'const testLocalEndpoint = async',
    `const testGithubRead = async () => {
    setTestingGithubRead(true)
    setGithubReadStatus('')
    try {
      const owner = (ghOwner || 'DeviousDevv303').trim()
      const repo = (ghRepo || 'forgeclaw').trim()
      const snap = await readRepoSnapshot(ghToken, owner, repo)
      setGithubReadStatus('OK ' + snap.owner + '/' + snap.repo + ' @ ' + snap.defaultBranch + ' HEAD ' + snap.headShaShort + ' · sample ' + snap.samplePath + ' (' + snap.sampleBytes + ' B)')
    } catch (err) {
      setGithubReadStatus(err instanceof Error ? err.message : String(err))
    } finally {
      setTestingGithubRead(false)
    }
  }

  const testLocalEndpoint = async`,
  )
  n++
  console.log('ok handler')
}

once(
  'early-inspect',
  `  const sendPrompt = useCallback(async (promptText: string, imageUrl?: string) => {
    if (!promptText.trim()) return

    const displayContent = imageUrl`,
  `  const sendPrompt = useCallback(async (promptText: string, imageUrl?: string) => {
    if (!promptText.trim()) return
    let effectivePrompt = promptText

    // Read-only GitHub inspect (explicit request only). PAT never logged.
    if ((activeProvider === 'corpus' || activeProvider === 'nexus') && ghToken.trim() && isExplicitRepoInspectRequest(promptText)) {
      try {
        const snap = await readRepoSnapshot(ghToken, (ghOwner || 'DeviousDevv303').trim(), (ghRepo || 'forgeclaw').trim())
        effectivePrompt = promptText + '\\n\\n[NEXUS_GITHUB_READ_CONTEXT]\\n' + formatRepoSnapshotForContext(snap) + '\\n[/NEXUS_GITHUB_READ_CONTEXT]'
      } catch (err) {
        effectivePrompt = promptText + '\\n\\n[NEXUS_GITHUB_READ_CONTEXT]\\nGITHUB READ FAILED: ' + (err instanceof Error ? err.message : String(err)) + '\\n[/NEXUS_GITHUB_READ_CONTEXT]'
      }
    }

    const displayContent = imageUrl`,
)

once(
  'messages',
  "const conversationMessages: AIMessage[] = [...historyMessages, { role: 'user', content: promptText }]",
  "const conversationMessages: AIMessage[] = [...historyMessages, { role: 'user', content: effectivePrompt }]",
)

once(
  'settings',
  `{ghTokenSaved ? '✓ SAVED' : 'SAVE'}\n                  </button>\n                </div>\n                <div style={{ color: '#444', fontSize: '10px', marginBottom: '10px' }}>\n                  Personal access token from github.com → Settings → Developer settings → Personal access tokens. ForgeMind uses this for autonomous GitHub operations.\n                </div>`,
  `{ghTokenSaved ? '✓ SAVED' : 'SAVE'}\n                  </button>\n                </div>\n                <button\n                  type="button"\n                  disabled={testingGithubRead || !ghToken.trim()}\n                  onClick={testGithubRead}\n                  style={{ width: '100%', marginBottom: '8px', background: testingGithubRead ? '#333' : '#1e3a5f', color: '#93c5fd', border: '1px solid #334155', borderRadius: '4px', padding: '8px', cursor: testingGithubRead || !ghToken.trim() ? 'not-allowed' : 'pointer', fontSize: '11px', fontWeight: 'bold', fontFamily: 'monospace' }}\n                >\n                  {testingGithubRead ? 'Reading repo…' : 'TEST GITHUB READ (read-only)'}\n                </button>\n                {githubReadStatus && (\n                  <div style={{ color: githubReadStatus.startsWith('OK') ? '#22c55e' : '#eab308', fontSize: '10px', fontFamily: 'monospace', marginBottom: '8px', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{githubReadStatus}</div>\n                )}\n                <div style={{ color: '#444', fontSize: '10px', marginBottom: '10px' }}>\n                  Personal access token stays in this browser only (localStorage key gh_token). Not committed. Scripts on this origin can read it (XSS risk). Prefer a fine-scoped PAT. TEST GITHUB READ verifies api.github.com without write.\n                </div>`,
)

if (app === before) {
  console.error('no patches')
  process.exit(1)
}
fs.writeFileSync(path, app)
console.log('applied', n)
