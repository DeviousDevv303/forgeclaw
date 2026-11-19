// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// NEXUS Recursive Learning page (replaced the MIC tab on 2026-10-20; voice input stays on the chat bar).
// Shows what NEXUS has learned from every run as counted evidence, the recurring failures it feeds back
// to the agent, and the candidates awaiting operator review. Read-and-reject only: admission needs a
// signed authorization (corpusAdmissionAuth.ts), which this page deliberately does not hold.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { corpusRepository, type LearningCandidate } from '../lib/corpus'
import { corpusStorageReady, getCorpusStorageStatus, type CorpusStorageStatus } from '../lib/storage'
import { syncNexusIntake } from '../lib/nexusIntake'
import { corpusCoverage, MAX_PROMPT_LESSONS, NEXUS_MOTTO, NEXUS_PRINCIPLES, OUTCOMES, outcomeOfCandidate as outcomeOf, PROMPT_CANDIDATE_WINDOW, promptEligibleLessons, summarizeLearning, type Outcome } from '../lib/nexusLearning'
import { NEXUS_MODEL_STATE, pct } from '../lib/nexusModelState'
import { useI18n } from '../lib/i18n'
import { activeHeuristics, decide, loadDecisions, MAX_PROMPT_HEURISTICS, mineHeuristics, promptHeuristics } from '../lib/nexusHeuristics'
import { CONVERGED_BY, knowledgeOrigin, NEXUS_PHASES } from '../lib/nexusConvergence'
import { describeTaste, loadTaste, MIN_TASTE_EVENTS, resetTaste } from '../lib/nexusTaste'
import { HoldToConfirmButton } from './HoldToConfirmButton'
import { NexusGrowthGraph } from './NexusGrowthGraph'

const OUTCOME_COLOR: Record<Outcome, string> = { verified: '#22c55e', completed: '#39ff14', attempted: '#eab308', failed: '#ef4444', blocked: '#f97316', unmeasured: '#888' }
const mono = "'Courier New', monospace"
const card: React.CSSProperties = { background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '12px 14px' }
const purgeButton: React.CSSProperties = { background: 'none', border: '1px solid #3a1a1a', color: '#a55', borderRadius: '4px', padding: '4px 10px', cursor: 'pointer', fontSize: '10px', fontFamily: 'monospace', marginBottom: '8px' }
const heading: React.CSSProperties = { fontSize: '10px', color: '#f97316', letterSpacing: '2px', fontFamily: 'monospace', fontWeight: 'bold', marginBottom: '10px', textTransform: 'uppercase' }

/**
 * Every stored candidate, not the newest 1,000. listCandidates() defaults to 1,000, and this page read it with the default,
 * so past 1,000 stored records every number here (recorded, the outcome cards, failure rate, tools, lessons, the graph) was
 * silently computed from a slice while labelled as the total. The index itself holds up to 10,000.
 */
function readCandidates(): { candidates: LearningCandidate[]; promptWindow: LearningCandidate[]; stored: number } {
  const stored = corpusRepository.getCandidateCount()
  // promptWindow is read the way the prompt builders read it, so "given to every model" is computed from the same records.
  return { candidates: corpusRepository.listCandidates(Math.max(stored, 1)), promptWindow: corpusRepository.listCandidates(PROMPT_CANDIDATE_WINDOW), stored }
}

