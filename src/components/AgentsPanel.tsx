// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
import { useState, useRef, useCallback } from 'react'
import { DEFAULT_GUARDIAN_POSTURE, type GuardianPosture } from '../lib/guardianGate'
import { safeGetItem, safeSetItem, safeJsonParse } from '../lib/storage'
import type { ProviderId } from '../lib/modelProviders'
import { modelSupportsTools } from '../lib/modelProviders'
import { FORGE_TOOLS, loadToolContext } from '../lib/forgeTools'
import type { ToolCall } from '../lib/forgeTools'
import { runSubAgent, toolsForCapability } from '../lib/managedAgent'
import { useI18n, type Key } from '../lib/i18n'
import type { AgentCapability, SubAgentBudgetReport } from '../lib/managedAgent'
import { resolveGithubToken } from '../lib/githubAuth'
import { MAX_NEXUS_CONTEXT_TOKENS } from '../lib/ai/nexusContext'

interface CustomAgent {
  id: string
  name: string
  systemPrompt: string
  /**
   * Runtime-enforced capability profile. Optional so agents saved before this
   * field existed keep loading; `resolveCapability` supplies the legacy default.
   */
  capability?: AgentCapability
}

interface AgentMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}

interface AgentsPanelProps {
  activeProvider: ProviderId
  activeModel: string
  apiKey: string
  /** Guardian posture, forwarded so an agent run is gated exactly like ForgeMind. */
  guardianPosture?: GuardianPosture
  /** Project-owned Guardian approval handler (co-sign). */
  requestGuardianApproval?: (call: ToolCall) => Promise<boolean>
}

const STORAGE_KEY = 'fc_custom_agents'

function loadAgents(): CustomAgent[] {
  return safeJsonParse(safeGetItem(STORAGE_KEY), [])
}

function saveAgents(agents: CustomAgent[]) {
  safeSetItem(STORAGE_KEY, JSON.stringify(agents))
}

function chatKey(agentId: string): string {
  return `fc_custom_agent_chat:${agentId}`
}

/**
 * Legacy compatibility. Agents saved before capability profiles existed carry
 * only a name and prompt, so infer an editable default from their stated purpose.
 * The inference only produces a starting value in the editor; authority is still
 * enforced by the runtime's capability filter, never by this heuristic.
 */
const CAPABILITIES: AgentCapability[] = ['chat', 'coding-readonly', 'coding']

function resolveCapability(agent: CustomAgent): AgentCapability {
  if (agent.capability) return agent.capability
  const text = `${agent.name} ${agent.systemPrompt}`.toLowerCase()
  if (/\b(cod(e|ing)|repo(sitory)?|github|commit|branch|pull request|merge)\b/.test(text)) return 'coding'
  if (/\b(read|inspect|review|analys|audit|search|explain)\b/.test(text)) return 'coding-readonly'
  return 'chat'
}

function loadChat(agentId: string): AgentMessage[] {
  return safeJsonParse(safeGetItem(chatKey(agentId)), [])
}

function saveChat(agentId: string, messages: AgentMessage[]): void {
  safeSetItem(chatKey(agentId), JSON.stringify(messages.slice(-100)))
}

type ChipTone = 'ok' | 'warn' | 'muted'

const CHIP_COLORS: Record<ChipTone, { border: string; color: string }> = {
  ok: { border: '#14532d', color: '#22c55e' },
  warn: { border: '#713f12', color: '#fbbf24' },
  muted: { border: '#222', color: '#666' },
}

function CapabilityChip({ label, tone }: { label: string; tone: ChipTone }) {
  const palette = CHIP_COLORS[tone]
  return (
    <span style={{ border: `1px solid ${palette.border}`, color: palette.color, borderRadius: '3px', padding: '2px 6px', letterSpacing: '0.5px' }}>
      {label}
    </span>
  )
}

