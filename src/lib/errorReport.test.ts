// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildErrorReport } from './errorReport'
import { buildLearningEvent } from './learningEvents'
import { toolsForCapability } from './managedAgent'
import { FORGE_TOOLS } from './forgeTools'
import { requiresCoSign } from './guardianGate'
import { ERROR_PLAN_GUIDANCE } from './toolExposure'
import type { LearningCandidate } from './corpus'

function candidate(n: number, tool: string, result: string, outcome = 'failed'): LearningCandidate {
  const event = buildLearningEvent({ channel: 'tool', input: `${tool} ${n}`, result, outcome: outcome as never, runtime: 'moonshot', model: 'kimi-k2.7-code', toolName: tool, actor: 'agent' })
  return { id: `c${n}`, corpusId: 'nexus-local', source: event.source!, content: result, timestamp: `2026-10-20T10:0${n % 10}:00.000Z`, version: n, recordType: 'learning_candidate', integrity: `i${n}`, admissionStatus: 'candidate', metadata: event.metadata!, sourceInteractionId: `x${n}`, runtime: 'moonshot', model: 'kimi-k2.7-code', input: event.input, context: event.context, generatedResult: result }
}

const now = Date.parse('2026-10-21T05:00:00Z')
function github(runs: unknown[], logs: string | null = '2026-10-21T03:39:48Z No commits between main and forge/repair/x\n2026-10-21T03:39:48Z ##[error]Process completed with exit code 1.') {
  return async (url: string) => {
    if (url.includes('/actions/runs?status=failure')) return Response.json({ workflow_runs: runs })
    if (url.endsWith('/actions/runs/5/jobs')) return Response.json({ jobs: [{ id: 77, conclusion: 'failure', steps: [{ name: 'Create labeled pull request', conclusion: 'failure' }] }] })
    if (url.endsWith('/actions/jobs/77/logs')) return logs === null ? new Response('{}', { status: 403 }) : new Response(logs)
    return new Response('{}', { status: 404 })
  }
}
const base = { owner: 'o', repo: 'r', token: 't', now }
const recent = { id: 5, name: 'Shell repair', display_title: 'Shell repair x', head_branch: 'main', created_at: '2026-10-21T03:38:00Z', html_url: 'https://github.com/o/r/actions/runs/5', run_number: 42 }

describe('buildErrorReport', () => {
  it('groups recurring failures and shows the failing step and error text of a recent failed run', async () => {
    const candidates = [1, 2, 3].map(n => candidate(n, 'github_search_code', 'Failed to fetch'))
    const out = await buildErrorReport(github([recent]), { ...base, candidates })
    expect(out).toContain('read-only evidence; nothing was changed')
    expect(out).toMatch(/github_search_code ×3: Failed to fetch/)
    expect(out).toContain('github_search_code 3/3 failed')
    expect(out).toContain('Shell repair #42 on main')
    expect(out).toContain('failed at: Create labeled pull request')
    expect(out).toContain('No commits between main and forge/repair/x')
  })
  it('leaves out runs older than three days, and says when nothing failed', async () => {
    const old = { ...recent, created_at: '2026-10-10T00:00:00Z' }
    const out = await buildErrorReport(github([old]), { ...base, candidates: [] })
    expect(out).toContain('(none recorded)')
    expect(out).toContain('(none failed in that window)')
    expect(out).not.toContain('Shell repair #42')
  })
  it('keeps the run when its log cannot be read, and says so', async () => {
    const out = await buildErrorReport(github([recent], null), { ...base, candidates: [] })
    expect(out).toContain('Shell repair #42')
    expect(out).toContain('could not be read from here')
  })
  it('reports a GitHub problem instead of hiding it', async () => {
    const out = await buildErrorReport(async () => new Response('{}', { status: 403 }), { ...base, candidates: [] })
    expect(out).toContain('Could not list failed runs: GitHub 403')
  })
  it('never lets a token through', async () => {
    const token = 'ghp_' + 'q'.repeat(30)
    const out = await buildErrorReport(github([recent], `x ${token}\n##[error]boom`), { ...base, candidates: [candidate(1, 'shell_exec', `bad ${token}`)] })
    expect(out).not.toContain(token)
  })
})

describe('error_report as a tool', () => {
  it('is offered to coding and read-only agents, needs no co-sign, and changes nothing', () => {
    expect(FORGE_TOOLS.some(t => t.name === 'error_report')).toBe(true)
    expect(toolsForCapability('coding', FORGE_TOOLS).map(t => t.name)).toContain('error_report')
    expect(toolsForCapability('coding-readonly', FORGE_TOOLS).map(t => t.name)).toContain('error_report')
    expect(requiresCoSign({ id: '1', name: 'error_report', input: {} }, 'full-cosign')).toBe(false)
  })
  it('the guidance makes a plan, waits for the owner, and fixes one item per pull request', () => {
    expect(ERROR_PLAN_GUIDANCE).toMatch(/write a PLAN, not a fix/)
    expect(ERROR_PLAN_GUIDANCE).toMatch(/Change NOTHING until the owner says so/)
    expect(ERROR_PLAN_GUIDANCE).toMatch(/one fix per pull request/)
  })
})
