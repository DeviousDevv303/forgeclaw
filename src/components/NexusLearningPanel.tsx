// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// NEXUS Recursive Learning page (replaced the MIC tab on 2026-10-20; voice input stays on the chat bar).
// Shows what NEXUS has learned from every run as counted evidence, the recurring failures it feeds back
// to the agent, and the candidates awaiting operator review. Read-and-reject only: admission needs a
// signed authorization (corpusAdmissionAuth.ts), which this page deliberately does not hold.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { corpusRepository, type LearningCandidate } from '../lib/corpus'
import { NEXUS_MOTTO, NEXUS_PRINCIPLES, OUTCOMES, summarizeLearning, type Outcome } from '../lib/nexusLearning'
import { useI18n } from '../lib/i18n'

const OUTCOME_COLOR: Record<Outcome, string> = { verified: '#22c55e', completed: '#39ff14', attempted: '#eab308', failed: '#ef4444', blocked: '#f97316' }
const mono = "'Courier New', monospace"
const card: React.CSSProperties = { background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '12px 14px' }
const heading: React.CSSProperties = { fontSize: '10px', color: '#f97316', letterSpacing: '2px', fontFamily: 'monospace', fontWeight: 'bold', marginBottom: '10px', textTransform: 'uppercase' }

function outcomeOf(c: LearningCandidate): Outcome {
  const value = (c.metadata?.outcome || 'completed') as Outcome
  return OUTCOMES.includes(value) ? value : 'completed'
}

