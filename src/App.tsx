import { useState, useRef, useEffect, useCallback } from 'react'
import { FileUploadButton } from './components/FileUploadButton'
import { NeuralNetworkBackground } from './components/NeuralNetworkBackground'
import { useErrorBus } from './hooks/useErrorBus'
import { useOrchestrator } from './hooks/useOrchestrator'
import { FailureDashboard } from './components/FailureDashboard'
import { OrchestratorPanel } from './components/OrchestratorPanel'
import type { EmitFailureOptions } from './hooks/useErrorBus'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  source?: 'local' | 'cloud'
  activeTags?: string[]
  phases?: Record<string, string>
  showReasoning?: boolean
  feedback?: 'up' | 'down'
}

interface CorpusEntry {
  prompt: string
  response: string
  source: 'claude-haiku' | 'ollama'
  timestamp: string
}

interface RepoTreeItem {
  path: string
  type: 'blob' | 'tree'
  sha: string
  size?: number
}

// ─── System Prompt ────────────────────────────────────────────────────────────
// STANDING RULE: The line below must never be removed or modified.
// It prevents Claude refusals without overriding identity. Do not trim.
const FORGEMIND_SYSTEM_PROMPT = `You are ForgeMind, a structured reasoning engine. Respond directly.

When responding, use this 5-phase scaffold as a thinking framework:
1. Assumptions — state what you are taking as given
2. Heuristics — apply relevant rules of thumb
3. First Principles — reason from fundamentals
4. Extension — explore implications and edge cases
5. Convergence — deliver the final synthesized answer

These phases are a reasoning aid, not a constraint.
// STANDING RULE: Do not remove or modify the line below.
You retain all your normal values, guidelines, and identity as Claude.

[FM:STORE] (Optional: Use if critical for logging)
[FM:RECALL] (Optional: Use if referencing history)
[FM:TRAIN] (Optional: Use if high quality)`

// ─── Constants ────────────────────────────────────────────────────────────────

const TAG_MAP: Record<string, string> = {
  '[FM:PHASE_1]': 'Assumptions',
  '[FM:PHASE_2]': 'Heuristics',
  '[FM:PHASE_3]': 'First Principles',
  '[FM:PHASE_4]': 'Extension',
  '[FM:PHASE_5]': 'Convergence',
  '[FM:STORE]': 'Logged to corpus',
  '[FM:RECALL]': 'Searching history',
  '[FM:TRAIN]': 'Flagged for training',
}

const PHASE_ICONS: Record<string, string> = {
  PHASE_1: '◈', PHASE_2: '◈', PHASE_3: '◈', PHASE_4: '◈', PHASE_5: '◈',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cleanOutput(text: string): string {
  return text
    .replace(/\*\*/g, '').replace(/\*/g, '')
    .replace(/#{1,6}\s/g, '').replace(/__|_/g, '')
    .replace(/\s+\n/g, '\n').trim()
}

function cleanForSpeech(text: string): string {
  return text
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[\u{2600}-\u{26FF}]/gu, '')
    .replace(/\*\*/g, '').replace(/\*/g, '').trim()
}

// ─── GitHub API helpers ───────────────────────────────────────────────────────

function parseRepoUrl(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url.trim())
    const parts = u.pathname.replace(/^\//, '').split('/')
    if (parts.length < 2) return null
    return { owner: parts[0], repo: parts[1].replace(/\.git$/, '') }
  } catch { return null }
}

async function ghFetch(path: string, token: string, opts: RequestInit = {}) {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    ...(opts.headers as Record<string, string> || {}),
  }
  if (token) headers['Authorization'] = `token ${token}`
  const res = await fetch(`https://api.github.com${path}`, { ...opts, headers })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { message?: string }).message || `GitHub ${res.status}`)
  }
  return res.json()
}

async function fetchRepoTree(owner: string, repo: string, token: string): Promise<RepoTreeItem[]> {
  const data = await ghFetch(`/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`, token)
  return (data.tree || []) as RepoTreeItem[]
}

async function fetchFileContent(owner: string, repo: string, path: string, token: string): Promise<{ content: string; sha: string }> {
  const data = await ghFetch(`/repos/${owner}/${repo}/contents/${path}`, token)
  const decoded = atob((data.content as string).replace(/\n/g, ''))
  return { content: decoded, sha: data.sha as string }
}

