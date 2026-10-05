#!/usr/bin/env node
// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
//
// MANUS — GitHub Pages read-only GitHub UI patch (idempotent).
//
// WHY this step had to change:
// It adds the read-only GitHub credential probe that the Pages build ships. It
// previously detected an already-applied patch by looking for a *neighbouring*
// anchor string, so running it against an already-patched file appended a second
// copy of the additions. That produced duplicate identifiers (`TS2300`) in the
// deployed build, and the step still exited 0 — it failed open.
//
// Each patch now declares its own applied-marker. A patch is applied only when
// its marker is genuinely absent, and the result is verified to contain exactly
// one copy. A genuinely missing anchor is now a hard failure instead of a skip,
// so a future refactor of App.tsx cannot silently ship a Pages build without the
// read-only probe.
import fs from 'node:fs'

const path = 'src/App.tsx'
let app = fs.readFileSync(path, 'utf8')
const before = app

/**
 * Apply one patch.
 * - `marker` proves the patch is already present (idempotent re-run).
 * - `anchor` is the unique existing text to extend.
 * - `replacement` must contain the anchor plus the addition.
 */
function patch({ label, marker, anchor, replacement }) {
  if (app.includes(marker)) {
    console.log(`ok      ${label} (already applied)`)
    return true
  }
  const occurrences = app.split(anchor).length - 1
  if (occurrences === 0) {
    console.error(`FAIL    ${label} — anchor not found: ${JSON.stringify(anchor.slice(0, 70))}`)
    return false
  }
  if (occurrences > 1) {
    console.error(`FAIL    ${label} — anchor is not unique (${occurrences} matches)`)
    return false
  }
  app = app.replace(anchor, replacement)
  console.log(`applied ${label}`)
  return true
}

const results = []

// 1. Read-only repository probe import.
results.push(patch({
  label: 'read-only probe import',
  marker: "import { readRepoSnapshot } from './lib/githubReadOnly'",
  anchor: "import type { ProviderId } from './lib/modelProviders'",
  replacement: `import type { ProviderId } from './lib/modelProviders'
import { readRepoSnapshot } from './lib/githubReadOnly'`,
}))

// 2. Probe state.
results.push(patch({
  label: 'read-only probe state',
  marker: 'const [githubReadStatus, setGithubReadStatus] = useState(\'\')',
  anchor: 'const [ghTokenSaved, setGhTokenSaved] = useState(false)',
  replacement: `const [ghTokenSaved, setGhTokenSaved] = useState(false)
  const [githubReadStatus, setGithubReadStatus] = useState('')
  const [testingGithubRead, setTestingGithubRead] = useState(false)`,
}))

// 3. Probe handler, placed beside the existing local-endpoint test.
results.push(patch({
  label: 'read-only probe handler',
  marker: 'const testGithubRead = async',
  anchor: '  const testLocalEndpoint = async () => {',
  replacement: `  const testGithubRead = async () => {
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

  const testLocalEndpoint = async () => {`,
}))

// 4. Probe button. Insert before the stable repository-owner control rather
// than matching user-facing token help, which may legitimately change.
results.push(patch({
  label: 'read-only probe button',
  marker: 'TEST GITHUB READ (read-only)',
  anchor: `                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div>
                    <label style={{ display: 'block', color: '#666', fontSize: '10px', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Default Owner / Org</label>`,
  replacement: `                <button
                  type="button"
                  disabled={testingGithubRead || !ghToken.trim()}
                  onClick={testGithubRead}
                  style={{ width: '100%', marginBottom: '8px', background: testingGithubRead ? '#333' : '#1e3a5f', color: '#93c5fd', border: '1px solid #334155', borderRadius: '4px', padding: '8px', cursor: testingGithubRead || !ghToken.trim() ? 'not-allowed' : 'pointer', fontSize: '11px', fontWeight: 'bold', fontFamily: 'monospace' }}
                >
                  {testingGithubRead ? 'Reading repo…' : 'TEST GITHUB READ (read-only)'}
                </button>
                {githubReadStatus && (
                  <div style={{ color: githubReadStatus.startsWith('OK') ? '#22c55e' : '#eab308', fontSize: '10px', fontFamily: 'monospace', marginBottom: '8px', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{githubReadStatus}</div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div>
                    <label style={{ display: 'block', color: '#666', fontSize: '10px', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Default Owner / Org</label>`,
}))

// ── Result integrity ─────────────────────────────────────────────────────────
// Guard the defect class directly: no addition may appear more than once.
const uniqueness = [
  ['probe import', /from '\.\/lib\/githubReadOnly'/g, 1],
  ['probe state', /const \[githubReadStatus, setGithubReadStatus\]/g, 1],
  ['probe handler', /const testGithubRead = async/g, 1],
  ['probe button', /TEST GITHUB READ \(read-only\)/g, 1],
]
for (const [label, pattern, expected] of uniqueness) {
  const found = (app.match(pattern) || []).length
  if (found !== expected) {
    console.error(`FAIL    ${label} appears ${found} time(s), expected ${expected}`)
    results.push(false)
  }
}

if (!results.every(Boolean)) {
  console.error('Pages patch failed — refusing to write a partial or duplicated source.')
  process.exit(1)
}

if (app === before) {
  console.log('Pages read-only GitHub UI already present — source unmodified.')
  process.exit(0)
}

fs.writeFileSync(path, app)
console.log('Pages read-only GitHub UI patch applied.')
