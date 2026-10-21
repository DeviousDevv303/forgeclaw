// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// NEXUS Recursive Learning page (replaced the MIC tab on 2026-10-20; voice input stays on the chat bar).
// Shows what NEXUS has learned from every run as counted evidence, the recurring failures it feeds back
// to the agent, and the candidates awaiting operator review. Read-and-reject only: admission needs a
// signed authorization (corpusAdmissionAuth.ts), which this page deliberately does not hold.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { corpusRepository, type LearningCandidate } from '../lib/corpus'
import { LLM_MILESTONES, LLM_ROADMAP, llmReadiness, NEXUS_MOTTO, NEXUS_PRINCIPLES, OUTCOMES, summarizeLearning, type Outcome } from '../lib/nexusLearning'
import { useI18n } from '../lib/i18n'
import { activeHeuristics, decide, loadDecisions, mineHeuristics } from '../lib/nexusHeuristics'
import { CONVERGED_BY, knowledgeOrigin, NEXUS_PHASES } from '../lib/nexusConvergence'
import { describeTaste, loadTaste, MIN_TASTE_EVENTS, resetTaste } from '../lib/nexusTaste'

const OUTCOME_COLOR: Record<Outcome, string> = { verified: '#22c55e', completed: '#39ff14', attempted: '#eab308', failed: '#ef4444', blocked: '#f97316' }
const mono = "'Courier New', monospace"
const card: React.CSSProperties = { background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '12px 14px' }
const purgeButton: React.CSSProperties = { background: 'none', border: '1px solid #3a1a1a', color: '#a55', borderRadius: '4px', padding: '4px 10px', cursor: 'pointer', fontSize: '10px', fontFamily: 'monospace', marginBottom: '8px' }
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
  // The road counts only evidence-backed knowledge; legacy entries admitted without review are not training data.
  const training = corpusRepository.getTrainingCount()
  const road = useMemo(() => llmReadiness(training, candidates), [training, candidates])
  const [decisions, setDecisions] = useState(() => loadDecisions())
  const mined = useMemo(() => mineHeuristics(candidates), [candidates])
  const active = useMemo(() => activeHeuristics(mined, decisions), [mined, decisions])
  const minedByRule = useMemo(() => new Map(mined.map(h => [h.rule, h])), [mined])
  const converged = useMemo(() => corpusRepository.getConvergedCounts(), [candidates]) // eslint-disable-line react-hooks/exhaustive-deps
  const [knowledgeTick, setKnowledgeTick] = useState(0)
  const knowledge = useMemo(() => corpusRepository.listKnowledge(), [candidates, knowledgeTick]) // eslint-disable-line react-hooks/exhaustive-deps
  const legacy = useMemo(() => knowledge.filter(k => knowledgeOrigin(k).startsWith('LEGACY')), [knowledge])
  const [purgeArmed, setPurgeArmed] = useState(false)
  const [knowledgeNotice, setKnowledgeNotice] = useState('')
  const phaseCounts: Record<string, number> = {
    assumptions: summary.lessons.length,
    heuristics: active.length,
    first_principles: converged.first_principles ?? 0,
    extension: converged.extension ?? 0,
    convergence: Object.values(converged).reduce((a, b) => a + b, 0) + active.length,
  }
  const [taste, setTaste] = useState(() => loadTaste())
  const tasteWords = useMemo(() => describeTaste(taste), [taste])

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

      <section style={{ ...card, borderColor: '#2a1a05' }} aria-label="Road to the NEXUS LLM" data-testid="nexus-llm-road">
        <div style={heading}>ROAD TO THE NEXUS LLM</div>
        <div style={{ color: '#eee', fontFamily: mono, fontSize: '13px', marginBottom: '6px' }}>
          {road.approved.toLocaleString()} verified training example{road.approved === 1 ? '' : 's'}
          {road.next ? ` · next: ${road.next.label} at ${road.next.approved.toLocaleString()}` : ' · every data milestone reached'}
        </div>
        <div style={{ height: '8px', background: '#1a1a1a', borderRadius: '4px', overflow: 'hidden', marginBottom: '8px' }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(road.progress * 100)}>
          <div style={{ width: `${Math.round(road.progress * 100)}%`, height: '100%', background: '#f97316' }} />
        </div>
        <div style={{ color: '#888', fontSize: '11px', lineHeight: 1.6, marginBottom: '8px' }}>
          {road.awaitingReview.toLocaleString()} record(s) with no evidence yet · data covers {road.toolCoverage} tool(s) · milestones {LLM_MILESTONES.map(m => m.approved.toLocaleString()).join(' / ')}
        </div>
        <ol style={{ margin: 0, paddingLeft: '18px', fontSize: '12px', lineHeight: 1.7 }}>
          {LLM_ROADMAP.map((step, i) => <li key={step} style={{ color: i < road.step ? '#22c55e' : i === road.step ? '#f97316' : '#555' }}>{step}{i === road.step ? ' ← now' : ''}</li>)}
        </ol>
        <div style={{ color: '#555', fontSize: '10px', marginTop: '8px' }}>NEXUS is training data, not a model yet. Evidence-backed records count by themselves; the milestones are estimates for a LoRA fine-tune of an open base model.</div>
      </section>

      <section style={{ ...card, borderColor: '#2a1a05' }} aria-label="Five-phase learning loop" data-testid="nexus-phases">
        <div style={heading}>THE LOOP · what NEXUS has learned, by phase · no approval needed</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '8px', marginTop: '6px' }}>
          {NEXUS_PHASES.map(p => (
            <div key={p.phase} style={{ border: '1px solid #1e1e1e', borderRadius: '6px', padding: '6px 8px', minWidth: 0 }}>
              <div style={{ color: '#f97316', fontSize: '10px', fontFamily: 'monospace', overflowWrap: 'anywhere' }}>{p.icon} {p.label.toUpperCase()}</div>
              <div style={{ color: '#eee', fontSize: '18px', fontFamily: mono }}>{phaseCounts[p.phase]}</div>
            </div>
          ))}
        </div>
        <div style={{ color: '#666', fontSize: '10px', marginTop: '6px', lineHeight: 1.6 }}>Assumptions: recurring failures to avoid · Heuristics: your own rules · First Principles: your tasks answered with tool evidence · Extension: browsing steps that worked · Convergence: everything that became knowledge by itself. Visitors' input never converges.</div>
      </section>

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

      <section style={card} aria-label="Your taste" data-testid="nexus-taste">
        <div style={heading}>YOUR TASTE · learned from your 🔥 👍 👎</div>
        <div style={{ color: '#666', fontSize: '11px', marginBottom: '8px' }}>React to any picture in the chat and NEXUS learns how you like things to look: brightness, contrast, color, warmth. It then steers the images it generates for you. Measured in this browser; nothing to set up or run.</div>
        <div style={{ color: '#eee', fontFamily: mono, fontSize: '13px', marginBottom: '6px' }}>{taste.liked.n} liked · {taste.disliked.n} disliked{taste.liked.n < MIN_TASTE_EVENTS ? ` · ${MIN_TASTE_EVENTS - taste.liked.n} more liked to start steering` : ''}</div>
        <div style={{ height: '6px', background: '#1a1a1a', borderRadius: '3px', overflow: 'hidden', marginBottom: '8px' }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(tasteWords.confidence * 100)}>
          <div style={{ width: `${Math.round(tasteWords.confidence * 100)}%`, height: '100%', background: '#f97316' }} />
        </div>
        {tasteWords.traits.length > 0 && <div style={{ color: '#22c55e', fontSize: '12px', marginBottom: '4px' }}>You like: {tasteWords.traits.join(', ')}</div>}
        {tasteWords.avoid.length > 0 && <div style={{ color: '#ef4444', fontSize: '12px', marginBottom: '4px' }}>You avoid: {tasteWords.avoid.join(', ')}</div>}
        {Object.keys(taste.palette).length > 0 && (
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', margin: '6px 0' }} aria-label="Colors you like">
            {Object.entries(taste.palette).slice(0, 8).map(([hex]) => <span key={hex} title={hex} style={{ width: '22px', height: '22px', borderRadius: '4px', background: hex, border: '1px solid #222' }} />)}
          </div>
        )}
        {(taste.liked.n > 0 || taste.disliked.n > 0) && (
          <button onClick={() => setTaste(resetTaste())} style={{ background: 'none', border: '1px solid #3a1a1a', color: '#a55', borderRadius: '4px', padding: '3px 8px', cursor: 'pointer', fontSize: '10px', fontFamily: 'monospace', marginTop: '4px' }}>RESET TASTE</button>
        )}
      </section>

      <section style={card} aria-label="Your heuristics" data-testid="nexus-heuristics">
        <div style={heading}>YOUR HEURISTICS · mined from what you type</div>
        <div style={{ color: '#666', fontSize: '11px', marginBottom: '8px' }}>Rules you state ("always…", "never…", "make sure…", "I want…", "if… then…", or "rule: …") that you repeat, or mark explicitly. They are given to every model as soon as NEXUS finds them; remove any you don't mean. Visitors' input is never mined.</div>
        {active.length === 0
          ? <div style={{ color: '#555', fontSize: '12px' }}>No heuristics yet. State a rule twice, or start a line with "rule:".</div>
          : (
            <div aria-label="Active heuristics">
              <div style={{ color: '#22c55e', fontSize: '10px', fontFamily: 'monospace', letterSpacing: '0.5px' }}>✓ ACTIVE · given to every model ({active.length}) · saved in this browser</div>
              <ul style={{ margin: '4px 0 0', paddingLeft: '18px', color: '#22c55e', fontSize: '12px', lineHeight: 1.7 }}>
                {active.slice(0, 24).map(rule => {
                  const h = minedByRule.get(rule)
                  return (
                    <li key={rule} style={{ overflowWrap: 'anywhere' }}>
                      {rule}{h ? <span style={{ color: '#555', fontSize: '10px', fontFamily: 'monospace' }}> · {h.explicit ? 'explicit · ' : ''}said {h.count}×</span> : null}{' '}
                      <button onClick={() => setDecisions(decide(rule, 'reject'))} title="Stop giving this rule to the models" style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '10px', fontFamily: 'monospace' }}>remove</button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
      </section>

      <section style={card} aria-label="Knowledge" data-testid="nexus-knowledge">
        <div style={heading}>KNOWLEDGE · what NEXUS treats as known ({knowledge.length})</div>
        <div style={{ color: '#666', fontSize: '11px', marginBottom: '8px' }}>These entries guide the models and count as training data. Check where each came from and remove anything wrong.</div>
        {knowledgeNotice && <div role="status" style={{ color: '#22c55e', fontSize: '11px', marginBottom: '8px' }}>{knowledgeNotice}</div>}
        {/* Confirmed on the page, not with window.confirm: some browsers (in-app ones especially) block that dialog, and then
            confirm returns false and the button would silently do nothing. */}
        {legacy.length > 0 && !purgeArmed && (
          <button onClick={() => setPurgeArmed(true)} style={purgeButton}>REMOVE ALL LEGACY ({legacy.length})</button>
        )}
        {legacy.length > 0 && purgeArmed && (
          <div role="alertdialog" aria-label="Confirm removing all legacy entries" style={{ border: '1px solid #3a1a1a', borderRadius: '6px', padding: '8px', marginBottom: '8px' }}>
            <div style={{ color: '#ddd', fontSize: '11px', marginBottom: '6px', overflowWrap: 'anywhere' }}>Remove all {legacy.length} legacy entries (admitted without review, Sep 24 – Oct 13)? This cannot be undone.</div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                onClick={() => {
                  let removed = 0
                  for (const k of legacy) if (corpusRepository.removeKnowledge(k.id)) removed += 1
                  setPurgeArmed(false); setKnowledgeTick(n => n + 1); refresh()
                  setKnowledgeNotice(`Removed ${removed} of ${legacy.length} legacy entries.`)
                }}
                style={{ ...purgeButton, marginBottom: 0, color: '#fff', background: '#7f1d1d' }}
              >YES, REMOVE {legacy.length}</button>
              <button onClick={() => setPurgeArmed(false)} style={{ ...purgeButton, marginBottom: 0, color: '#aaa', borderColor: '#333' }}>CANCEL</button>
            </div>
          </div>
        )}
        {knowledge.length === 0
          ? <div style={{ color: '#555', fontSize: '12px' }}>Nothing yet.</div>
          : knowledge.slice(0, 100).map(k => (
              <div key={k.id} style={{ borderTop: '1px solid #161616', padding: '6px 0', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: k.metadata.admittedBy === CONVERGED_BY ? '#22c55e' : '#eab308', fontSize: '10px', fontFamily: 'monospace', overflowWrap: 'anywhere' }}>{k.timestamp.slice(0, 16).replace('T', ' ')} · {knowledgeOrigin(k)} · {k.source}{k.metadata.model ? ` · ${k.metadata.model}` : ''}</div>
                  <div style={{ color: '#ccc', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(k.metadata.input || '').slice(0, 160)}</div>
                  <div style={{ color: '#666', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.content.slice(0, 200)}</div>
                </div>
                <button onClick={() => { if (corpusRepository.removeKnowledge(k.id)) { setKnowledgeTick(n => n + 1); refresh() } }} title="Remove this from what NEXUS knows" style={{ background: 'none', border: '1px solid #3a1a1a', color: '#a55', borderRadius: '4px', padding: '3px 8px', cursor: 'pointer', fontSize: '10px', fontFamily: 'monospace' }}>REMOVE</button>
              </div>
            ))}
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
          <div style={heading}>{t('nexus.candidatesTitle')} {filter !== 'all' ? `· ${filter}` : ''}</div>
          <button onClick={refresh} style={{ background: 'none', border: '1px solid #2a2a2a', color: '#777', borderRadius: '4px', padding: '3px 10px', cursor: 'pointer', fontSize: '10px', fontFamily: 'monospace' }}>{t('nexus.refresh')}</button>
        </div>
        <div style={{ color: '#666', fontSize: '11px', marginBottom: '8px' }}>{t('nexus.admissionNote')}</div>
        {notice && <div role="status" style={{ color: '#eab308', fontSize: '11px', marginBottom: '8px' }}>{notice}</div>}
        {shown.length === 0
          ? <div style={{ color: '#555', fontSize: '12px' }}>{filter !== 'all' ? t('nexus.nothingRecordedWithOutcome', { outcome: filter }) : t('nexus.nothingRecorded')}</div>
          : shown.map(c => {
              const outcome = outcomeOf(c)
              const auto = c.metadata?.admittedBy === CONVERGED_BY
              const phaseLabel = NEXUS_PHASES.find(p => p.phase === c.metadata?.phase)?.label
              return (
                <div key={c.id} style={{ borderTop: '1px solid #161616', padding: '8px 0', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <span style={{ color: OUTCOME_COLOR[outcome], fontSize: '10px', fontFamily: 'monospace', minWidth: '70px' }}>● {outcome}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: '#888', fontSize: '10px', fontFamily: 'monospace' }}>{c.timestamp.slice(0, 19).replace('T', ' ')} · {c.metadata?.channel || c.source}{c.metadata?.tool ? ` · ${c.metadata.tool}` : ''} · {c.model}{auto && c.admissionStatus === 'approved' ? <span style={{ color: '#22c55e' }}> · AUTO-ADDED{phaseLabel ? ` · ${phaseLabel}` : ''}{c.metadata?.admittedAt ? ` · ${String(c.metadata.admittedAt).slice(0, 16).replace('T', ' ')}` : ''}</span> : null}{c.metadata?.run ? <span style={{ color: '#555' }}> · {c.metadata.run.replace(/^run-/, 'run ')}{(c.metadata.runs?.split(',').length ?? 0) > 1 ? ` · seen in ${c.metadata.runs.split(',').length} runs` : ''}</span> : null}{c.admissionStatus === 'rejected' ? <span style={{ color: '#777' }}> · removed</span> : null}{c.metadata?.flags ? <span style={{ color: '#ef4444' }}> · ⚠ {c.metadata.flags}</span> : null}</div>
                    <div style={{ color: '#ccc', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.input.slice(0, 160)}</div>
                    <div style={{ color: '#666', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(c.generatedResult || '').slice(0, 200)}</div>
                  </div>
                  {c.admissionStatus !== 'rejected' && <button onClick={() => void reject(c)} title={auto ? 'Remove this from what NEXUS knows; it will not be added again' : undefined} style={{ background: 'none', border: '1px solid #3a1a1a', color: '#a55', borderRadius: '4px', padding: '3px 8px', cursor: 'pointer', fontSize: '10px', fontFamily: 'monospace' }}>{auto ? 'REMOVE' : t('nexus.reject')}</button>}
                </div>
              )
            })}
      </section>
    </div>
  )
}