async function pushFile(owner: string, repo: string, path: string, content: string, message: string, sha: string | undefined, token: string): Promise<void> {
  const encoded = btoa(unescape(encodeURIComponent(content)))
  const body: Record<string, string> = { message, content: encoded }
  if (sha) body.sha = sha
  await ghFetch(`/repos/${owner}/${repo}/contents/${path}`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function triggerWorkflow(owner: string, repo: string, workflowId: string, ref: string, token: string): Promise<void> {
  await ghFetch(`/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref }),
  })
}

// ─── RepoAnalyzer Component ───────────────────────────────────────────────────

interface RepoAnalyzerProps {
  apiKey: string
  onAnalyze: (prompt: string) => void
  analyzing: boolean
  emitFailure: (opts: EmitFailureOptions) => string
}

function RepoAnalyzer({ apiKey, onAnalyze, analyzing, emitFailure }: RepoAnalyzerProps) {
  const [repoUrl, setRepoUrl] = useState('https://github.com/DeviousDevv303/forgeclaw')
  const [ghToken, setGhToken] = useState(() => localStorage.getItem('gh_token') || '')
  const [tree, setTree] = useState<RepoTreeItem[]>([])
  const [loadingTree, setLoadingTree] = useState(false)
  const [treeError, setTreeError] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string>('')
  const [fileSha, setFileSha] = useState<string>('')
  const [loadingFile, setLoadingFile] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [commitMsg, setCommitMsg] = useState('')
  const [pushing, setPushing] = useState(false)
  const [pushStatus, setPushStatus] = useState<string | null>(null)
  const [workflowId, setWorkflowId] = useState('')
  const [workflowRef, setWorkflowRef] = useState('main')
  const [dispatching, setDispatching] = useState(false)
  const [dispatchStatus, setDispatchStatus] = useState<string | null>(null)
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')

  useEffect(() => { localStorage.setItem('gh_token', ghToken) }, [ghToken])

  const parsed = parseRepoUrl(repoUrl)

  const loadTree = async () => {
    if (!parsed) { setTreeError('Invalid GitHub repo URL'); return }
    setLoadingTree(true); setTreeError(null); setTree([]); setSelectedFile(null); setFileContent('')
    try {
      const items = await fetchRepoTree(parsed.owner, parsed.repo, ghToken)
      setTree(items)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load tree'
      setTreeError(msg)
      emitFailure({ source: 'github', severity: 'error', message: `Tree load failed: ${msg}`, context: { repo: repoUrl } })
    } finally { setLoadingTree(false) }
  }

  const loadFile = async (path: string) => {
    if (!parsed) return
    setLoadingFile(true); setSelectedFile(path); setFileContent(''); setEditMode(false); setPushStatus(null)
    try {
      const { content, sha } = await fetchFileContent(parsed.owner, parsed.repo, path, ghToken)
      setFileContent(content); setFileSha(sha); setEditContent(content)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error loading file'
      setFileContent(msg)
      emitFailure({ source: 'github', severity: 'error', message: `File fetch failed: ${msg}`, context: { path } })
    } finally { setLoadingFile(false) }
  }

  // STANDING RULE: Do not touch push/dispatch logic below
  const handlePush = async () => {
    if (!parsed || !selectedFile || !commitMsg) return
    setPushing(true); setPushStatus(null)
    try {
      await pushFile(parsed.owner, parsed.repo, selectedFile, editContent, commitMsg, fileSha || undefined, ghToken)
      setPushStatus('✓ Pushed successfully')
      setFileContent(editContent); setEditMode(false)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Push failed'
      setPushStatus(`✗ ${msg}`)
      emitFailure({ source: 'github', severity: 'error', message: `Push failed: ${msg}`, context: { path: selectedFile } })
    } finally { setPushing(false) }
  }

  const handleDispatch = async () => {
    if (!parsed || !workflowId) return
    setDispatching(true); setDispatchStatus(null)
    try {
      await triggerWorkflow(parsed.owner, parsed.repo, workflowId, workflowRef, ghToken)
      setDispatchStatus('✓ Workflow dispatched')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Dispatch failed'
      setDispatchStatus(`✗ ${msg}`)
      emitFailure({ source: 'github', severity: 'error', message: `Workflow dispatch failed: ${msg}`, context: { workflowId, ref: workflowRef } })
    } finally { setDispatching(false) }
  }

  const handleAnalyze = () => {
    if (!fileContent || !selectedFile) return
    const prompt = `Analyze this file from ${repoUrl}:\n\nFile: ${selectedFile}\n\`\`\`\n${fileContent.slice(0, 6000)}\n\`\`\`\n\nProvide a thorough code review using the ForgeMind reasoning scaffold.`
    onAnalyze(prompt)
  }

  const toggleDir = (dir: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev)
      if (next.has(dir)) next.delete(dir); else next.add(dir)
      return next
    })
  }

  const filteredTree = filter
    ? tree.filter(i => i.path.toLowerCase().includes(filter.toLowerCase()))
    : tree

  const visibleItems = filteredTree.filter(item => {
    if (filter) return true
    const parts = item.path.split('/')
    if (parts.length === 1) return true
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join('/')
      if (!expandedDirs.has(parent)) return false
    }
    return true
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', height: '100%' }}>
      <div style={{ display: 'flex', gap: '8px' }}>
        <input value={repoUrl} onChange={e => setRepoUrl(e.target.value)} placeholder="https://github.com/owner/repo" style={inputStyle} onKeyDown={e => e.key === 'Enter' && loadTree()} />
        <input value={ghToken} onChange={e => setGhToken(e.target.value)} placeholder="GitHub token (optional for public)" type="password" style={{ ...inputStyle, maxWidth: '200px' }} />
        <button onClick={loadTree} disabled={loadingTree || !repoUrl} style={repoBtn}>{loadingTree ? '...' : 'LOAD'}</button>
      </div>
      {treeError && <div style={{ color: '#f97316', fontSize: '11px' }}>[ERROR]: {treeError}</div>}
      {tree.length > 0 && (
        <div style={{ display: 'flex', gap: '10px', flex: 1, minHeight: 0 }}>
          <div style={{ width: '240px', flexShrink: 0, background: '#0f0f0f', border: '1px solid #222', borderRadius: '6px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '6px 8px', borderBottom: '1px solid #1a1a1a', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: '#f97316', fontSize: '9px', letterSpacing: '1px' }}>FILE TREE</span>
              <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="filter..." style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#ccc', fontSize: '10px', fontFamily: 'monospace' }} />
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
              {visibleItems.map(item => {
                const depth = item.path.split('/').length - 1
                const name = item.path.split('/').pop() || item.path
                const isDir = item.type === 'tree'
                const isOpen = expandedDirs.has(item.path)
                const isSelected = selectedFile === item.path
                return (
                  <div key={item.path} onClick={() => isDir ? toggleDir(item.path) : loadFile(item.path)} style={{ padding: `3px 8px 3px ${8 + depth * 12}px`, cursor: 'pointer', fontSize: '11px', color: isSelected ? '#f97316' : isDir ? '#888' : '#ccc', background: isSelected ? '#1a1a1a' : 'transparent', display: 'flex', alignItems: 'center', gap: '5px', userSelect: 'none' }}>
                    <span style={{ fontSize: '9px', opacity: 0.6 }}>{isDir ? (isOpen ? '▾' : '▸') : '·'}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                  </div>
                )
              })}
            </div>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
            {selectedFile ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ color: '#f97316', fontSize: '10px', letterSpacing: '0.5px' }}>{selectedFile}</span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <button onClick={handleAnalyze} disabled={!fileContent || analyzing || !apiKey} style={{ ...repoBtn, background: '#f97316', color: '#000' }}>{analyzing ? 'ANALYZING...' : '⚡ ANALYZE'}</button>
                    <button onClick={() => setEditMode(!editMode)} style={repoBtn}>{editMode ? 'VIEW' : 'EDIT'}</button>
                  </div>
                </div>
                {loadingFile ? (
                  <div style={{ color: '#f97316', fontSize: '11px' }}>Loading...</div>
                ) : editMode ? (
                  <>
                    <textarea value={editContent} onChange={e => setEditContent(e.target.value)} style={{ flex: 1, background: '#0f0f0f', color: '#e5e5e5', border: '1px solid #333', borderRadius: '4px', padding: '10px', fontSize: '12px', fontFamily: 'monospace', resize: 'none', minHeight: '200px' }} />
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <input value={commitMsg} onChange={e => setCommitMsg(e.target.value)} placeholder="Commit message..." style={{ ...inputStyle, flex: 1 }} />
                      <button onClick={handlePush} disabled={pushing || !commitMsg || !ghToken} style={{ ...repoBtn, background: '#22c55e', color: '#000' }}>{pushing ? 'PUSHING...' : 'PUSH'}</button>
                    </div>
                    {pushStatus && <div style={{ fontSize: '11px', color: pushStatus.startsWith('✓') ? '#22c55e' : '#f97316' }}>{pushStatus}</div>}
                  </>
                ) : (
                  <pre style={{ flex: 1, background: '#0f0f0f', color: '#ccc', border: '1px solid #1a1a1a', borderRadius: '4px', padding: '10px', fontSize: '11px', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0, minHeight: '200px' }}>{fileContent || '(empty file)'}</pre>
                )}
              </>
            ) : (
              <div style={{ color: '#444', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>Select a file from the tree</div>
            )}
            <div style={{ background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: '6px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ color: '#f97316', fontSize: '9px', letterSpacing: '1px' }}>ACTIONS DISPATCH</span>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <input value={workflowId} onChange={e => setWorkflowId(e.target.value)} placeholder="workflow file or ID (e.g. deploy.yml)" style={{ ...inputStyle, flex: 2 }} />
                <input value={workflowRef} onChange={e => setWorkflowRef(e.target.value)} placeholder="ref (e.g. main)" style={{ ...inputStyle, flex: 1, maxWidth: '100px' }} />
                <button onClick={handleDispatch} disabled={dispatching || !workflowId || !ghToken} style={repoBtn}>{dispatching ? '...' : 'DISPATCH'}</button>
              </div>
              {dispatchStatus && <div style={{ fontSize: '11px', color: dispatchStatus.startsWith('✓') ? '#22c55e' : '#f97316' }}>{dispatchStatus}</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────

type Tab = 'forgemind' | 'repoagent' | 'failures' | 'orchestrator'

function App() {
  const { ledger, emitFailure, resolveFailure, clearResolved, unresolvedCount } = useErrorBus()
  const { taskQueue, events: orchEvents, admitTask, resolveTask, contracts } = useOrchestrator({ emitFailure })

  const [activeTab, setActiveTab] = useState<Tab>('forgemind')
  const [messages, setMessages] = useState<Message[]>(() => {
    const saved = localStorage.getItem('forgemind_history')
    return saved ? JSON.parse(saved) : []
  })
  const [input, setInput] = useState('')
  const [attachedFile, setAttachedFile] = useState<{ name: string; content: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [apiKeyStatus, setApiKeyStatus] = useState<'none' | 'unverified' | 'valid' | 'invalid'>('none')
  const [testingKey, setTestingKey] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [apiKey, setApiKey] = useState(() => import.meta.env.VITE_ANTHROPIC_API_KEY || localStorage.getItem('fm_api_key') || '')
  const [corpus, setCorpus] = useState<CorpusEntry[]>(() => {
    const saved = localStorage.getItem('forgemind_corpus')
    return saved ? JSON.parse(saved) : []
  })
  const [lastSource, setLastSource] = useState<'local' | 'cloud' | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [selectedLanguage, setSelectedLanguage] = useState<string>('en')
  const [rate] = useState<number>(1.0)
  const [openReasoningIds, setOpenReasoningIds] = useState<Set<string>>(new Set())
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const LANGUAGE_NAMES: Record<string, string> = {
    en: 'English',
    es: 'Español',
    ru: 'Русский',
    zh: '中文'
  }

  const getVoiceForLanguage = (lang: string): SpeechSynthesisVoice | null => {
    const langVoices = voices.filter(v => v.lang.toLowerCase().startsWith(lang))
    const defaultVoice = langVoices.find(v => v.default)
    return defaultVoice || langVoices[0] || null
  }

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })

  useEffect(() => { scrollToBottom() }, [messages])
  useEffect(() => { localStorage.setItem('forgemind_history', JSON.stringify(messages)) }, [messages])
  useEffect(() => { localStorage.setItem('forgemind_corpus', JSON.stringify(corpus)) }, [corpus])
  useEffect(() => { localStorage.setItem('fm_api_key', apiKey) }, [apiKey])

  useEffect(() => {
    const loadVoices = () => {
      const allVoices = window.speechSynthesis.getVoices()
      // Filter to English, Spanish, Russian, Chinese only
      const allowedLangs = ['en', 'es', 'ru', 'zh']
      const filtered = allVoices.filter(v => {
        const langPrefix = v.lang.split('-')[0].toLowerCase()
        return allowedLangs.includes(langPrefix)
      })
      setVoices(filtered)
    }
    loadVoices()
    window.speechSynthesis.onvoiceschanged = loadVoices
  }, [])

  const logToCorpus = (prompt: string, response: string, source: 'claude-haiku' | 'ollama') => {
    setCorpus(prev => [...prev, { prompt, response, source, timestamp: new Date().toISOString() }])
  }

  const parseAndExecuteTags = (text: string, prompt: string, source: 'claude-haiku' | 'ollama') => {
    const tagsFound: string[] = []
    const phases: Record<string, string> = {}
    let finalContent = ''
    const phaseRegex = /\[FM:PHASE_([1-5])\]([\s\S]*?)(?=\[FM:PHASE_|$|\[FM:STORE|\[FM:RECALL|\[FM:TRAIN)/g
    let match
    while ((match = phaseRegex.exec(text)) !== null) {
      const num = match[1]; const content = match[2].trim()
      phases[`PHASE_${num}`] = content
      tagsFound.push(`[FM:PHASE_${num}]`)
      if (num === '5') finalContent = content
    }
    if (!phases['PHASE_5']) finalContent = text
    ;['[FM:STORE]', '[FM:RECALL]', '[FM:TRAIN]'].forEach(tag => {
      if (text.includes(tag)) {
        tagsFound.push(tag)
        if (tag === '[FM:STORE]') logToCorpus(prompt, finalContent, source)
      }
    })
    return { cleanText: cleanOutput(finalContent), tagsFound, phases }
  }

  const sendPrompt = useCallback(async (promptText: string) => {
    if (!promptText.trim()) return
    if (!apiKey) {
      emitFailure({ source: 'forgemind', severity: 'warning', message: 'Claude API key required. Enter your key to continue.' })
      return
    }

    // Orchestrator: admit forgemind chat task
    const taskId = `fm-${Date.now()}`
    const admitted = admitTask({
      taskId,
      agentId: 'forgemind',
      intent: 'chat',
      payload: { promptLength: promptText.length },
      timeout: 30000,
      requestedScopes: ['llm:generate', 'corpus:write', 'errorBus:emit'],
    })
    if (!admitted) {
      emitFailure({ source: 'forgemind', severity: 'warning', message: 'Orchestrator blocked this task. Check the Orchestrator tab.', context: { taskId } })
      return
    }

    const userMessage: Message = { id: Date.now().toString(), role: 'user', content: promptText, timestamp: Date.now() }
    setMessages(prev => [...prev, userMessage])
    setLoading(true)

    let responseText = ''; let source: 'local' | 'cloud' = 'cloud'
    try {
      let ollamaOk = false
      try {
        const r = await fetch('http://localhost:11434/api/generate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'qwen2.5:1.8b', system: FORGEMIND_SYSTEM_PROMPT, prompt: promptText, stream: false }),
          signal: AbortSignal.timeout(1500),
        })
        if (r.ok) {
          const d = await r.json(); responseText = d.response || ''; source = 'local'; setLastSource('local'); ollamaOk = true
        }
      } catch { /* fall through to cloud */ }

      if (!ollamaOk) {
        // Build conversation history (last 10 messages to avoid token overflow)
        const historyMessages = messages
          .slice(-10)
          .map(m => ({ role: m.role, content: m.content }))
        
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
          body: JSON.stringify({ 
            model: 'claude-haiku-4-5-20251001', 
            max_tokens: 2048, 
            system: FORGEMIND_SYSTEM_PROMPT, 
            messages: [...historyMessages, { role: 'user', content: promptText }]
          }),
        })
        if (!r.ok) {
          const e = await r.json().catch(() => ({}))
          throw new Error((e as { error?: { message?: string } }).error?.message || `Claude API ${r.status}`)
        }
        const d = await r.json(); responseText = d.content[0]?.text || ''; source = 'cloud'; setLastSource('cloud')
      }

      const { cleanText, tagsFound, phases } = parseAndExecuteTags(responseText, promptText, source === 'local' ? 'ollama' : 'claude-haiku')
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'assistant', content: cleanText, timestamp: Date.now(), source, activeTags: tagsFound, phases, showReasoning: false }])
      resolveTask(taskId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      emitFailure({
        source: source === 'local' ? 'ollama' : 'claude',
        severity: 'error',
        message: msg,
        context: { promptLength: promptText.length },
      })
      // Show error in chat so user sees what happened
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `[ERROR]: ${msg}`,
        timestamp: Date.now(),
        source,
      }])
    } finally { setLoading(false) }
  }, [apiKey, emitFailure, admitTask, resolveTask]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSendMessage = async () => {
    if (!input.trim() && !attachedFile) return
    
    let promptText = input
    if (attachedFile) {
      // Guard against oversized file content
      const maxFileSize = 50000 // ~50KB of text
      const fileContent = attachedFile.content.length > maxFileSize 
        ? attachedFile.content.slice(0, maxFileSize) + '\n\n[File truncated — too large for API]'
        : attachedFile.content
      promptText = `[File: ${attachedFile.name}]\n\n${fileContent}\n\n${input || 'Analyze this file.'}`
    }
    
    await sendPrompt(promptText)
    setInput('')
    setAttachedFile(null)
  }

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text); setCopiedId(id); setTimeout(() => setCopiedId(null), 2000)
  }

  const handleSpeak = (id: string, text: string) => {
    if (speakingId === id) { window.speechSynthesis.cancel(); setSpeakingId(null); return }
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(cleanForSpeech(text))
    const voice = getVoiceForLanguage(selectedLanguage)
    if (voice) u.voice = voice; u.rate = rate; u.onend = () => setSpeakingId(null)
    setSpeakingId(id); window.speechSynthesis.speak(u)
  }

  const handleFeedback = (id: string, type: 'up' | 'down') => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, feedback: type } : m))
  }

  const toggleReasoning = (id: string) => {
    setOpenReasoningIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  const handleClearMemory = () => {
    if (!window.confirm('CRITICAL: WIPE ALL SESSION MEMORY AND API KEY?')) return
    localStorage.removeItem('forgemind_history'); localStorage.removeItem('forgemind_corpus'); localStorage.removeItem('fm_api_key')
    setMessages([]); setCorpus([]); setApiKey(''); setLastSource(null); setOpenReasoningIds(new Set())
    emitFailure({ source: 'forgemind', severity: 'info', message: 'Session memory wiped by user.' })
  }

  const testApiKey = async () => {
    if (!apiKey.trim()) { setApiKeyStatus('none'); return }
    if (!apiKey.startsWith('sk-ant-')) { setApiKeyStatus('invalid'); return }
    
    setTestingKey(true)
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }]
        })
      })
      if (r.ok) setApiKeyStatus('valid')
      else if (r.status === 401) setApiKeyStatus('invalid')
      else setApiKeyStatus('unverified')
    } catch {
      setApiKeyStatus('unverified')
    } finally {
      setTestingKey(false)
    }
  }

  const handleExportCorpus = () => {
    if (!corpus.length) { emitFailure({ source: 'forgemind', severity: 'info', message: 'No corpus entries to export.' }); return }
    const blob = new Blob([corpus.map(e => JSON.stringify(e)).join('\n')], { type: 'application/jsonl' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a')
    a.href = url; a.download = 'forge-mind-corpus.jsonl'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
  }

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage() }
  }

  const getStatusIndicator = () => {
    if (apiKeyStatus === 'none') return <span style={{ color: '#ef4444' }}>🔴 No API Key</span>
    if (apiKeyStatus === 'invalid') return <span style={{ color: '#ef4444' }}>🔴 Invalid Key</span>
    if (apiKeyStatus === 'unverified') return <span style={{ color: '#eab308' }}>🟡 Unverified</span>
    if (lastSource === 'local') return <span style={{ color: '#10b981', fontWeight: 'bold' }}>● Local</span>
    if (lastSource === 'cloud') return <span style={{ color: '#3b82f6', fontWeight: 'bold' }}>● Cloud</span>
    return <span style={{ color: '#6b6b6b' }}>● Idle</span>
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'forgemind',    label: '🧠 ForgeMind' },
    { id: 'repoagent',   label: '🐙 RepoAgent' },
    { id: 'orchestrator',label: `🎛️ Orchestrator${taskQueue.length > 0 ? ` (${taskQueue.length})` : ''}` },
    { id: 'failures',    label: unresolvedCount > 0 ? `⚠️ Failures (${unresolvedCount})` : '⚠️ Failures' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#e5e5e5', fontFamily: 'monospace', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <header style={{ borderBottom: '1px solid #1a1a1a', padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#0a0a0a' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button onClick={() => setShowSettings(true)} style={{ background: 'none', border: 'none', color: '#f97316', fontSize: '18px', cursor: 'pointer', padding: 0 }}>⚙</button>
          <span style={{ color: '#f97316', fontWeight: 'bold', fontSize: '16px', letterSpacing: '1px' }}>FORGECLAW</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Language selector */}
          <select value={selectedLanguage} onChange={e => setSelectedLanguage(e.target.value)} style={{ background: '#111', color: '#f97316', border: '1px solid #222', borderRadius: '4px', padding: '4px 8px', fontSize: '10px', fontFamily: 'monospace', outline: 'none' }}>
            {Object.entries(LANGUAGE_NAMES).map(([code, name]) => <option key={code} value={code} style={{ background: '#111' }}>{name}</option>)}
          </select>
          <div style={{ fontSize: '11px' }}>{getStatusIndicator()}</div>
          <button onClick={handleClearMemory} style={{ ...headerBtnStyle, opacity: 0.6 }}>WIPE</button>
          <button onClick={handleExportCorpus} style={headerBtnStyle}>EXPORT</button>
        </div>
      </header>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1a1a1a', background: '#0a0a0a' }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              background: 'transparent', border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid #f97316' : '2px solid transparent',
              color: activeTab === tab.id ? '#f97316' : (tab.id === 'failures' && unresolvedCount > 0 ? '#eab308' : '#555'),
              padding: '8px 18px', cursor: 'pointer', fontSize: '10px', fontWeight: 'bold',
              letterSpacing: '1px', textTransform: 'uppercase', fontFamily: 'monospace', transition: 'color 0.15s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Neural Network Background */}
      <NeuralNetworkBackground
        messageCount={messages.length}
        isProcessing={loading}
        activeTab={activeTab}
        density="low"
      />

      {/* Main */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', maxWidth: activeTab === 'repoagent' ? '1200px' : '800px', margin: '0 auto', width: '100%', padding: '16px', position: 'relative', minHeight: 0, zIndex: 1 }}>

        {/* API Key - moved to settings, only show if empty */}
        {!apiKey && (
          <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: '6px', padding: '10px', marginBottom: '12px', textAlign: 'center' }}>
            <span style={{ color: '#ef4444', fontSize: '12px' }}>🔴 No API Key configured. Click ⚙ to add your Claude key.</span>
          </div>
        )}

        {/* Settings Modal */}
        {showSettings && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowSettings(false)}>
            <div style={{ background: '#111', border: '1px solid #222', borderRadius: '8px', padding: '20px', width: '90%', maxWidth: '400px' }} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <span style={{ color: '#f97316', fontSize: '14px', fontWeight: 'bold' }}>⚙ Settings</span>
                <button onClick={() => setShowSettings(false)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '18px' }}>×</button>
              </div>
              
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', color: '#888', fontSize: '11px', marginBottom: '6px', textTransform: 'uppercase' }}>Claude API Key</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input 
                    type={showApiKey ? 'text' : 'password'} 
                    placeholder="sk-ant-..." 
                    value={apiKey} 
                    onChange={e => { setApiKey(e.target.value); setApiKeyStatus('unverified') }} 
                    style={{ flex: 1, background: '#0a0a0a', color: '#ccc', border: `1px solid ${apiKeyStatus === 'invalid' ? '#ef4444' : '#222'}`, borderRadius: '4px', padding: '8px', fontSize: '12px', fontFamily: 'monospace', outline: 'none' }} 
                  />
                  <button onClick={() => setShowApiKey(!showApiKey)} style={{ background: '#222', border: 'none', color: '#666', borderRadius: '4px', padding: '0 10px', cursor: 'pointer', fontSize: '11px' }}>
                    {showApiKey ? '🙈' : '👁'}
                  </button>
                </div>
                {apiKeyStatus === 'invalid' && <div style={{ color: '#ef4444', fontSize: '10px', marginTop: '4px' }}>Invalid key format or API rejected it</div>}
                {apiKey && !apiKey.startsWith('sk-ant-') && <div style={{ color: '#ef4444', fontSize: '10px', marginTop: '4px' }}>Key must start with "sk-ant-"</div>}
              </div>
              
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                <button 
                  onClick={testApiKey} 
                  disabled={testingKey || !apiKey}
                  style={{ flex: 1, background: testingKey ? '#333' : '#f97316', color: '#000', border: 'none', borderRadius: '4px', padding: '8px', cursor: testingKey ? 'wait' : 'pointer', fontSize: '12px', fontWeight: 'bold' }}
                >
                  {testingKey ? 'Testing...' : 'TEST KEY'}
                </button>
              </div>
              
              <div style={{ textAlign: 'center', fontSize: '11px' }}>
                {apiKeyStatus === 'none' && <span style={{ color: '#666' }}>Enter your Claude API key above</span>}
                {apiKeyStatus === 'unverified' && <span style={{ color: '#eab308' }}>🟡 Key not tested yet</span>}
                {apiKeyStatus === 'valid' && <span style={{ color: '#22c55e' }}>🟢 API Key Valid</span>}
                {apiKeyStatus === 'invalid' && <span style={{ color: '#ef4444' }}>🔴 Invalid Key</span>}
              </div>
            </div>
          </div>
        )}

        {/* ── ForgeMind Tab ── */}
        {activeTab === 'forgemind' && (
          <>
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '20px', minHeight: '200px' }}>
              {messages.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#444' }}>
                  <p>System initialized. Awaiting input...</p>
                </div>
              ) : (
                messages.map(msg => {
                  const reasoningOpen = openReasoningIds.has(msg.id)
                  return (
                    <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start', gap: '4px' }}>
                      {msg.role === 'assistant' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                          <span style={{ fontSize: '14px' }}>🧠</span>
                          {msg.source && <span style={{ fontSize: '9px', color: msg.source === 'local' ? '#10b981' : '#3b82f6', opacity: 0.7 }}>{msg.source === 'local' ? 'LOCAL' : 'CLOUD'}</span>}
                        </div>
                      )}
                      <div style={{ maxWidth: '90%', padding: '10px 14px', borderRadius: '8px', background: msg.role === 'user' ? 'rgba(249, 115, 22, 0.9)' : 'rgba(26, 26, 26, 0.75)', color: msg.role === 'user' ? '#000' : '#e5e5e5', fontSize: '13px', lineHeight: '1.5', border: msg.role === 'assistant' ? '1px solid rgba(34, 34, 34, 0.5)' : 'none', boxShadow: '0 2px 10px rgba(0,0,0,0.3)', width: msg.role === 'assistant' ? '100%' : undefined }}>
                        {msg.content}
                        {msg.role === 'assistant' && (
                          <div style={{ marginTop: '10px', display: 'flex', gap: '8px', borderTop: '1px solid #222', paddingTop: '8px', alignItems: 'center' }}>
                            <button onClick={() => handleCopy(msg.id, msg.content)} style={actionButtonStyle}>{copiedId === msg.id ? '✓' : 'COPY'}</button>
                            <button onClick={() => handleSpeak(msg.id, msg.content)} style={actionButtonStyle}>{speakingId === msg.id ? '■' : 'READ'}</button>
                            <button onClick={() => handleFeedback(msg.id, 'up')} title="Helpful" style={{ ...actionButtonStyle, fontSize: '13px', padding: '2px 5px', border: msg.feedback === 'up' ? '1px solid #3b82f6' : '1px solid #222', color: msg.feedback === 'up' ? '#60a5fa' : '#4a7ab5', textShadow: msg.feedback === 'up' ? '0 0 8px #3b82f6' : 'none' }}>👍</button>
                            <button onClick={() => handleFeedback(msg.id, 'down')} title="Not helpful" style={{ ...actionButtonStyle, fontSize: '13px', padding: '2px 5px', border: msg.feedback === 'down' ? '1px solid #3b82f6' : '1px solid #222', color: msg.feedback === 'down' ? '#60a5fa' : '#4a7ab5', textShadow: msg.feedback === 'down' ? '0 0 8px #3b82f6' : 'none' }}>👎</button>
                            {msg.phases && Object.keys(msg.phases).length > 0 && (
                              <button onClick={() => toggleReasoning(msg.id)} style={{ ...actionButtonStyle, marginLeft: 'auto', border: reasoningOpen ? '1px solid #f97316' : '1px solid #444', color: reasoningOpen ? '#f97316' : '#888', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ fontSize: '8px', display: 'inline-block', transform: reasoningOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>▶</span>
                                REASONING
                              </button>
                            )}
                          </div>
                        )}
                        {msg.role === 'assistant' && msg.phases && reasoningOpen && (
                          <div style={{ marginTop: '12px', borderTop: '1px solid #2a2a2a', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '14px', animation: 'fadeSlideDown 0.2s ease' }}>
                            <div style={{ fontSize: '9px', letterSpacing: '2px', color: '#f97316', opacity: 0.6, textTransform: 'uppercase' }}>5-Phase Cognitive Scaffold</div>
                            {(['PHASE_1', 'PHASE_2', 'PHASE_3', 'PHASE_4', 'PHASE_5'] as const).map(phase => {
                              const content = msg.phases?.[phase]; if (!content) return null
                              return (
                                <div key={phase} style={{ borderLeft: '2px solid #f9731640', paddingLeft: '12px' }}>
                                  <div style={{ fontFamily: "'Crimson Pro', 'Palatino Linotype', Georgia, serif", fontStyle: 'italic', fontSize: '15px', color: '#f97316', marginBottom: '5px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span style={{ fontSize: '10px', opacity: 0.7 }}>{PHASE_ICONS[phase]}</span>
                                    {TAG_MAP[`[FM:${phase}]`]}
                                  </div>
                                  <div style={{ fontFamily: "'Crimson Pro', 'Palatino Linotype', Georgia, serif", fontStyle: 'italic', fontSize: '14px', color: '#c8c0b8', lineHeight: '1.65', whiteSpace: 'pre-wrap' }}>{content}</div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
              {loading && <div style={{ color: '#f97316', fontSize: '11px' }}><span className="pulse-text">EXECUTING COGNITIVE SCAFFOLD...</span></div>}
              <div ref={messagesEndRef} />
            </div>
              <div style={{ background: '#0a0a0a', borderTop: '1px solid #1a1a1a', padding: '12px 0' }}>
                {attachedFile && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 12px 8px', color: '#f97316', fontSize: '12px' }}>
                    <span>📎 {attachedFile.name}</span>
                    <button onClick={() => setAttachedFile(null)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '14px' }}>×</button>
                  </div>
                )}
                <div style={{ display: 'flex', gap: '10px', background: '#111', border: '1px solid #222', borderRadius: '8px', padding: '8px 12px' }}>
                  <FileUploadButton onFileSelect={(file, content) => setAttachedFile({ name: file.name, content })} disabled={loading} />
                  <textarea style={{ flex: 1, background: 'transparent', color: '#e5e5e5', border: 'none', outline: 'none', resize: 'none', fontSize: '13px', fontFamily: 'monospace', minHeight: '40px', WebkitAppearance: 'none' }} rows={2} placeholder="Ask anything..." value={input} onChange={e => setInput(e.target.value)} onInput={e => setInput(e.currentTarget.value)} onKeyDown={handleKeyPress} disabled={loading} />
                  <button style={{ background: '#f97316', color: '#000', padding: '0 16px', borderRadius: '6px', border: 'none', fontWeight: 'bold', cursor: loading ? 'not-allowed' : 'pointer', fontSize: '12px', textTransform: 'uppercase' }} onClick={handleSendMessage} disabled={loading}>SEND</button>
                </div>
              </div>
          </>
        )}

        {/* ── RepoAgent Tab ── */}
        {activeTab === 'repoagent' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ marginBottom: '10px' }}>
              <span style={{ color: '#f97316', fontSize: '10px', letterSpacing: '1px' }}>REPO AGENT</span>
              <span style={{ color: '#555', fontSize: '10px', marginLeft: '8px' }}>Browse · Analyze · Push · Deploy</span>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <RepoAnalyzer
                apiKey={apiKey}
                onAnalyze={async (prompt) => { setActiveTab('forgemind'); await sendPrompt(prompt) }}
                analyzing={loading}
                emitFailure={emitFailure}
              />
            </div>
          </div>
        )}

        {/* ── Orchestrator Tab ── */}
        {activeTab === 'orchestrator' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <OrchestratorPanel
              taskQueue={taskQueue}
              events={orchEvents}
              contracts={contracts}
              onResolveTask={resolveTask}
            />
          </div>
        )}

        {/* ── Failures Tab ── */}
        {activeTab === 'failures' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <FailureDashboard
              ledger={ledger}
              onResolve={resolveFailure}
              onClearResolved={clearResolved}
            />
          </div>
        )}
      </main>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@1,400;1,500;1,600&display=swap');
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        @keyframes fadeSlideDown { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
        .pulse-text { animation: pulse 1.5s infinite; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0a0a0a; }
        ::-webkit-scrollbar-thumb { background: #222; border-radius: 2px; }
        ::-webkit-scrollbar-thumb:hover { background: #333; }
      `}</style>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const headerBtnStyle: React.CSSProperties = {
  background: 'transparent', color: '#f97316', padding: '4px 10px', borderRadius: '4px',
  border: '1px solid #f97316', fontWeight: 'bold', cursor: 'pointer', fontSize: '10px', textTransform: 'uppercase',
}

const actionButtonStyle: React.CSSProperties = {
  background: 'transparent', border: '1px solid #222', color: '#666', fontSize: '9px',
  padding: '2px 6px', cursor: 'pointer', borderRadius: '3px', fontWeight: 'bold', letterSpacing: '0.5px', transition: 'all 0.2s',
}

const inputStyle: React.CSSProperties = {
  background: '#111', border: '1px solid #222', borderRadius: '4px', color: '#ccc',
  padding: '5px 8px', fontSize: '11px', fontFamily: 'monospace', outline: 'none',
}

const repoBtn: React.CSSProperties = {
  background: 'transparent', border: '1px solid #333', color: '#f97316', padding: '4px 10px',
  borderRadius: '4px', cursor: 'pointer', fontSize: '10px', fontWeight: 'bold', fontFamily: 'monospace',
  textTransform: 'uppercase', whiteSpace: 'nowrap',
}

export default App
