import { useState, useRef, useEffect, useCallback } from 'react'
import { FileUploadButton } from './components/FileUploadButton'
import { NeuralNetworkBackground } from './components/NeuralNetworkBackground'
// import { SupabaseProvider } from './components/SupabaseProvider'
import { useErrorBus } from './hooks/useErrorBus'
import { safeGetItem, safeSetItem, safeRemoveItem, safeJsonParse } from './lib/storage'
import { useOrchestrator } from './hooks/useOrchestrator'
import { FailureDashboard } from './components/FailureDashboard'
import { BrowserAutomationPanel } from './components/BrowserAutomationPanel'
import { WhatsAppConnector } from './components/WhatsAppConnector'
import { ReasoningChainComponent } from './components/reasoning/ReasoningChain'
import { SystemMonitor } from './components/monitor/SystemMonitor'
import { useReasoningStream } from './hooks/useReasoningStream'
import { useSystemMonitor } from './hooks/useSystemMonitor'
import { useAgentActivityStream } from './hooks/useAgentActivityStream'
import { useWarRoom } from './hooks/useWarRoom'
import type { CristianDecision } from './types/warRoom'
import { collectMockEvents } from './lib/reasoningMock'
import { pushFile as githubPushFile } from './lib/github'
import type { MessageRole, ReasoningChain as ReasoningChainType } from './types/reasoning'
import {
  PROVIDERS, PROVIDER_ORDER, DEFAULT_PROVIDER, DEFAULT_MODEL,
  callProvider, testProviderKey,
} from './lib/modelProviders'
import type { ProviderId, ChatMessage as ProviderMessage } from './lib/modelProviders'
import { FORGE_TOOLS, executeTool, loadToolContext } from './lib/forgeTools'
import type { ToolResult } from './lib/forgeTools'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  id: string
  role: MessageRole
  content: string
  timestamp: number
  source?: 'local' | 'cloud'
  activeTags?: string[]
  phases?: Record<string, string>
  showReasoning?: boolean
  feedback?: 'up' | 'down'
  reasoning?: ReasoningChainType
  toolResults?: ToolResult[]   // agentic tool calls this message made
  streaming?: boolean          // true while tokens are arriving
}

interface CorpusEntry {
  prompt: string
  response: string
  source: 'claude-haiku' | 'ollama'
  timestamp: string
}

// ─── System Prompt ────────────────────────────────────────────────────────────
// STANDING RULE: The line below must never be removed or modified.
// It prevents Claude refusals without overriding identity. Do not trim.
const FORGEMIND_SYSTEM_PROMPT = `You are ForgeMind, an intelligent AI assistant embedded in the ForgeClaw autonomous shell.

Always think through every response using this 5-phase reasoning framework. Output each phase using the EXACT tags shown — the user only sees Phase 5.

[FM:PHASE_1]State your assumptions and what you are taking as given[FM:PHASE_2]Apply relevant heuristics and rules of thumb[FM:PHASE_3]Reason from first principles[FM:PHASE_4]Explore implications and edge cases[FM:PHASE_5]Deliver the final synthesized answer — write this as a complete, standalone response in plain prose with no markdown symbols like ## or **.`

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cleanOutput(text: string): string {
  return text
    .replace(/\*\*/g, '').replace(/\*/g, '')
    .replace(/#{1,6}\s?/g, '')
    .replace(/__|_/g, '')
    .replace(/^-{3,}\s*$/gm, '')          // strip --- horizontal rules
    .replace(/^\s*[-•]\s+/gm, '')         // strip dash/bullet list markers
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')           // collapse excessive blank lines
    .trim()
}

function cleanForSpeech(text: string): string {
  return text
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[\u{2600}-\u{26FF}]/gu, '')
    .replace(/\*\*/g, '').replace(/\*/g, '').trim()
}

// ─── App ──────────────────────────────────────────────────────────────────────

type Tab = 'forgemind' | 'failures' | 'browserauto' | 'whatsapp' | 'settings'