export function NexusLearningPanel() {
  const { t } = useI18n()
  const [{ candidates, promptWindow, stored }, setRead] = useState(readCandidates)
  const [filter, setFilter] = useState<Outcome | 'all'>('all')
  const [notice, setNotice] = useState('')
  const [storageStatus, setStorageStatus] = useState<CorpusStorageStatus>(() => getCorpusStorageStatus())
  const refresh = useCallback(() => setRead(readCandidates()), [])
  useEffect(() => {
    let live = true
    void corpusStorageReady.then(() => {
      if (!live) return
      setStorageStatus(getCorpusStorageStatus())
      refresh()
    })
    return () => { live = false }
  }, [refresh])
  useEffect(() => {
    // New runs keep adding candidates while the page is open.
    const timer = globalThis.setInterval(refresh, 5_000)
    return () => globalThis.clearInterval(timer)
  }, [refresh])
  useEffect(() => {
    // Stage 3b: present externally-produced intake records (canary / fallacy-audit)
    // as candidates through the existing gate. Intake is optional — any failure
    // leaves this page exactly as it was, so the result is only a refresh trigger.
    let live = true
    void syncNexusIntake().then(result => { if (live && result.added + result.admitted > 0) refresh() })
    return () => { live = false }
  }, [refresh])

  const summary = useMemo(() => summarizeLearning(candidates), [candidates])
  const shown = useMemo(() => candidates.filter(c => filter === 'all' || outcomeOf(c) === filter).slice(0, 60), [candidates, filter])
  const approved = corpusRepository.getApprovedCount()
  // The road counts only evidence-backed knowledge; legacy entries admitted without review are not training data.
  const training = corpusRepository.getTrainingCount()
  const coverage = useMemo(() => corpusCoverage(candidates), [candidates])
  const [decisions, setDecisions] = useState(() => loadDecisions())
  // What a prompt carries: mined from the prompt window, capped. `allActive` is every rule the stored records support;
  // the difference is rules whose mentions are older than the window (or past the cap), shown as a count, not as active.
  const mined = useMemo(() => mineHeuristics(promptWindow), [promptWindow])
  const active = useMemo(() => promptHeuristics(decisions, promptWindow), [decisions, promptWindow])
  const allActive = useMemo(() => activeHeuristics(mineHeuristics(candidates), decisions), [candidates, decisions])
  const notInPrompt = allActive.filter(rule => !active.includes(rule)).length
  const minedByRule = useMemo(() => new Map(mined.map(h => [h.rule, h])), [mined])
  const fedBack = useMemo(() => promptEligibleLessons(summarizeLearning(promptWindow)), [promptWindow])
  const fedBackKeys = new Set(fedBack.map(l => `${l.tool}\u0000${l.pattern}`))
  const otherRecurring = summary.lessons.filter(l => !fedBackKeys.has(`${l.tool}\u0000${l.pattern}`)).length
  const converged = useMemo(() => corpusRepository.getConvergedCounts(), [candidates]) // eslint-disable-line react-hooks/exhaustive-deps
  const [knowledgeTick, setKnowledgeTick] = useState(0)
  const knowledge = useMemo(() => corpusRepository.listKnowledge(), [candidates, knowledgeTick]) // eslint-disable-line react-hooks/exhaustive-deps
  const legacy = useMemo(() => knowledge.filter(k => knowledgeOrigin(k).startsWith('LEGACY')), [knowledge])
  const [purgeArmed, setPurgeArmed] = useState(false)
  const [knowledgeNotice, setKnowledgeNotice] = useState('')
  const phaseCounts: Record<string, number> = {
    assumptions: fedBack.length,
    heuristics: active.length,
    first_principles: converged.first_principles ?? 0,
    extension: converged.extension ?? 0,
    convergence: Object.values(converged).reduce((a, b) => a + b, 0),
  }
  const [taste, setTaste] = useState(() => loadTaste())
  const tasteWords = useMemo(() => describeTaste(taste), [taste])

  const reject = async (c: LearningCandidate) => {
    const result = await corpusRepository.rejectCandidate(c.id, 'rejected by the operator on the NEXUS page')
    setNotice(result ? t('nexus.rejectedNotice', { id: c.id.slice(0, 22) }) : t('nexus.notRejectedNotice'))
    refresh()
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: '#080808', padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }} data-testid="nexus-page">
      <header style={{ ...card, borderColor: '#2a1a05' }}>
        <div style={{ fontSize: '11px', color: '#f97316', letterSpacing: '3px', fontFamily: 'monospace', fontWeight: 'bold' }}>{t('nexus.title')}</div>
        <h2 style={{ margin: '6px 0 10px', color: '#eee', fontFamily: mono, fontSize: '20px', letterSpacing: '1px' }}>{NEXUS_MOTTO}</h2>
        <ol style={{ margin: 0, paddingLeft: '18px', color: '#999', fontSize: '12px', lineHeight: 1.7 }}>
          {NEXUS_PRINCIPLES.map(p => <li key={p}>{p}</li>)}
        </ol>
      </header>

      <section style={{ ...card, borderColor: '#2a1a05' }} aria-label="The Nexus model" data-testid="nexus-model">
        <div style={heading}>THE MODEL · what ForgeClaw runs as Nexus Intelligence</div>
        <div style={{ color: '#eee', fontFamily: mono, fontSize: '13px', marginBottom: '6px', overflowWrap: 'anywhere' }}>{NEXUS_MODEL_STATE.label}</div>
        <div style={{ color: '#999', fontSize: '11px', fontFamily: 'monospace', lineHeight: 1.7, overflowWrap: 'anywhere' }}>
          <div>{NEXUS_MODEL_STATE.parameters} parameters · {NEXUS_MODEL_STATE.contextTokens}-token window · up to {NEXUS_MODEL_STATE.maxCalls} tool calls per answer · trained from scratch</div>
          <div>checkpoint sha256 {NEXUS_MODEL_STATE.sha256.slice(0, 16)}…</div>
          <div data-testid="nexus-model-graded">graded {NEXUS_MODEL_STATE.graded.on}: {NEXUS_MODEL_STATE.graded.verdict} · gate {NEXUS_MODEL_STATE.graded.gate}</div>
          <div>v1 {NEXUS_MODEL_STATE.graded.v1.hits}/{NEXUS_MODEL_STATE.graded.v1.n} ({pct(NEXUS_MODEL_STATE.graded.v1)}) · domains {NEXUS_MODEL_STATE.graded.domains.hits}/{NEXUS_MODEL_STATE.graded.domains.n} ({pct(NEXUS_MODEL_STATE.graded.domains)}) · closed loop {NEXUS_MODEL_STATE.graded.closedLoop.hits}/{NEXUS_MODEL_STATE.graded.closedLoop.n} · fabrication {NEXUS_MODEL_STATE.graded.fabrication}</div>
        </div>
        <div style={{ color: '#555', fontSize: '10px', marginTop: '8px', lineHeight: 1.6 }}>From {NEXUS_MODEL_STATE.graded.source}. This is the checkpoint the app serves; later training runs are not shown until one replaces it. The numbers below count the records in this browser. They are not the checkpoint's training set.</div>
      </section>

      <section style={{ ...card, borderColor: '#2a1a05' }} aria-label="Evidence-backed knowledge" data-testid="nexus-llm-road">
        <div style={heading}>EVIDENCE-BACKED KNOWLEDGE · in this browser</div>
        <div style={{ color: '#eee', fontFamily: mono, fontSize: '13px', marginBottom: '6px' }}>
          {training.toLocaleString()} evidence-backed knowledge record{training === 1 ? '' : 's'}
        </div>
        <div style={{ color: '#888', fontSize: '11px', lineHeight: 1.6 }}>
          {coverage.awaitingEvidence.toLocaleString()} record(s) with no evidence yet · stored candidate data covers {coverage.toolCoverage} recorded tool(s) · {approved.toLocaleString()} admitted in all, counting entries admitted other ways
        </div>
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
        <div style={{ color: '#666', fontSize: '10px', marginTop: '6px', lineHeight: 1.6 }}>Assumptions counts prompt-eligible recurring failures · Heuristics counts active owner rules · First Principles and Extension count auto-added knowledge by phase · Convergence counts all auto-added knowledge. Visitors&apos; input never converges.</div>
      </section>

      <section aria-label="Evidence totals" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '10px' }}>
        <div style={card} data-testid="nexus-recorded"><div style={heading}>{t('nexus.recorded')}</div><div style={{ color: '#eee', fontSize: '22px', fontFamily: mono }}>{summary.total}</div></div>
        {OUTCOMES.map(o => (
          <button key={o} onClick={() => setFilter(filter === o ? 'all' : o)} style={{ ...card, textAlign: 'left', cursor: 'pointer', borderColor: filter === o ? OUTCOME_COLOR[o] : '#1e1e1e' }} aria-pressed={filter === o}>
            <div style={{ ...heading, color: OUTCOME_COLOR[o] }}>{o}</div>
            <div style={{ color: '#eee', fontSize: '22px', fontFamily: mono }}>{summary.byOutcome[o]}</div>
          </button>
        ))}
        <div style={card}><div style={heading}>{t('nexus.failureRate')}</div><div style={{ color: summary.failureRate > 0.3 ? '#ef4444' : '#39ff14', fontSize: '22px', fontFamily: mono }}>{Math.round(summary.failureRate * 100)}%</div></div>
        <div style={card}><div style={heading}>{t('nexus.admitted')}</div><div style={{ color: '#eee', fontSize: '22px', fontFamily: mono }}>{approved}</div></div>
      </section>

      <div data-testid="nexus-stored-note" style={{ color: '#555', fontSize: '10px', fontFamily: 'monospace', lineHeight: 1.6 }}>
        Counted from the {summary.total.toLocaleString()} record(s) stored in this browser now{stored !== summary.total ? ` (${stored.toLocaleString()} indexed; ${(stored - summary.total).toLocaleString()} could not be read)` : ''}. Backend: {storageStatus.backend === 'indexeddb' ? 'IndexedDB' : 'localStorage fallback'} · migration: {storageStatus.migration}. When storage fills, the oldest records without evidence are removed, so these are not all-time totals.
      </div>
      {storageStatus.migration === 'failed' && (
        <div role="alert" data-testid="nexus-storage-migration-error" style={{ ...card, borderColor: '#7f1d1d', color: '#fca5a5', fontFamily: mono, fontSize: '11px' }}>
          Corpus storage migration was not verified; legacy records were kept intact. No partial move is being presented as complete. {storageStatus.error ? `Reason: ${storageStatus.error}` : ''}
        </div>
      )}

      <section style={card} aria-label="Learning growth" data-testid="nexus-growth">
        <div style={heading}>LEARNING GROWTH · recorded vs admitted, from the stored records</div>
        <NexusGrowthGraph candidates={candidates} knowledge={knowledge} />
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
          <HoldToConfirmButton onConfirm={() => setTaste(resetTaste())} title="Hold to reset your taste profile" style={{ background: 'none', border: '1px solid #3a1a1a', color: '#a55', borderRadius: '4px', padding: '3px 8px', cursor: 'pointer', fontSize: '10px', fontFamily: 'monospace', marginTop: '4px' }}>RESET TASTE</HoldToConfirmButton>
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
                {active.map(rule => {
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
        {notInPrompt > 0 && <div data-testid="nexus-heuristics-outside" style={{ color: '#888', fontSize: '11px', marginTop: '6px' }}>{notInPrompt} more rule(s) are in older records and are NOT given to the models: a prompt reads the newest {PROMPT_CANDIDATE_WINDOW} records and carries at most {MAX_PROMPT_HEURISTICS} rules. Start a line with "rule:" to state one again.</div>}
      </section>

      <section style={card} aria-label="Knowledge" data-testid="nexus-knowledge">
        <div style={heading}>KNOWLEDGE · what NEXUS treats as known ({knowledge.length})</div>
        <div style={{ color: '#666', fontSize: '11px', marginBottom: '8px' }}>These entries guide the models as stored knowledge. Only evidence-backed auto-added entries are counted as training data above; admitted legacy or other entries are not.</div>
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
                <HoldToConfirmButton onConfirm={() => { if (corpusRepository.removeKnowledge(k.id)) { setKnowledgeTick(n => n + 1); refresh() } }} title="Hold to remove this from what NEXUS knows" style={{ background: 'none', border: '1px solid #3a1a1a', color: '#a55', borderRadius: '4px', padding: '3px 8px', cursor: 'pointer', fontSize: '10px', fontFamily: 'monospace' }}>REMOVE</HoldToConfirmButton>
              </div>
            ))}
      </section>

      <section style={card} aria-label="Lessons">
        <div style={heading}>{t('nexus.lessonsTitle')}</div>
        {fedBack.length === 0
          ? <div style={{ color: '#555', fontSize: '12px' }}>{t('nexus.noLessons')}</div>
          : <ul style={{ margin: 0, paddingLeft: '18px', color: '#ccc', fontSize: '12px', lineHeight: 1.7 }}>
              {fedBack.map(l => <li key={`${l.tool}${l.pattern}`}><b style={{ color: '#f97316' }}>{l.tool}</b> ×{l.ownerCount}: <span style={{ fontFamily: mono }}>{l.pattern}</span> <span style={{ color: '#555' }}>(last {l.lastSeen.slice(0, 10)})</span></li>)}
            </ul>}
        <div data-testid="nexus-lessons-note" style={{ color: '#666', fontSize: '10px', marginTop: '6px', lineHeight: 1.6 }}>Counted from your own runs in the newest {PROMPT_CANDIDATE_WINDOW} records, which is what a prompt reads. A model sees a lesson only when that tool is offered, at most {MAX_PROMPT_LESSONS} per turn.{otherRecurring > 0 ? ` ${otherRecurring} other recurring failure(s) are recorded but not fed back (visitors' runs, or older than that window).` : ''}</div>
      </section>

      <section style={card} aria-label="Tool reliability">
        <div style={heading}>{t('nexus.toolsTitle')}</div>
        {summary.tools.length === 0
          ? <div style={{ color: '#555', fontSize: '12px' }}>{t('nexus.noTools')}</div>
          : <div style={{ overflowX: 'auto' }} data-testid="nexus-tools-scroll"><table style={{ width: '100%', minWidth: '400px', borderCollapse: 'collapse', fontSize: '12px', fontFamily: mono, color: '#bbb' }}>
              <thead><tr style={{ color: '#666', textAlign: 'left' }}><th>{t('nexus.colTool')}</th><th>{t('nexus.colRuns')}</th><th>{t('nexus.colOk')}</th><th>{t('nexus.colAttempted')}</th><th>{t('nexus.colFailed')}</th><th>{t('nexus.colBlocked')}</th><th>UNMEASURED</th><th>{t('nexus.colReliability')}</th></tr></thead>
              <tbody>{summary.tools.slice(0, 20).map(t => (
                <tr key={t.tool} style={{ borderTop: '1px solid #161616' }}>
                  <td style={{ padding: '4px 0' }}>{t.tool}</td><td>{t.total}</td><td>{t.completed}</td><td>{t.attempted}</td><td>{t.failed}</td><td>{t.blocked}</td><td>{t.unmeasured}</td>
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
                    {c.metadata?.origin === 'external-intake' && (
                      <div style={{ color: '#555', fontSize: '10px', fontFamily: 'monospace', overflowWrap: 'anywhere' }}>
                        EXTERNAL INTAKE · {c.metadata.intakeSource} · {c.metadata.kind} · run {c.metadata.run}
                        {c.metadata.link
                          ? <> · <a href={c.metadata.link} target="_blank" rel="noreferrer" style={{ color: '#777' }}>provenance</a></>
                          : c.metadata.provenance ? ` · ${c.metadata.provenance}` : ''}
                      </div>
                    )}
                  </div>
                  {c.admissionStatus !== 'rejected' && <HoldToConfirmButton onConfirm={() => void reject(c)} title={auto ? 'Hold to remove this from what NEXUS knows; it will not be added again' : 'Hold to reject this candidate'} style={{ background: 'none', border: '1px solid #3a1a1a', color: '#a55', borderRadius: '4px', padding: '3px 8px', cursor: 'pointer', fontSize: '10px', fontFamily: 'monospace' }}>{auto ? 'REMOVE' : t('nexus.reject')}</HoldToConfirmButton>}
                </div>
              )
            })}
      </section>
    </div>
  )
}
