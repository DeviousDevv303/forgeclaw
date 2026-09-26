// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Coding Agent State Panel ────────────────────────────────────────────────
// Surfaces the persisted task so a reload is visible as a resume, not a silent
// reset. Deliberately factual: identity, task, repo, branch, HEAD, step lists,
// verification, blockers and a short activity trail. No reasoning display.

import { useState } from 'react'
import type { CodingAgentState } from '../lib/codingAgentState'
import { clearCodingAgentState } from '../lib/codingAgentState'
import { FORGECLAW_ORCHESTRATOR_ID } from '../lib/githubAttribution'

interface Props {
  state: CodingAgentState
  resumed: boolean
  onChange: (next: CodingAgentState) => void
}

const STATUS_COLOR: Record<CodingAgentState['taskStatus'], string> = {
  idle: '#666',
  in_progress: '#f97316',
  blocked: '#ef4444',
  complete: '#22c55e',
}

function Row({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  if (!value) return null
  return (
    <div style={{ display: 'flex', gap: '8px', marginBottom: '3px' }}>
      <span style={{ color: '#666', minWidth: '96px', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</span>
      <span style={{ color: '#ccc', fontSize: '11px', fontFamily: mono ? 'monospace' : undefined, wordBreak: 'break-word', flex: 1 }}>{value}</span>
    </div>
  )
}

function ListRow({ label, items, color }: { label: string; items: string[]; color?: string }) {
  if (!items.length) return null
  return (
    <div style={{ marginTop: '6px' }}>
      <div style={{ color: '#666', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '3px' }}>
        {label} ({items.length})
      </div>
      {items.slice(-8).map((item, index) => (
        <div key={`${label}-${index}`} style={{ color: color || '#aaa', fontSize: '11px', fontFamily: 'monospace', marginBottom: '2px', wordBreak: 'break-word' }}>
          • {item}
        </div>
      ))}
    </div>
  )
}

export function CodingAgentStatePanel({ state, resumed, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const active = state.taskStatus !== 'idle' || Boolean(state.task)
  if (!active) return null

  const statusColor = STATUS_COLOR[state.taskStatus]

  return (
    <div style={{ background: '#0a0a0a', border: `1px solid ${statusColor}44`, borderRadius: '6px', padding: '10px', marginBottom: '10px', fontFamily: 'monospace' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <span style={{ color: statusColor, fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px' }}>
            {state.taskStatus.replace('_', ' ')}
          </span>
          <span style={{ color: '#888', fontSize: '10px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {state.task ? state.task.slice(0, 70) : state.agentLabel}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
          {resumed && (
            <span style={{ background: '#1e3a5f', color: '#93c5fd', border: '1px solid #334155', borderRadius: '3px', padding: '2px 6px', fontSize: '9px' }}>
              RESUMED
            </span>
          )}
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            style={{ background: '#1a1a1a', border: '1px solid #333', color: '#888', borderRadius: '3px', padding: '2px 8px', cursor: 'pointer', fontSize: '9px' }}
          >
            {open ? 'HIDE' : 'STATE'}
          </button>
        </div>
      </div>

      {open && (
        <div style={{ marginTop: '10px', borderTop: '1px solid #1a1a1a', paddingTop: '8px' }}>
          <Row label="agent" value={`${state.agentLabel} (${state.agentId})`} />
          <Row label="attributed" value={`${FORGECLAW_ORCHESTRATOR_ID} — every repo write`} />
          <Row label="repo" value={`${state.owner}/${state.repo}`} />
          <Row label="branch" value={state.branch} />
          <Row label="head" value={state.headShaShort || state.headSha || '(unknown)'} />
          <Row label="task" value={state.task} />
          <Row label="instr" value={state.taskInstructions} />
          <Row label="updated" value={state.updatedAt} />
          <ListRow label="completed" items={state.completedSteps} color="#22c55e" />
          <ListRow label="pending" items={state.pendingSteps} color="#f97316" />
          <ListRow label="files modified" items={state.filesModified} />
          <ListRow label="verification" items={state.verificationResults} color="#22c55e" />
          <ListRow label="tests" items={state.lastTestRuns.map(r => `${r.command} → ${r.conclusion}`)} />
          <ListRow label="blockers" items={state.blockers} color="#ef4444" />
          <ListRow label="errors" items={state.errors} color="#ef4444" />
          <ListRow label="activity" items={state.activity.slice(-6).map(a => `${a.label}${a.detail ? ` — ${a.detail}` : ''}`)} />
          {state.continuationNotes && <Row label="next" value={state.continuationNotes} />}
          <button
            type="button"
            onClick={() => { clearCodingAgentState(); onChange({ ...state, task: '', taskStatus: 'idle', completedSteps: [], pendingSteps: [], blockers: [], errors: [], activity: [] }) }}
            style={{ marginTop: '10px', background: '#1a1a1a', border: '1px solid #333', color: '#888', borderRadius: '3px', padding: '4px 10px', cursor: 'pointer', fontSize: '10px' }}
          >
            CLEAR PERSISTED TASK
          </button>
        </div>
      )}
    </div>
  )
}