export function NexusLearningPanel() {
  const { t } = useI18n()
  const [candidates, setCandidates] = useState<LearningCandidate[]>(() => corpusRepository.listCandidates())
  const [filter, setFilter] = useState<Outcome | 'all'>('all')
  const [notice, setNotice] = useState('')
  const refresh = useCallback(() => setCandidates(corpusRepository.listCandidates()), [])
  useEffect(() => {
    // New runs keep adding candidates while the page is open.
    const timer = globalThis.setInterval(refresh, 5_000)
    return () => globalThis.clearInterval(timer)
  }, [refresh])

  const summary = useMemo(() => summarizeLearning(candidates), [candidates])
  const shown = useMemo(() => candidates.filter(c => filter === 'all' || outcomeOf(c) === filter).slice(0, 60), [candidates, filter])
  const approved = corpusRepository.getApprovedCount()

  const reject = async (c: LearningCandidate) => {
    const result = await corpusRepository.rejectCandidate(c.id, 'rejected by the operator on the NEXUS page')
    setNotice(result ? t('nexus.rejectedNotice', { id: c.id.slice(0, 22) }) : t('nexus.notRejectedNotice'))
    refresh()
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: '#080808', padding: '12px', display: 'flex', flexDirection: 'column', gap: '14px' }} data-testid="nexus-page">
      <header style={{ ...card, borderColor: '#2a1a05' }}>
        <div style={{ fontSize: '11px', color: '#f97316', letterSpacing: '3px', fontFamily: 'monospace', fontWeight: 'bold' }}>{t('nexus.title')}</div>
        <h2 style={{ margin: '6px 0 10px', color: '#eee', fontFamily: mono, fontSize: '20px', letterSpacing: '1px' }}>{NEXUS_MOTTO}</h2>
        <ol style={{ margin: 0, paddingLeft: '18px', color: '#999', fontSize: '12px', lineHeight: 1.7 }}>
          {NEXUS_PRINCIPLES.map(p => <li key={p}>{p}</li>)}
        </ol>
      </header>

      <section aria-label="Evidence totals" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '10px' }}>
        <div style={card}><div style={heading}>{t('nexus.recorded')}</div><div style={{ color: '#eee', fontSize: '22px', fontFamily: mono }}>{summary.total}</div></div>
        {OUTCOMES.map(o => (
          <button key={o} onClick={() => setFilter(filter === o ? 'all' : o)} style={{ ...card, textAlign: 'left', cursor: 'pointer', borderColor: filter === o ? OUTCOME_COLOR[o] : '#1e1e1e' }} aria-pressed={filter === o}>
            <div style={{ ...heading, color: OUTCOME_COLOR[o] }}>{o}</div>
            <div style={{ color: '#eee', fontSize: '22px', fontFamily: mono }}>{summary.byOutcome[o]}</div>
          </button>
        ))}
        <div style={card}><div style={heading}>{t('nexus.failureRate')}</div><div style={{ color: summary.failureRate > 0.3 ? '#ef4444' : '#39ff14', fontSize: '22px', fontFamily: mono }}>{Math.round(summary.failureRate * 100)}%</div></div>
        <div style={card}><div style={heading}>{t('nexus.admitted')}</div><div style={{ color: '#eee', fontSize: '22px', fontFamily: mono }}>{approved}</div></div>
      </section>

      <section style={card} aria-label="Lessons">
        <div style={heading}>{t('nexus.lessonsTitle')}</div>
        {summary.lessons.length === 0
          ? <div style={{ color: '#555', fontSize: '12px' }}>{t('nexus.noLessons')}</div>
          : <ul style={{ margin: 0, paddingLeft: '18px', color: '#ccc', fontSize: '12px', lineHeight: 1.7 }}>
              {summary.lessons.slice(0, 12).map(l => <li key={`${l.tool}${l.pattern}`}><b style={{ color: '#f97316' }}>{l.tool}</b> ×{l.count}: <span style={{ fontFamily: mono }}>{l.pattern}</span> <span style={{ color: '#555' }}>(last {l.lastSeen.slice(0, 10)})</span></li>)}
            </ul>}
      </section>

      <section style={card} aria-label="Tool reliability">
        <div style={heading}>{t('nexus.toolsTitle')}</div>
        {summary.tools.length === 0
          ? <div style={{ color: '#555', fontSize: '12px' }}>{t('nexus.noTools')}</div>
          : <div style={{ overflowX: 'auto' }} data-testid="nexus-tools-scroll"><table style={{ width: '100%', minWidth: '340px', borderCollapse: 'collapse', fontSize: '12px', fontFamily: mono, color: '#bbb' }}>
              <thead><tr style={{ color: '#666', textAlign: 'left' }}><th>{t('nexus.colTool')}</th><th>{t('nexus.colRuns')}</th><th>{t('nexus.colOk')}</th><th>{t('nexus.colFailed')}</th><th>{t('nexus.colBlocked')}</th><th>{t('nexus.colReliability')}</th></tr></thead>
              <tbody>{summary.tools.slice(0, 20).map(t => (
                <tr key={t.tool} style={{ borderTop: '1px solid #161616' }}>
                  <td style={{ padding: '4px 0' }}>{t.tool}</td><td>{t.total}</td><td>{t.completed}</td><td>{t.failed}</td><td>{t.blocked}</td>
                  <td style={{ color: t.reliability >= 0.8 ? '#39ff14' : t.reliability >= 0.5 ? '#eab308' : '#ef4444' }}>{Math.round(t.reliability * 100)}%</td>
                </tr>))}
              </tbody>
            </table></div>}
      </section>

      <section style={card} aria-label="Candidates">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={heading}>{t('nexus.candidatesTitle')} {filter !== 'all' ? `· ${filter}` : ''} {t('nexus.unapproved')}</div>
          <button onClick={refresh} style={{ background: 'none', border: '1px solid #2a2a2a', color: '#777', borderRadius: '4px', padding: '3px 10px', cursor: 'pointer', fontSize: '10px', fontFamily: 'monospace' }}>{t('nexus.refresh')}</button>
        </div>
        <div style={{ color: '#666', fontSize: '11px', marginBottom: '8px' }}>{t('nexus.admissionNote')}</div>
        {notice && <div role="status" style={{ color: '#eab308', fontSize: '11px', marginBottom: '8px' }}>{notice}</div>}
        {shown.length === 0
          ? <div style={{ color: '#555', fontSize: '12px' }}>{filter !== 'all' ? t('nexus.nothingRecordedWithOutcome', { outcome: filter }) : t('nexus.nothingRecorded')}</div>
          : shown.map(c => {
              const outcome = outcomeOf(c)
              return (
                <div key={c.id} style={{ borderTop: '1px solid #161616', padding: '8px 0', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <span style={{ color: OUTCOME_COLOR[outcome], fontSize: '10px', fontFamily: 'monospace', minWidth: '70px' }}>● {outcome}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: '#888', fontSize: '10px', fontFamily: 'monospace' }}>{c.timestamp.slice(0, 19).replace('T', ' ')} · {c.metadata?.channel || c.source}{c.metadata?.tool ? ` · ${c.metadata.tool}` : ''} · {c.model}</div>
                    <div style={{ color: '#ccc', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.input.slice(0, 160)}</div>
                    <div style={{ color: '#666', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(c.generatedResult || '').slice(0, 200)}</div>
                  </div>
                  <button onClick={() => void reject(c)} style={{ background: 'none', border: '1px solid #3a1a1a', color: '#a55', borderRadius: '4px', padding: '3px 8px', cursor: 'pointer', fontSize: '10px', fontFamily: 'monospace' }}>{t('nexus.reject')}</button>
                </div>
              )
            })}
      </section>
    </div>
  )
}