export function AgentsPanel({ activeProvider, activeModel, apiKey, guardianPosture = DEFAULT_GUARDIAN_POSTURE, requestGuardianApproval }: AgentsPanelProps) {
  const { t, locale } = useI18n()
  const [agents, setAgents] = useState<CustomAgent[]>(loadAgents)
  const [activeAgent, setActiveAgent] = useState<CustomAgent | null>(null)
  const [editing, setEditing] = useState<CustomAgent | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftPrompt, setDraftPrompt] = useState('')
  const [draftCapability, setDraftCapability] = useState<AgentCapability>('coding-readonly')
  const [lastRunReport, setLastRunReport] = useState<SubAgentBudgetReport | null>(null)
  const [chatMessages, setChatMessages] = useState<AgentMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  const openNew = () => {
    setEditing({ id: '', name: '', systemPrompt: '' })
    setDraftName('')
    setDraftPrompt('')
    setDraftCapability('coding-readonly')
  }

  const openEdit = (agent: CustomAgent) => {
    setEditing(agent)
    setDraftName(agent.name)
    setDraftPrompt(agent.systemPrompt)
    setDraftCapability(resolveCapability(agent))
  }

  const saveAgent = () => {
    if (!draftName.trim() || !draftPrompt.trim()) return
    const updated = editing!.id
      ? agents.map(a => a.id === editing!.id ? { ...a, name: draftName.trim(), systemPrompt: draftPrompt.trim(), capability: draftCapability } : a)
      : [...agents, { id: `agent_${Date.now()}`, name: draftName.trim(), systemPrompt: draftPrompt.trim(), capability: draftCapability }]
    setAgents(updated)
    saveAgents(updated)
    setEditing(null)
  }

  const deleteAgent = (id: string) => {
    const updated = agents.filter(a => a.id !== id)
    setAgents(updated)
    saveAgents(updated)
    safeSetItem(chatKey(id), '')
    if (activeAgent?.id === id) setActiveAgent(null)
  }

  const openAgent = (agent: CustomAgent) => {
    setActiveAgent(agent)
    setChatMessages(loadChat(agent.id))
    setInput('')
  }

  const sendMessage = useCallback(async () => {
    if (!input.trim() || loading || !activeAgent) return
    const agent = activeAgent
    const text = input.trim()
    setInput('')
    const userMsg: AgentMessage = { id: `user-${Date.now()}`, role: 'user', content: text }
    const assistantId = `assistant-${Date.now()}`
    setChatMessages(prev => {
      const next = [...prev, userMsg, { id: assistantId, role: 'assistant' as const, content: '', streaming: true }]
      saveChat(agent.id, next)
      return next
    })
    setLoading(true)
    const controller = new AbortController()
    abortRef.current = controller
    setLastRunReport(null)

    try {
      const history = chatMessages.slice(-12).map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')
      const task = history ? `${history}\n\nUSER: ${text}` : text
      const runId = `agent-run-${agent.id}-${Date.now()}`
      const capability = resolveCapability(agent)
      const toolCtx = {
        ...loadToolContext(),
        agentId: agent.id,
        runId,
        signal: controller.signal,
        guardianPosture,
        requestGuardianApproval,
      }
      let report: SubAgentBudgetReport | null = null
      const result = await runSubAgent(
        agent.systemPrompt,
        task,
        undefined,
        activeProvider,
        activeModel,
        apiKey,
        FORGE_TOOLS,
        toolCtx,
        { capability, onBudget: next => { report = next } },
      )
      const buf = result
      if (controller.signal.aborted) return
      if (report) setLastRunReport(report)
      setChatMessages(prev => {
        const next = prev.map(m => m.id === assistantId ? { ...m, content: buf || '(no response)', streaming: false } : m)
        saveChat(agent.id, next)
        return next
      })
    } catch (err) {
      if (controller.signal.aborted) return
      const msg = err instanceof Error ? err.message : 'Error'
      setChatMessages(prev => {
        const next = prev.map(m => m.id === assistantId ? { ...m, content: `[ERROR]: ${msg}`, streaming: false } : m)
        saveChat(agent.id, next)
        return next
      })
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setLoading(false)
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    }
  }, [input, loading, activeAgent, chatMessages, activeProvider, activeModel, apiKey, guardianPosture, requestGuardianApproval])

  const stopGeneration = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setChatMessages(prev => {
      const next = prev.filter(message => !message.streaming)
      if (activeAgent) saveChat(activeAgent.id, next)
      return next
    })
    setLoading(false)
  }

  const inputStyle: React.CSSProperties = {
    background: '#0a0a0a', color: '#ccc', border: '1px solid #222',
    borderRadius: '4px', padding: '8px', fontSize: '12px', fontFamily: 'monospace',
    outline: 'none', width: '100%', boxSizing: 'border-box',
  }
  const btnStyle = (accent = false): React.CSSProperties => ({
    background: accent ? '#f97316' : '#1a1a1a', color: accent ? '#000' : '#888',
    border: `1px solid ${accent ? '#f97316' : '#333'}`, borderRadius: '4px',
    padding: '6px 12px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold',
    fontFamily: 'monospace',
  })

  // ── Truthful capability facts ───────────────────────────────────────────────
  // These describe the real runtime rather than the presence of a stored token.
  const activeCapability: AgentCapability = activeAgent ? resolveCapability(activeAgent) : 'chat'
  const providerToolMode: 'native' | 'manual' = modelSupportsTools(activeProvider, activeModel) ? 'native' : 'manual'
  const githubCredentialConfigured = Boolean(resolveGithubToken())
  const grantedToolCount = toolsForCapability(activeCapability, FORGE_TOOLS).length

  const runtimeNotice = ((): { text: string; tone: 'blocked' | 'warn' } | null => {
    if (activeCapability !== 'chat' && !githubCredentialConfigured) {
      return {
        text: t('agents.notice.noCredential'),
        tone: 'blocked',
      }
    }
    if (lastRunReport && !lastRunReport.nativeTools) {
      const parts = [
        t('agents.notice.manualProtocol', { provider: activeProvider }),
        t('agents.notice.lastRun', { n: lastRunReport.catalogTools.length, bytes: MAX_NEXUS_CONTEXT_TOKENS }),
      ]
      if (lastRunReport.unavailableTools.length) {
        parts.push(t('agents.notice.notOffered', { tools: lastRunReport.unavailableTools.join(', ') }))
      }
      return { text: parts.join(' '), tone: 'warn' }
    }
    if (activeCapability === 'chat') {
      return { text: t('agents.notice.chatProfile'), tone: 'warn' }
    }
    return null
  })()

  // ── Editor view ─────────────────────────────────────────────────────────────
  if (editing !== null) {
    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        <div style={{ maxWidth: '480px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button onClick={() => setEditing(null)} style={{ ...btnStyle(), padding: '4px 10px' }}>{t('agents.back')}</button>
            <span style={{ color: '#f97316', fontSize: '11px', fontFamily: 'monospace', letterSpacing: '2px', fontWeight: 'bold' }}>
              {editing.id ? t('agents.editTitle') : t('agents.newTitle')}
            </span>
          </div>
          <div>
            <label style={{ display: 'block', color: '#888', fontSize: '10px', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{t('agents.name')}</label>
            <input style={inputStyle} placeholder={t('agents.namePlaceholder')} value={draftName} onChange={e => setDraftName(e.target.value)} />
          </div>
          <div>
            <label style={{ display: 'block', color: '#888', fontSize: '10px', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{t('agents.systemPrompt')}</label>
            <textarea
              style={{ ...inputStyle, height: '220px', resize: 'vertical' }}
              placeholder={t('agents.systemPromptPlaceholder')}
              value={draftPrompt}
              onChange={e => setDraftPrompt(e.target.value)}
            />
          </div>
          <div>
            <label style={{ display: 'block', color: '#888', fontSize: '10px', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{t('agents.capabilityProfile')}</label>
            <select
              style={{ ...inputStyle, cursor: 'pointer' }}
              value={draftCapability}
              onChange={e => setDraftCapability(e.target.value as AgentCapability)}
            >
              {CAPABILITIES.map(capability => (
                <option key={capability} value={capability}>{t(`agents.cap.${capability}` as Key)}</option>
              ))}
            </select>
            <div style={{ color: '#444', fontSize: '10px', marginTop: '6px', lineHeight: '1.5' }}>
              {t('agents.capabilityHelp', { n: toolsForCapability(draftCapability, FORGE_TOOLS).length })}
              {draftCapability === 'coding' && t('agents.codingGuardianNote')}
            </div>
          </div>
          <button onClick={saveAgent} disabled={!draftName.trim() || !draftPrompt.trim()} style={{ ...btnStyle(true), opacity: (!draftName.trim() || !draftPrompt.trim()) ? 0.4 : 1 }}>
            {t('agents.save')}
          </button>
        </div>
      </div>
    )
  }

  // ── Chat view ────────────────────────────────────────────────────────────────
  if (activeAgent !== null) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ padding: '8px 16px', borderBottom: '1px solid #1a1a1a', display: 'flex', alignItems: 'center', gap: '10px', background: '#0a0a0a' }}>
          <button onClick={() => setActiveAgent(null)} style={{ ...btnStyle(), padding: '3px 10px', fontSize: '10px' }}>{t('agents.backToList')}</button>
          <span style={{ color: '#f97316', fontSize: '11px', fontFamily: 'monospace', fontWeight: 'bold', letterSpacing: '1px' }}>{activeAgent.name}</span>
        </div>
        <div style={{ padding: '8px 16px', borderBottom: '1px solid #1a1a1a', background: '#080808', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', fontFamily: 'monospace', fontSize: '9px' }}>
            <CapabilityChip label={t('agents.chipProfile', { value: t(`agents.cap.${activeCapability}` as Key) })} tone={activeCapability === 'chat' ? 'muted' : 'ok'} />
            <CapabilityChip label={t('agents.chipProvider', { value: activeProvider })} tone="muted" />
            <CapabilityChip
              label={providerToolMode === 'native' ? t('agents.chipToolNative') : t('agents.chipToolManual')}
              tone={providerToolMode === 'native' ? 'ok' : 'warn'}
            />
            <CapabilityChip
              label={githubCredentialConfigured ? t('agents.chipGhOk') : t('agents.chipGhNo')}
              tone={githubCredentialConfigured ? 'ok' : 'warn'}
            />
            <CapabilityChip
              label={activeCapability === 'chat' ? t('agents.chipToolsNone') : t('agents.chipToolsGranted', { n: grantedToolCount })}
              tone={activeCapability === 'chat' ? 'muted' : 'ok'}
            />
            <CapabilityChip
              label={guardianPosture === 'full-cosign' ? t('agents.chipGuardianFull') : guardianPosture === 'operator-shell' ? t('agents.chipGuardianOp') : t('agents.chipGuardianAuto')}
              tone={guardianPosture !== 'autonomous' ? 'ok' : 'muted'}
            />
          </div>
          {runtimeNotice && (
            <div style={{ color: runtimeNotice.tone === 'blocked' ? '#fca5a5' : '#fbbf24', fontSize: '10px', fontFamily: 'monospace', lineHeight: '1.6' }}>
              {runtimeNotice.text}
            </div>
          )}
          <div style={{ color: '#333', fontSize: '9px', fontFamily: 'monospace' }}>
            {t('agents.credentialNote')}
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {chatMessages.length === 0 && (
            <div style={{ color: '#333', fontSize: '10px', fontFamily: 'monospace', textAlign: 'center', marginTop: '40px' }}>
              {t('agents.ready', { name: activeAgent.name })}
            </div>
          )}
          {chatMessages.map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '85%', padding: '8px 12px', borderRadius: '8px', fontSize: '13px', lineHeight: '1.5',
                background: m.role === 'user' ? '#f97316' : '#111',
                color: m.role === 'user' ? '#000' : '#ccc',
                border: m.role === 'assistant' ? '1px solid #1a1a1a' : 'none',
                fontFamily: 'system-ui, sans-serif',
                opacity: m.streaming ? 0.85 : 1,
              }}>
                {m.content || (m.streaming ? '▋' : '')}
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
        <div style={{ padding: '10px 16px', borderTop: '1px solid #1a1a1a', display: 'flex', gap: '8px', background: '#0a0a0a' }}>
          <input
            style={{ flex: 1, background: '#111', color: '#ccc', border: '1px solid #222', borderRadius: '6px', padding: '10px 12px', fontSize: '13px', outline: 'none' }}
            placeholder={t('agents.messagePlaceholder')}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
            disabled={loading}
          />
          {loading ? (
            <button onClick={stopGeneration} style={{ ...btnStyle(), padding: '10px 18px', color: '#fecaca', borderColor: '#ef4444', background: '#3f1111' }}>{t('chat.stop')}</button>
          ) : (
            <button onClick={sendMessage} disabled={!input.trim()} style={{ ...btnStyle(true), padding: '10px 18px', opacity: !input.trim() ? 0.5 : 1 }}>{t('chat.send')}</button>
          )}
        </div>
      </div>
    )
  }

  // ── Agent list view ──────────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
      <div style={{ maxWidth: '480px', margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <span style={{ color: '#f97316', fontSize: '11px', fontFamily: 'monospace', letterSpacing: '2px', fontWeight: 'bold' }}>{t('tab.agents')}</span>
          <button onClick={openNew} style={btnStyle(true)}>{t('agents.newBtn')}</button>
        </div>

        {agents.length === 0 && (
          <div style={{ textAlign: 'center', color: '#333', fontSize: '11px', fontFamily: 'monospace', marginTop: '60px', lineHeight: '2' }}>
            {t('agents.none')}<br />
            {t('agents.noneHelp1')}<br />{t('agents.noneHelp2')}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {agents.map(agent => (
            <div key={agent.id} style={{ background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: '6px', padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ color: '#ccc', fontSize: '13px', fontWeight: 'bold', fontFamily: 'system-ui' }}>{agent.name}</span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button onClick={() => openEdit(agent)} style={{ ...btnStyle(), padding: '3px 8px', fontSize: '10px' }}>{t('agents.edit')}</button>
                  <button onClick={() => deleteAgent(agent.id)} style={{ ...btnStyle(), padding: '3px 8px', fontSize: '10px', color: '#555' }}>✕</button>
                </div>
              </div>
              <div style={{ color: '#444', fontSize: '10px', fontFamily: 'monospace', marginBottom: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {agent.systemPrompt.slice(0, 90)}{agent.systemPrompt.length > 90 ? '…' : ''}
              </div>
              <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', fontFamily: 'monospace', fontSize: '9px' }}>
                <CapabilityChip
                  label={t(`agents.cap.${resolveCapability(agent)}` as Key).toLocaleUpperCase(locale)}
                  tone={resolveCapability(agent) === 'chat' ? 'muted' : 'ok'}
                />
                <CapabilityChip label={t('agents.toolCount', { n: toolsForCapability(resolveCapability(agent), FORGE_TOOLS).length })} tone="muted" />
              </div>
              <button onClick={() => openAgent(agent)} style={{ ...btnStyle(true), width: '100%', padding: '7px' }}>
                {t('agents.openChat')}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
