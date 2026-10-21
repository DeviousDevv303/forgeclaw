// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── NEXUS learns from browsing ─────────────────────────────────────────────────────────────────
// Every browser round becomes a compact, secret-free PLAYBOOK record: the site, the goal, the steps that worked (or the
// step that failed and why). It is an unapproved candidate like everything NEXUS records; when the owner approves it,
// it is retained knowledge that (a) the browsing agent reads before its next browse and (b) DeepSeek receives through
// NEXUS guidance when a task is about the same site. Typed text is never stored (a typed value may be personal), and page
// text is not stored at all: only the shape of what worked.

import { corpusRepository, type CorpusRecord } from './corpus'
import { buildLearningEvent } from './learningEvents'
import type { BrowserAction } from './browserAgent'

export const BROWSER_PLAYBOOK_SOURCE = 'learning:browser'
const MAX_STEPS = 14

export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

/** One readable line per action, with typed values left out. */
export function describeAction(a: BrowserAction): string {
  switch (a.type) {
    case 'goto': { const u = (() => { try { return new URL(a.url) } catch { return null } })(); return `goto ${u ? `${u.hostname}${u.pathname === '/' ? '' : u.pathname}` : a.url}` }
    case 'click': return `click ${a.role ?? 'element'} "${(a.name ?? a.text ?? a.selector ?? '').slice(0, 60)}"`
    case 'type': return `type into "${(a.label ?? a.placeholder ?? a.name ?? a.selector ?? '').slice(0, 60)}" (text not stored)${a.submit ? ' then submit' : ''}`
    case 'press': return `press ${a.key}`
    case 'scroll': return `scroll ${a.direction}`
    case 'wait': return 'wait'
    case 'back': return 'go back'
  }
}

export interface BrowserRoundFacts {
  goal?: string
  accepted: BrowserAction[]
  finalUrl: string
  title: string
  ok: boolean
  failedStep?: { type: string; note?: string }
}

/** The playbook text. Pure. Empty when there is nothing worth keeping (a bare page load). */
export function browserPlaybook(f: BrowserRoundFacts): string {
  const host = hostOf(f.finalUrl) || hostOf((f.accepted.find(a => a.type === 'goto') as { url: string } | undefined)?.url ?? '')
  if (!host) return ''
  if (f.ok && f.accepted.length < 2) return ''
  const steps = f.accepted.slice(0, MAX_STEPS).map((a, i) => `${i + 1}. ${describeAction(a)}`)
  const goal = f.goal ? ` — goal: ${f.goal.replace(/\s+/g, ' ').slice(0, 160)}` : ''
  // A failure's first line is the pattern NEXUS counts across runs, so it names the host and the failed step, not the goal.
  const head = f.ok
    ? `Browser playbook for ${host}${goal}`
    : `Browser ${host}: ${f.failedStep ? `${f.failedStep.type} failed (${(f.failedStep.note ?? 'unknown').slice(0, 100)})` : 'stopped early'}`
  return [
    head,
    ...(f.ok ? [`Worked: ended on "${f.title.slice(0, 80)}" (${f.finalUrl.slice(0, 120)}).`] : [`Goal: ${goal.replace(/^ — goal: /, '') || '(not given)'}`, 'The steps before it worked; the step above did not.']),
    'Steps that worked, in order:',
    ...steps,
  ].join('\n')
}

/** Record the round as an unapproved NEXUS candidate. Best-effort: never breaks the browsing itself. */
export async function recordBrowserLearning(f: BrowserRoundFacts, who: { runtime: string; model: string }): Promise<boolean> {
  const text = browserPlaybook(f)
  if (!text) return false
  try {
    const host = hostOf(f.finalUrl)
    await corpusRepository.appendInteraction({
      ...buildLearningEvent({ channel: 'tool', input: `browser_playbook ${host}${f.goal ? ` ${f.goal.slice(0, 160)}` : ''}`, result: text, outcome: f.ok ? 'completed' : 'failed', runtime: who.runtime, model: who.model, toolName: 'browser_playbook', actor: 'agent' }),
      source: BROWSER_PLAYBOOK_SOURCE,
    })
    return true
  } catch { return false }
}

/** Approved playbooks that match this request, for the browsing agent's prompt. Owner-approved only, never visitors'. */
export function browserPlaybooksForPrompt(task: string, retrieve: (q: string, n: number) => CorpusRecord[] = (q, n) => corpusRepository.retrieve(q, n)): string {
  const found = retrieve(task, 8).filter(r => r.source === BROWSER_PLAYBOOK_SOURCE).slice(0, 2)
  if (!found.length) return ''
  return 'NEXUS BROWSING PLAYBOOKS (what worked before, approved by the owner; the page may have changed, so verify each step):\n' +
    found.map(r => r.content.slice(0, 700)).join('\n---\n')
}