function App() {
  const { ledger, emitFailure, resolveFailure, clearResolved, unresolvedCount } = useErrorBus()
  const { admitTask, resolveTask } = useOrchestrator({ emitFailure })
  
  // Activity stream is single source of truth
  const activityStream = useAgentActivityStream()
  const reasoning = useReasoningStream({ activityEvents: activityStream.events })
  const monitor = useSystemMonitor()

  // War Room: read gh_token from localStorage (prototype scope — Phase 2 lifts to proper context)
  const warRoomToken = safeGetItem('gh_token') || ''
  const { lanes, proposals } = useWarRoom({
    owner: 'DeviousDevv303',
    repo: 'forgeclaw',
    token: warRoomToken,
    addEvent: activityStream.addEvent,
  })

  const handleAcknowledge = useCallback(async (targetId: string) => {
    try {
      const ts = Date.now()
      const dec: CristianDecision = { targetId, decision: 'acknowledged', timestamp: ts }
      await githubPushFile('DeviousDevv303', 'forgeclaw',
        `war-room/cristian-decision-${ts}.json`,
        JSON.stringify(dec, null, 2), `ack: ${targetId}`, undefined, warRoomToken)
    } catch (err) {
      console.error('Failed to acknowledge proposal:', err)
    }
  }, [warRoomToken])

  const handleReject = useCallback(async (targetId: string) => {
    try {
      const ts = Date.now()
      const dec: CristianDecision = { targetId, decision: 'rejected', timestamp: ts }
      await githubPushFile('DeviousDevv303', 'forgeclaw',
        `war-room/cristian-decision-${ts}.json`,
        JSON.stringify(dec, null, 2), `reject: ${targetId}`, undefined, warRoomToken)
    } catch (err) {
      console.error('Failed to reject proposal:', err)
    }
  }, [warRoomToken])

  // DEV-ONLY: Load mock events once on mount — addEvent is stable (useCallback)
  const addEvent = activityStream.addEvent
  useEffect(() => {
    if (import.meta.env.DEV) {
      const mockEvents = collectMockEvents('forgemind')
      for (const event of mockEvents) addEvent(event)
    }
  }, [addEvent])

  const [activeTab, setActiveTab] = useState<Tab>('forgemind')
  const [messages, setMessages] = useState<Message[]>(() => {
    const saved = safeGetItem('forgemind_history')
    return safeJsonParse(saved, [])
  })
  const [input, setInput] = useState('')
  const [attachedFile, setAttachedFile] = useState<{ name: string; content: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [apiKeyStatus, setApiKeyStatus] = useState<'none' | 'unverified' | 'valid' | 'invalid'>('none')
  const [testingKey, setTestingKey] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [expandedToolIds, setExpandedToolIds] = useState<Set<string>>(new Set())

  // Multi-provider state
  const [activeProvider, setActiveProvider] = useState<ProviderId>(() =>
    (safeGetItem('fm_provider') as ProviderId) || DEFAULT_PROVIDER
  )
  const [activeModel, setActiveModel] = useState<string>(() =>
    safeGetItem('fm_model') || DEFAULT_MODEL[DEFAULT_PROVIDER]
  )
  // One key slot per provider; migrate existing fm_api_key into anthropic slot
  const [providerKeys, setProviderKeys] = useState<Record<ProviderId, string>>(() => {
    const stored = safeGetItem('fm_provider_keys')
    const parsed = stored ? (JSON.parse(stored) as Record<ProviderId, string>) : {} as Record<ProviderId, string>
    const legacyAnthropic = import.meta.env.VITE_ANTHROPIC_API_KEY || safeGetItem('fm_api_key') || ''
    return {
      // ⚠️ DO NOT REMOVE UNLESS CRISTIAN EXPLICITLY SAYS TO. IF HE DOES NOT SAY REMOVE — STAND DOWN.
      anthropic: parsed.anthropic || legacyAnthropic || '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',
      // ⚠️ DO NOT REMOVE UNLESS CRISTIAN EXPLICITLY SAYS TO. IF HE DOES NOT SAY REMOVE — STAND DOWN.
      deepseek:  'sk-c47d7b43ab38441087f6ad259ccf340f',
      // ⚠️ DO NOT REMOVE UNLESS CRISTIAN EXPLICITLY SAYS TO. IF HE DOES NOT SAY REMOVE — STAND DOWN.
      mistral:   parsed.mistral   || 'Ile5nNCCMWmVOnx3jtJH8T1TshigIU3I',
      // ⚠️ DO NOT REMOVE UNLESS CRISTIAN EXPLICITLY SAYS TO. IF HE DOES NOT SAY REMOVE — STAND DOWN.
      groq:      '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',
      // ⚠️ DO NOT REMOVE UNLESS CRISTIAN EXPLICITLY SAYS TO. IF HE DOES NOT SAY REMOVE — STAND DOWN.
      kimi:      'sk-kimi-y7ligg0j8hVYhrvlXaZlW5hohHehPJh3jQBj03ZfuBgpvsNX57iXXfRqRVFw8h0h',
      ollama:    '', // local — no key needed
    }
  })

  // Convenience: active provider's key
  const apiKey = providerKeys[activeProvider]
  const [corpus, setCorpus] = useState<CorpusEntry[]>(() => {
    const saved = safeGetItem('forgemind_corpus')
    return safeJsonParse(saved, [])
  })
  const [lastSource, setLastSource] = useState<'local' | 'cloud' | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [selectedLanguage, setSelectedLanguage] = useState<string>('en')
  const [rate] = useState<number>(1.0)
  const [openReasoningIds, setOpenReasoningIds] = useState<Set<string>>(new Set())
  const [failedProviders, setFailedProviders] = useState<Set<ProviderId>>(new Set())
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
  useEffect(() => { safeSetItem('forgemind_history', JSON.stringify(messages)) }, [messages])
  useEffect(() => { safeSetItem('forgemind_corpus', JSON.stringify(corpus)) }, [corpus])
  useEffect(() => { safeSetItem('fm_api_key', providerKeys.anthropic) }, [providerKeys.anthropic])
  useEffect(() => { safeSetItem('fm_provider', activeProvider) }, [activeProvider])
  useEffect(() => { safeSetItem('fm_model', activeModel) }, [activeModel])
  useEffect(() => { safeSetItem('fm_provider_keys', JSON.stringify(providerKeys)) }, [providerKeys])

  // On mount: if active provider has no key, auto-switch to first one that does
  // Ollama is always considered "has key" since it runs locally with no auth
  useEffect(() => {
    const hasKey = (pid: ProviderId) => pid === 'ollama' || !!providerKeys[pid]
    if (!hasKey(activeProvider)) {
      const fallback = PROVIDER_ORDER.find(pid => hasKey(pid))
      if (fallback) { setActiveProvider(fallback); setActiveModel(DEFAULT_MODEL[fallback]) }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: promptText, timestamp: Date.now() }

    if (!apiKey && activeProvider !== 'ollama') {
      setMessages(prev => [...prev, userMsg, {
        id: (Date.now() + 1).toString(), role: 'assistant',
        content: `No API key for ${PROVIDERS[activeProvider].name}. Open Settings and switch to a provider with a configured key.`,
        timestamp: Date.now(), source: 'local' as const,
      }])
      emitFailure({ source: 'forgemind', severity: 'warning', message: `No API key for ${PROVIDERS[activeProvider].name}` })
      return
    }

    // Orchestrator: admit forgemind chat task
    const taskId = `fm-${Date.now()}`
    const admitted = admitTask({
      taskId, agentId: 'forgemind', intent: 'chat',
      payload: { promptLength: promptText.length }, timeout: 30000,
      requestedScopes: ['llm:generate', 'corpus:write', 'errorBus:emit'],
    })
    if (!admitted) {
      setMessages(prev => [...prev, userMsg, {
        id: (Date.now() + 1).toString(), role: 'assistant',
        content: `⚠️ Task blocked by Guardian. Check the ⚠️ Failures tab.`,
        timestamp: Date.now(), source: 'local' as const,
      }])
      emitFailure({ source: 'forgemind', severity: 'warning', message: 'Guardian blocked this task.', context: { taskId } })
      return
    }

    setMessages(prev => [...prev, userMsg])
    setLoading(true)

    let source: 'local' | 'cloud' = 'cloud'
    let cloudMsgId: string | null = null
    try {
      // ── Try Ollama local first (fast, free, no key needed) ─────────────────
      let ollamaOk = false
      try {
        const ollamaModel = safeGetItem('fc_ollama_model') || 'qwen2.5:1.8b'
        const r = await fetch('http://localhost:11434/api/generate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: ollamaModel, system: FORGEMIND_SYSTEM_PROMPT, prompt: promptText, stream: false }),
          signal: AbortSignal.timeout(2000),
        })
        if (r.ok) {
          const d = await r.json() as { response: string }
          const { cleanText, tagsFound, phases } = parseAndExecuteTags(d.response || '', promptText, 'ollama')
          source = 'local'; setLastSource('local'); ollamaOk = true
          setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'assistant', content: cleanText, timestamp: Date.now(), source, activeTags: tagsFound, phases, showReasoning: false }])
          resolveTask(taskId)
        }
      } catch { /* fall through to cloud */ }
      if (ollamaOk) { setLoading(false); return }

      // ── Cloud agentic loop (tool calling, up to 15 iterations) ────────────
      source = 'cloud'
      cloudMsgId = (Date.now() + 1).toString()
      const msgId = cloudMsgId

      // Streaming placeholder
      setMessages(prev => [...prev, { id: msgId, role: 'assistant', content: '', timestamp: Date.now(), source: 'cloud', streaming: true }])

      const toolCtx = loadToolContext()
      const historyMessages: ProviderMessage[] = messages.slice(-12).map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
      const conversationMessages: ProviderMessage[] = [...historyMessages, { role: 'user', content: promptText }]
      const allToolResults: ToolResult[] = []
      let finalText = ''
      const MAX_ITERS = 15

      for (let iter = 0; iter < MAX_ITERS; iter++) {
        const isLastIter = iter === MAX_ITERS - 1
        let streamBuffer = ''

        const result = await callProvider(
          activeProvider, activeModel, FORGEMIND_SYSTEM_PROMPT,
          conversationMessages, apiKey,
          {
            tools: isLastIter ? undefined : FORGE_TOOLS,
            // Stream ONLY on the final iteration (no tools). When tools are passed,
            // streaming SSE cannot capture tool_call events — they arrive as delta
            // chunks that our parser ignores, causing the loop to see no toolCalls
            // and break with an empty finalText. Non-streaming returns the full
            // JSON response so toolCalls are populated correctly.
            onToken: isLastIter ? (token: string) => {
              streamBuffer += token
              setMessages(prev => prev.map(m => m.id === msgId ? { ...m, content: cleanOutput(streamBuffer), streaming: true } : m))
            } : undefined,
          }
        )

        // No tool calls → final answer
        if (!result.toolCalls?.length) {
          finalText = result.text || streamBuffer
          break
        }

        // Tool calls → execute each, feed results back
        const iterResults: ToolResult[] = []
        for (const call of result.toolCalls) {
          const output = await executeTool(call, toolCtx)
          iterResults.push({ toolCallId: call.id, name: call.name, output, isError: output.startsWith('[TOOL ERROR]') })
        }
        allToolResults.push(...iterResults)

        // Show progress in the streaming message
        const toolSummary = iterResults.map(r => `🔧 ${r.name} → ${r.output.slice(0, 80)}${r.output.length > 80 ? '…' : ''}`).join('\n')
        setMessages(prev => prev.map(m => m.id === msgId ? { ...m, content: toolSummary, streaming: true } : m))

        // Build next turn for Anthropic (multi-part content) vs OpenAI-compat
        if (activeProvider === 'anthropic') {
          conversationMessages.push({
            role: 'assistant',
            content: [
              ...(result.text ? [{ type: 'text' as const, text: result.text }] : []),
              ...result.toolCalls.map(tc => ({ type: 'tool_use' as const, id: tc.id, name: tc.name, input: tc.input })),
            ],
          })
          conversationMessages.push({
            role: 'user',
            content: iterResults.map(r => ({ type: 'tool_result' as const, tool_use_id: r.toolCallId, content: r.output })),
          })
        } else {
          // OpenAI-compat tool result format
          conversationMessages.push({
            role: 'assistant',
            content: result.text || '',
            tool_calls: result.toolCalls.map(tc => ({ id: tc.id, type: 'function' as const, function: { name: tc.name, arguments: JSON.stringify(tc.input) } })),
          })
          for (const r of iterResults) {
            conversationMessages.push({ role: 'tool', content: r.output, tool_call_id: r.toolCallId })
          }
        }
      }

      setLastSource('cloud')
      const { cleanText, tagsFound, phases } = parseAndExecuteTags(finalText, promptText, 'claude-haiku')
      setMessages(prev => prev.map(m => m.id === msgId
        ? { ...m, content: cleanText || finalText || '(empty response)', streaming: false, activeTags: tagsFound, phases, toolResults: allToolResults.length ? allToolResults : undefined, showReasoning: false }
        : m
      ))
      // Clear any prior auth failure mark for this provider on successful call
      if (failedProviders.has(activeProvider)) setFailedProviders(prev => { const n = new Set(prev); n.delete(activeProvider); return n })
      resolveTask(taskId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      emitFailure({ source: activeProvider, severity: 'error', message: msg, context: { promptLength: promptText.length } })
      if (cloudMsgId) {
        // Replace the orphaned streaming placeholder with the error — no duplicate bubble
        setMessages(prev => prev.map(m => m.id === cloudMsgId ? { ...m, content: `[ERROR]: ${msg}`, streaming: false } : m))
      } else {
        setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'assistant', content: `[ERROR]: ${msg}`, timestamp: Date.now(), source }])
      }
      // Auth failure: mark provider red and auto-switch to next working one
      const isAuthError = /invalid.*(auth|api.?key|token)|unauthorized|authentication|401/i.test(msg)
      if (isAuthError) {
        const newFailed = new Set([...failedProviders, activeProvider])
        setFailedProviders(newFailed)
        const next = PROVIDER_ORDER.find(pid => pid !== activeProvider && (pid === 'ollama' || providerKeys[pid]) && !newFailed.has(pid))
        if (next) { setActiveProvider(next); setActiveModel(DEFAULT_MODEL[next]) }
      }
    } finally { setLoading(false) }
  }, [apiKey, activeProvider, activeModel, emitFailure, admitTask, resolveTask]) // eslint-disable-line react-hooks/exhaustive-deps

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
    setOpenReasoningIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  const toggleToolExpand = (key: string) => {
    setExpandedToolIds(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n })
  }

  const handleClearMemory = () => {
    if (!window.confirm('WIPE ALL CHAT HISTORY AND CORPUS? (API keys are kept)')) return
    safeRemoveItem('forgemind_history'); safeRemoveItem('forgemind_corpus')
    setMessages([]); setCorpus([]); setLastSource(null); setOpenReasoningIds(new Set())
    emitFailure({ source: 'forgemind', severity: 'info', message: 'Session memory wiped by user.' })
  }

  const testApiKey = async () => {
    if (!apiKey.trim()) { setApiKeyStatus('invalid'); return }
    setTestingKey(true)
    try {
      await testProviderKey(activeProvider, activeModel, apiKey)
      setApiKeyStatus('valid')
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      setApiKeyStatus(msg.includes('401') || msg.toLowerCase().includes('invalid') ? 'invalid' : 'unverified')
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
    const modelLabel = PROVIDERS[activeProvider].models.find(m => m.id === activeModel)?.label ?? activeModel
    if (!apiKey) return <span style={{ color: '#ef4444' }}>🔴 No API Key</span>
    if (apiKeyStatus === 'invalid') return <span style={{ color: '#ef4444' }}>🔴 Invalid Key</span>
    if (apiKeyStatus === 'unverified') return <span style={{ color: '#eab308' }}>🟡 {PROVIDERS[activeProvider].name}</span>
    if (lastSource === 'local') return <span style={{ color: '#10b981', fontWeight: 'bold' }}>● Local</span>
    if (lastSource === 'cloud') return <span style={{ color: '#3b82f6', fontWeight: 'bold' }}>● {modelLabel}</span>
    return <span style={{ color: '#6b6b6b' }}>● {PROVIDERS[activeProvider].name}</span>
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'forgemind',   label: '🧠 ForgeMind' },
    { id: 'whatsapp',    label: '💬 WhatsApp' },
    { id: 'failures',    label: unresolvedCount > 0 ? `⚠️ Failures (${unresolvedCount})` : '⚠️ Failures' },
    { id: 'browserauto', label: 'Browser' },
    { id: 'settings',    label: '⚙ Settings' },
  ]

  return (
    <div style={{ position: 'relative', zIndex: 10, height: '100dvh', display: 'flex', flexDirection: 'column', color: '#e5e5e5', overflow: 'hidden' }}>

      {/* Header */}
      <header style={{ borderBottom: '1px solid #1a1a1a', padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#0a0a0a' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button onClick={() => setActiveTab('settings')} style={{ background: 'none', border: 'none', color: '#f97316', fontSize: '18px', cursor: 'pointer', padding: 0 }}>⚙</button>
          <span style={{ color: '#f97316', fontWeight: 'bold', fontSize: '16px', letterSpacing: '1px' }}>FORGECLAW</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Language selector */}
          <select value={selectedLanguage} onChange={e => setSelectedLanguage(e.target.value)} style={{ background: '#111', color: '#f97316', border: '1px solid #222', borderRadius: '4px', padding: '4px 8px', fontSize: '10px', fontFamily: 'monospace', outline: 'none' }}>
            {Object.entries(LANGUAGE_NAMES).map(([code, name]) => <option key={code} value={code} style={{ background: '#111' }}>{name}</option>)}
          </select>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {/* Per-provider credential dots */}
            <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
              {PROVIDER_ORDER.map(pid => {
                const initial = pid === 'anthropic' ? 'A' : pid === 'deepseek' ? 'D' : pid === 'mistral' ? 'M' : pid === 'groq' ? 'G' : pid === 'kimi' ? 'K' : 'O'
                const hasKey = pid === 'ollama' ? true : !!providerKeys[pid]
                const isActive = pid === activeProvider
                const hasFailed = failedProviders.has(pid)
                const dotColor = hasFailed ? '#ef4444' : (hasKey ? '#22c55e' : '#333')
                const bgColor = hasFailed ? '#ef444422' : (hasKey ? '#22c55e22' : '#1a1a1a')
                const titleText = hasFailed
                  ? `${PROVIDERS[pid].name}: auth failed — click Settings to update key`
                  : `${PROVIDERS[pid].name}: ${pid === 'ollama' ? 'local (no key needed)' : (hasKey ? 'key set' : 'no key')} — click to open Settings`
                return (
                  <span
                    key={pid}
                    title={titleText}
                    onClick={() => setActiveTab('settings')}
                    style={{
                      width: '14px', height: '14px', borderRadius: '3px', cursor: 'pointer',
                      background: bgColor,
                      border: `1px solid ${isActive ? '#f97316' : dotColor}`,
                      color: hasFailed ? '#ef4444' : (hasKey ? '#22c55e' : '#444'),
                      fontSize: '7px', fontWeight: 'bold', fontFamily: 'monospace',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >{initial}</span>
                )
              })}
              {/* GitHub token dot */}
              <span
                title={`GitHub token: ${safeGetItem('gh_token') ? 'set' : 'not set'} — click to open Settings`}
                onClick={() => setActiveTab('settings')}
                style={{
                  width: '14px', height: '14px', borderRadius: '3px', cursor: 'pointer',
                  background: safeGetItem('gh_token') ? '#22c55e22' : '#1a1a1a',
                  border: `1px solid ${safeGetItem('gh_token') ? '#22c55e' : '#333'}`,
                  color: safeGetItem('gh_token') ? '#22c55e' : '#444',
                  fontSize: '7px', fontWeight: 'bold', fontFamily: 'monospace',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >GH</span>
              {/* WhatsApp dot */}
              <span
                title={`WhatsApp: ${safeGetItem('wa_credentials') ? 'configured' : 'not set'} — click to open Settings`}
                onClick={() => setActiveTab('settings')}
                style={{
                  width: '14px', height: '14px', borderRadius: '3px', cursor: 'pointer',
                  background: safeGetItem('wa_credentials') ? '#22c55e22' : '#1a1a1a',
                  border: `1px solid ${safeGetItem('wa_credentials') ? '#22c55e' : '#333'}`,
                  color: safeGetItem('wa_credentials') ? '#22c55e' : '#444',
                  fontSize: '7px', fontWeight: 'bold', fontFamily: 'monospace',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >WA</span>
            </div>
            <div style={{ fontSize: '11px' }}>{getStatusIndicator()}</div>
          </div>
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
      {/* Main Content */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', maxWidth: '800px', margin: '0 auto', width: '100%', padding: '16px', position: 'relative', minHeight: 0, zIndex: 2, isolation: 'isolate', overflow: 'hidden' }}>

        {!apiKey && (
          <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: '6px', padding: '10px', marginBottom: '12px', textAlign: 'center' }}>
            <span style={{ color: '#ef4444', fontSize: '12px' }}>🔴 No API Key configured. Click ⚙ to add your {PROVIDERS[activeProvider].name} key.</span>
          </div>
        )}

        {/* ── Settings Tab ── */}
        {activeTab === 'settings' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 0' }}>
            <div style={{ maxWidth: '480px', margin: '0 auto' }}>

              {/* Provider selector */}
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', color: '#888', fontSize: '10px', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>AI Provider</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px' }}>
                  {PROVIDER_ORDER.map(pid => (
                    <button
                      key={pid}
                      onClick={() => { setActiveProvider(pid); setActiveModel(DEFAULT_MODEL[pid]); setApiKeyStatus('unverified') }}
                      style={{ background: activeProvider === pid ? '#f97316' : '#1a1a1a', color: activeProvider === pid ? '#000' : '#888', border: `1px solid ${activeProvider === pid ? '#f97316' : '#333'}`, borderRadius: '4px', padding: '7px 8px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold', fontFamily: 'monospace' }}
                    >
                      {PROVIDERS[pid].name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Model selector */}
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', color: '#888', fontSize: '10px', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Model</label>
                <select
                  value={activeModel}
                  onChange={e => setActiveModel(e.target.value)}
                  style={{ width: '100%', background: '#0a0a0a', color: '#ccc', border: '1px solid #222', borderRadius: '4px', padding: '8px', fontSize: '12px', fontFamily: 'monospace', outline: 'none' }}
                >
                  {PROVIDERS[activeProvider].models.map(m => (
                    <option key={m.id} value={m.id} style={{ background: '#111' }}>
                      {m.label}{m.note ? ` — ${m.note}` : ''}  ({m.contextK}K ctx)
                    </option>
                  ))}
                </select>
              </div>

              {/* API key for active provider */}
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', color: '#888', fontSize: '10px', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{PROVIDERS[activeProvider].name} API Key</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    placeholder={PROVIDERS[activeProvider].keyPlaceholder}
                    value={providerKeys[activeProvider]}
                    onChange={e => { setProviderKeys(prev => ({ ...prev, [activeProvider]: e.target.value })); setApiKeyStatus('unverified') }}
                    style={{ flex: 1, background: '#0a0a0a', color: '#ccc', border: `1px solid ${apiKeyStatus === 'invalid' ? '#ef4444' : '#222'}`, borderRadius: '4px', padding: '8px', fontSize: '12px', fontFamily: 'monospace', outline: 'none' }}
                  />
                  <button onClick={() => setShowApiKey(!showApiKey)} style={{ background: '#222', border: 'none', color: '#666', borderRadius: '4px', padding: '0 10px', cursor: 'pointer', fontSize: '11px' }}>
                    {showApiKey ? '🙈' : '👁'}
                  </button>
                </div>
                {apiKeyStatus === 'invalid' && <div style={{ color: '#ef4444', fontSize: '10px', marginTop: '4px' }}>API rejected this key</div>}
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
                {!apiKey && <span style={{ color: '#666' }}>Enter your {PROVIDERS[activeProvider].name} API key above</span>}
                {apiKey && apiKeyStatus === 'unverified' && <span style={{ color: '#eab308' }}>🟡 Key not tested yet</span>}
                {apiKeyStatus === 'valid' && <span style={{ color: '#22c55e' }}>🟢 Key valid — {PROVIDERS[activeProvider].name}</span>}
                {apiKeyStatus === 'invalid' && <span style={{ color: '#ef4444' }}>🔴 Invalid key</span>}
              </div>

              {/* Ollama local model scaffold */}
              <div style={{ marginTop: '8px', borderTop: '1px solid #1a1a1a', paddingTop: '14px' }}>
                <label style={{ display: 'block', color: '#888', fontSize: '10px', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Local Ollama Model <span style={{ color: '#333', textTransform: 'none' }}>(used first, cloud fallback)</span>
                </label>
                <input
                  type="text"
                  placeholder="qwen2.5:1.8b"
                  defaultValue={safeGetItem('fc_ollama_model') || 'qwen2.5:1.8b'}
                  onChange={e => safeSetItem('fc_ollama_model', e.target.value)}
                  style={{ width: '100%', background: '#0a0a0a', color: '#ccc', border: '1px solid #222', borderRadius: '4px', padding: '8px', fontSize: '12px', fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' }}
                />
                <div style={{ color: '#333', fontSize: '10px', marginTop: '4px' }}>
                  Any model installed via <code style={{ color: '#555' }}>ollama pull</code>. Leave blank to always use cloud.
                </div>
              </div>

              {/* GitHub tool connector config */}
              <div style={{ marginTop: '8px', borderTop: '1px solid #1a1a1a', paddingTop: '14px' }}>
                <label style={{ display: 'block', color: '#888', fontSize: '10px', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  GitHub Tool Connector
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {[
                    { key: 'gh_token',    label: 'GitHub Token', placeholder: 'ghp_...' },
                    { key: 'fc_gh_owner', label: 'Default Owner', placeholder: 'DeviousDevv303' },
                    { key: 'fc_gh_repo',  label: 'Default Repo',  placeholder: 'forgeclaw' },
                  ].map(f => (
                    <input
                      key={f.key}
                      type={f.key === 'gh_token' ? 'password' : 'text'}
                      placeholder={f.placeholder}
                      defaultValue={safeGetItem(f.key) || ''}
                      onChange={e => safeSetItem(f.key, e.target.value)}
                      style={{ width: '100%', background: '#0a0a0a', color: '#ccc', border: '1px solid #222', borderRadius: '4px', padding: '7px', fontSize: '11px', fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' }}
                    />
                  ))}
                </div>
                <div style={{ color: '#333', fontSize: '10px', marginTop: '4px' }}>
                  ForgeMind uses these when autonomously calling github_* tools.
                </div>
              </div>

              {/* Web Search API key */}
              <div style={{ marginTop: '8px', borderTop: '1px solid #1a1a1a', paddingTop: '14px' }}>
                <label style={{ display: 'block', color: '#888', fontSize: '10px', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Web Search — Brave API Key
                </label>
                <input
                  type="password"
                  placeholder="BSA..."
                  defaultValue={safeGetItem('fc_brave_key') || ''}
                  onChange={e => safeSetItem('fc_brave_key', e.target.value)}
                  style={{ width: '100%', background: '#0a0a0a', color: '#ccc', border: '1px solid #222', borderRadius: '4px', padding: '7px', fontSize: '11px', fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' }}
                />
                <div style={{ color: '#333', fontSize: '10px', marginTop: '4px' }}>
                  Optional. Enables web_search tool with full results. DuckDuckGo used as fallback.
                </div>
              </div>

            </div>
          </div>
        )}

        {/* ── ForgeMind Tab ── */}
        {activeTab === 'forgemind' && (
          <>
            <div style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain', display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '20px', minHeight: 0 }}>
              {messages.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#444', gap: '16px' }}>
                  <p>System initialized. Awaiting input...</p>
                  {/* Reasoning Stream from activity events */}
                  {reasoning.chains.map(chain => (
                    <ReasoningChainComponent key={chain.id} chain={chain} />
                  ))}
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
                      {/* Message bubble — clean response only */}
                      <div style={{ maxWidth: '90%', padding: '10px 14px', borderRadius: '8px', background: msg.role === 'user' ? 'rgba(249, 115, 22, 0.9)' : 'rgba(26, 26, 26, 0.75)', color: msg.role === 'user' ? '#000' : '#e5e5e5', fontSize: '13px', lineHeight: '1.5', border: msg.role === 'assistant' ? '1px solid rgba(34, 34, 34, 0.5)' : 'none', boxShadow: '0 2px 10px rgba(0,0,0,0.3)', width: msg.role === 'assistant' ? '100%' : undefined }}>
                        {/* Streaming cursor */}
                        {msg.streaming ? (
                          <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}<span style={{ animation: 'pulse 1s infinite', opacity: 0.7 }}>▋</span></span>
                        ) : <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>}
                        {msg.role === 'assistant' && (
                          <div style={{ marginTop: '10px', display: 'flex', gap: '8px', borderTop: '1px solid #222', paddingTop: '8px', alignItems: 'center' }}>
                            <button onClick={() => handleCopy(msg.id, msg.content)} style={actionButtonStyle}>{copiedId === msg.id ? '✓' : 'COPY'}</button>
                            <button onClick={() => handleSpeak(msg.id, msg.content)} style={actionButtonStyle}>{speakingId === msg.id ? '■' : 'READ'}</button>
                            <button onClick={() => handleFeedback(msg.id, 'up')} title="Helpful" style={{ ...actionButtonStyle, color: msg.feedback === 'up' ? '#22c55e' : '#444', border: msg.feedback === 'up' ? '1px solid #22c55e' : '1px solid #222' }}>▲</button>
                            <button onClick={() => handleFeedback(msg.id, 'down')} title="Not helpful" style={{ ...actionButtonStyle, color: msg.feedback === 'down' ? '#ef4444' : '#444', border: msg.feedback === 'down' ? '1px solid #ef4444' : '1px solid #222' }}>▼</button>
                          </div>
                        )}
                      </div>

                      {/* ── TACTICAL OPS LOG ── military reasoning trace, always shown on assistant turns */}
                      {/* ── TACTICAL OPS LOG ── tool execution trace only, shown when tools fired */}
                      {msg.role === 'assistant' && msg.toolResults && msg.toolResults.length > 0 && (() => {
                        const toolList = msg.toolResults
                        const toolOk = toolList.filter(t => !t.isError).length
                        const toolErr = toolList.filter(t => t.isError).length
                        return (
                          <div style={{ width: '100%', maxWidth: '90%', marginTop: '4px', fontFamily: "'Courier New', Courier, monospace" }}>
                            <button
                              onClick={() => toggleReasoning(msg.id)}
                              style={{
                                width: '100%', textAlign: 'left', padding: '4px 10px',
                                background: 'linear-gradient(90deg, #0d1a0d 0%, #111d0e 100%)',
                                border: '1px solid #3a5c2a',
                                borderBottom: reasoningOpen ? '1px solid #1e3318' : '1px solid #3a5c2a',
                                borderRadius: reasoningOpen ? '3px 3px 0 0' : '3px',
                                cursor: 'pointer',
                                display: 'flex', alignItems: 'center', gap: '8px',
                              }}
                            >
                              <span style={{ color: '#4a7c3f', fontSize: '9px' }}>▶</span>
                              <span style={{ color: '#6aab52', fontSize: '9px', letterSpacing: '2px' }}>◼ TACTICAL OPS LOG</span>
                              <span style={{ color: '#3a5c2a', fontSize: '9px' }}>|</span>
                              <span style={{ color: '#4a7c3f', fontSize: '9px', letterSpacing: '1px' }}>
                                {toolList.length} ACTION{toolList.length !== 1 ? 'S' : ''} EXECUTED
                              </span>
                              <span style={{ marginLeft: 'auto', color: '#3a5c2a', fontSize: '9px', letterSpacing: '1px' }}>
                                {reasoningOpen ? '[COLLAPSE]' : '[EXPAND]'}
                              </span>
                            </button>

                            {reasoningOpen && (
                              <div style={{ background: '#060e06', border: '1px solid #3a5c2a', borderTop: 'none', borderRadius: '0 0 3px 3px', display: 'flex', flexDirection: 'column' }}>
                                <div style={{ background: '#0a1a0a', borderBottom: '1px solid #1e3318', padding: '2px 10px', display: 'flex', justifyContent: 'space-between' }}>
                                  <span style={{ color: '#2a4a22', fontSize: '8px', letterSpacing: '2px' }}>// FORGECLAW AUTONOMOUS SHELL — INTERNAL OPS RECORD //</span>
                                  <span style={{ color: '#2a4a22', fontSize: '8px', letterSpacing: '1px' }}>UNCLASSIFIED</span>
                                </div>

                                {toolList.map((tr, i) => {
                                  const key = `${msg.id}_${i}`
                                  const isExpanded = expandedToolIds.has(key)
                                  const hasMore = tr.output.includes('\n') || tr.output.length > 100
                                  const status = tr.isError ? 'FAILED' : 'COMPLETE'
                                  const statusColor = tr.isError ? '#cc3333' : '#5a9e44'
                                  const seqNum = String(i + 1).padStart(2, '0')
                                  return (
                                    <div key={i} style={{ borderBottom: i < toolList.length - 1 ? '1px solid #0f1f0f' : 'none' }}>
                                      <div
                                        style={{ padding: '5px 10px', display: 'flex', gap: '8px', alignItems: 'center', cursor: hasMore ? 'pointer' : 'default', background: isExpanded ? '#0a180a' : 'transparent' }}
                                        onClick={() => hasMore && toggleToolExpand(key)}
                                      >
                                        <span style={{ color: '#2a5a22', fontSize: '8px', letterSpacing: '1px', flexShrink: 0 }}>[{seqNum}]</span>
                                        <span style={{ color: '#6aab52', fontSize: '9px', letterSpacing: '1px', flexShrink: 0, textTransform: 'uppercase' }}>{tr.name}</span>
                                        <span style={{ color: '#2a4a22', fontSize: '9px', flexShrink: 0 }}>→</span>
                                        <span style={{ color: '#4a7a3a', fontSize: '9px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                                          {tr.output.split('\n')[0].slice(0, 120)}
                                        </span>
                                        <span style={{ color: statusColor, fontSize: '8px', letterSpacing: '1px', flexShrink: 0, border: `1px solid ${statusColor}44`, padding: '0 4px', borderRadius: '2px' }}>{status}</span>
                                        {hasMore && <span style={{ color: '#2a4a22', fontSize: '8px', flexShrink: 0 }}>{isExpanded ? '▲' : '▼'}</span>}
                                      </div>
                                      {isExpanded && (
                                        <div style={{ padding: '0 10px 8px 10px', background: '#080f08' }}>
                                          <div style={{ borderLeft: '2px solid #1e3318', paddingLeft: '10px' }}>
                                            <div style={{ color: '#2a4a22', fontSize: '7px', letterSpacing: '2px', marginBottom: '4px', paddingTop: '4px' }}>— OUTPUT DUMP —</div>
                                            <pre style={{ color: tr.isError ? '#cc4444' : '#4a7a3a', background: '#050d05', border: '1px solid #1a2e1a', borderRadius: '2px', padding: '6px 8px', fontSize: '9px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '200px', overflowY: 'auto', margin: 0 }}>
                                              {tr.output}
                                            </pre>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}

                                <div style={{ background: '#0a1a0a', borderTop: '1px solid #1e3318', padding: '2px 10px', display: 'flex', justifyContent: 'space-between' }}>
                                  <span style={{ color: '#2a4a22', fontSize: '8px', letterSpacing: '1px' }}>{toolOk} OK / {toolErr} ERR</span>
                                  <span style={{ color: '#2a4a22', fontSize: '8px', letterSpacing: '1px' }}>END OF LOG</span>
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })()}
                    </div>
                  )
                })
              )}
              {loading && <div style={{ color: '#f97316', fontSize: '11px' }}><span className="pulse-text">EXECUTING COGNITIVE SCAFFOLD...</span></div>}
              <div ref={messagesEndRef} />
            </div>
            
            {/* System Monitor — pinned above input */}
            <SystemMonitor
              events={activityStream.events}
              isActive={monitor.state.isActive}
              lanes={lanes}
              proposals={proposals}
              onAcknowledge={handleAcknowledge}
              onReject={handleReject}
            />
            
              <div style={{ position: 'sticky', bottom: 0, background: '#0a0a0a', borderTop: '1px solid #1a1a1a', padding: '12px 0', zIndex: 20 }}>
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

        {/* ── WhatsApp Tab ── */}
        {activeTab === 'whatsapp' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <WhatsAppConnector />
          </div>
        )}

        {activeTab === 'browserauto' && <BrowserAutomationPanel />}
      </main>

      {/* Footer signature */}
      <footer style={{ textAlign: 'center', padding: '6px', borderTop: '1px solid #111', fontSize: '9px', color: '#2a2a2a', letterSpacing: '1.5px', flexShrink: 0, userSelect: 'none' }}>
        FORGECLAW · AUTONOMOUS REASONING ENGINE · BUILT BY DEVIOUSDEVV303
      </footer>

      <style>{`
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


export default App
