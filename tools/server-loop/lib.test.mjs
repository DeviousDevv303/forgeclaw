// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

/**
 * Server loop Stage 1 — unit + fixture tests for the pure logic layer.
 * Vitest, like every other suite in this repo:
 *   npx vitest run tools/server-loop/lib.test.mjs
 *
 * The GitHub fixtures under fixtures/github/ are recorded API shapes
 * (comment / pull / check-runs / commit objects, and a live version.json
 * capture), so the state adapter is exercised against the field layout
 * the runner actually meets, not an imagined one.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  buildMentionReply,
  classifyCall,
  decide,
  findUnansweredCalls,
  isAnswered,
  parseCalls,
  rollupChecks,
  stateFromApi,
} from './lib.mjs'

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/github/${name}`, import.meta.url), 'utf8'))

const OWNER = 'DeviousDevv303'
let nextId = 7000000000
/** A comment object in the recorded REST shape (see fixtures/github/comment.json). */
const comment = (body, { author = OWNER, at = '2026-10-23T12:00:00Z' } = {}) => ({
  id: (nextId += 1),
  body,
  created_at: at,
  updated_at: at,
  user: { login: author, id: 266008141, type: 'User', site_admin: false },
  author_association: 'OWNER',
})
const callComment = (id, text) =>
  comment(`@ForgeClaw — ${text}\n\n<!-- forgeclaw-call:v1 id=${id} -->`)

const fixtureState = () =>
  stateFromApi({
    mainCommit: fixture('main-commit.json'),
    pulls: fixture('pulls.json'),
    checkRunsBySha: {
      '12d75cc48d4533a22266537f875606d42e960643': fixture('check-runs.json'),
      'a096a430ccd85e3ce82543d05fa03a8fc638a492': fixture('check-runs-failing.json'),
    },
    version: fixture('version.json'),
  })

const NOW = '2026-10-23T18:00:00Z'
const decideOn = (comments, state = fixtureState()) =>
  decide({ comments, state, now: NOW, repoSlug: 'DeviousDevv303/forgeclaw', runId: 'test-run', owner: OWNER })

describe('parseCalls', () => {
  it('extracts calls oldest-first, strips the marker into taskText', () => {
    const a = callComment('fc-report-001', 'report the board state')
    const b = callComment('fc-report-002', 'list open PRs')
    const calls = parseCalls([b, a], { owner: OWNER })
    expect(calls.map((c) => c.id)).toEqual(['fc-report-001', 'fc-report-002'])
    expect(calls[0].taskText).toContain('report the board state')
    expect(calls[0].taskText).not.toContain('forgeclaw-call')
  })

  it('watch-timer ids are not the loop\u2019s calls', () => {
    const wake = callComment('watch-19000000001', 'wake call from the watch timer')
    expect(parseCalls([wake], { owner: OWNER })).toEqual([])
  })

  it('only owner-authored comments count; prose markers do not', () => {
    const stranger = callComment('fc-stranger-1', 'report status')
    stranger.user.login = 'someone-else'
    const prose = comment('the format is forgeclaw-call:v1 id=fc-fake (no comment markers)')
    expect(parseCalls([stranger, prose], { owner: OWNER })).toEqual([])
  })
})

describe('answered tracking', () => {
  it('a later comment naming the id answers the call; an earlier one does not', () => {
    const early = comment('pre-note about fc-report-001')
    const call = callComment('fc-report-001', 'report the board state')
    const answer = comment('Answering channel call `fc-report-001` — done.')
    const parsed = parseCalls([call], { owner: OWNER })[0]
    expect(isAnswered(parsed, [early, call, answer])).toBe(true)
    expect(isAnswered(parsed, [early, call])).toBe(false)
  })

  it('with the owner known, only the owner or the loop’s marked post can answer; an agent quoting the id cannot', () => {
    const call = callComment('fc-q', 'report status')
    const parsed = parseCalls([call], { owner: OWNER })[0]
    const agentQuote = comment('Kimi here: about `fc-q`, I think…', { author: 'github-actions[bot]' })
    const stranger = comment('fc-q is done', { author: 'someone-else' })
    expect(isAnswered(parsed, [call, agentQuote, stranger], { owner: OWNER })).toBe(false)
    expect(findUnansweredCalls([call, agentQuote, stranger], { owner: OWNER }).map((c) => c.id)).toEqual(['fc-q'])
    const loopPost = comment(`Answering channel call \`fc-q\`\n<!-- forgeclaw-loop:v1 answered=fc-q -->`, { author: 'github-actions[bot]' })
    expect(isAnswered(parsed, [call, agentQuote, loopPost], { owner: OWNER })).toBe(true)
    const loopRefusal = comment(`Refusing \`fc-q\`\n<!-- forgeclaw-loop:v1 refused=fc-q -->`, { author: 'github-actions[bot]' })
    expect(isAnswered(parsed, [call, loopRefusal], { owner: OWNER })).toBe(true)
    // A marker for another call does not answer this one.
    const otherMarker = comment(`about fc-q <!-- forgeclaw-loop:v1 answered=fc-other -->`, { author: 'github-actions[bot]' })
    expect(isAnswered(parsed, [call, otherMarker], { owner: OWNER })).toBe(false)
    expect(isAnswered(parsed, [call, comment('Answering `fc-q`.')], { owner: OWNER })).toBe(true)
  })

  it('answered calls drop out, unanswered stay in order', () => {
    const a = callComment('fc-a', 'report status')
    const b = callComment('fc-b', 'list open PRs')
    const ans = comment('Answering channel call `fc-a`.')
    expect(findUnansweredCalls([a, b, ans], { owner: OWNER }).map((c) => c.id)).toEqual(['fc-b'])
  })
})

describe('classifyCall', () => {
  it('report-class asks about state', () => {
    expect(classifyCall('report the current board state').kind).toBe('report')
    expect(classifyCall('what is the deployed version?').kind).toBe('report')
    expect(classifyCall('list open PRs with their heads').kind).toBe('report')
    expect(classifyCall('verify main HEAD against the deployed site').kind).toBe('report')
  })

  it('reports ABOUT merges are reports, not merge requests', () => {
    expect(classifyCall('report which PRs are merge-ready').kind).toBe('report')
    expect(classifyCall('report the merge commit that landed #255').kind).toBe('report')
    expect(classifyCall('what is the status of the Kalshi key in Settings?').kind).toBe('report')
  })

  it('Guardian classes refuse — merge, money, credentials', () => {
    expect(classifyCall('merge #254')).toEqual({ kind: 'refuse', guard: 'merge' })
    expect(classifyCall('please merge PR #251 now')).toEqual({ kind: 'refuse', guard: 'merge' })
    expect(classifyCall('merge the pull request, then report status')).toEqual({ kind: 'refuse', guard: 'merge' })
    expect(classifyCall('place a Kalshi order for 10 contracts')).toEqual({ kind: 'refuse', guard: 'money' })
    expect(classifyCall('buy 10 Yes at 50c on the NYC market')).toEqual({ kind: 'refuse', guard: 'money' })
    expect(classifyCall('transfer funds to the sports shard')).toEqual({ kind: 'refuse', guard: 'money' })
    expect(classifyCall('paste the API key into Settings for me')).toEqual({ kind: 'refuse', guard: 'credentials' })
  })

  it('execution-class asks are Stage 2\u2019s, classified other', () => {
    expect(classifyCall('refactor the corpus parser and open a draft PR').kind).toBe('other')
    expect(classifyCall('why did the build die last night?').kind).toBe('other')
  })
})

describe('rollupChecks + state assembly', () => {
  it('failure beats pending beats success; empty is none', () => {
    expect(rollupChecks(fixture('check-runs.json'))).toBe('success')
    expect(rollupChecks(fixture('check-runs-failing.json'))).toBe('pending')
    expect(rollupChecks({ check_runs: [{ status: 'completed', conclusion: 'failure' }] })).toBe('failure')
    expect(rollupChecks({ check_runs: [] })).toBe('none')
    expect(rollupChecks(undefined)).toBe('none')
  })

  it('stateFromApi: PR entries carry head, readiness, CI word', () => {
    const state = fixtureState()
    expect(state.mainSha).toBe('c806e1da6879143ae3ba56ce09de81b7bb2bf1d3')
    expect(state.prs).toHaveLength(2)
    expect(state.prs[0].ci).toBe('success')
    expect(state.prs[1].ci).toBe('pending')
    expect(state.prs[1].draft).toBe(true)
  })
})

describe('decide (end-to-end over fixture threads)', () => {
  it('quiet board (no calls) posts nothing', () => {
    expect(decideOn([comment('lane chatter, no calls here')]).action).toBe('quiet')
  })

  it('quiet board (every call answered) posts nothing', () => {
    const call = callComment('fc-done-1', 'report the board state')
    const ans = comment('Answering channel call `fc-done-1`.')
    expect(decideOn([call, ans]).action).toBe('quiet')
  })

  it('an unanswered report call gets a signed answer naming the id', () => {
    const d = decideOn([callComment('fc-report-009', 'report the board state')])
    expect(d.action).toBe('answer')
    expect(d.post).toContain('`fc-report-009`')
    expect(d.post).toContain('forgeclaw-loop:v1 answered=fc-report-009')
    expect(d.post).toContain('c806e1da')
    expect(d.post).toContain('#254')
    expect(d.post).toContain('no model calls were made')
  })

  it('duplicate tick — the answer appended, the next tick is quiet', () => {
    const thread = [callComment('fc-report-010', 'report the board state')]
    const first = decideOn(thread)
    expect(first.action).toBe('answer')
    expect(decideOn([...thread, comment(first.post)]).action).toBe('quiet')
  })

  it('a Guardian call older than a report call is refused first', () => {
    const merge = callComment('fc-merge-1', 'merge #254')
    const report = callComment('fc-report-011', 'report the board state')
    const d = decideOn([merge, report])
    expect(d.action).toBe('refuse')
    expect(d.guard).toBe('merge')
    expect(d.post).toContain('forgeclaw-loop:v1 refused=fc-merge-1')
    expect(d.post).toContain('Nothing was executed.')
  })

  it('the refusal also counts as answered — no re-refusal next tick', () => {
    const thread = [callComment('fc-merge-2', 'merge #254')]
    const first = decideOn(thread)
    expect(first.action).toBe('refuse')
    expect(decideOn([...thread, comment(first.post)]).action).toBe('quiet')
  })

  it('other-class calls are left untouched; a later report call still runs', () => {
    const code = callComment('fc-code-1', 'refactor the corpus parser and open a draft PR')
    const report = callComment('fc-report-012', 'report the board state')
    const d = decideOn([code, report])
    expect(d.action).toBe('answer')
    expect(d.call.id).toBe('fc-report-012')
    expect(decideOn([code]).action).toBe('quiet')
  })

  it('an unanswered watch-timer wake is ignored, not answered', () => {
    const wake = callComment('watch-19000000009', 'wake call from the watch timer')
    expect(decideOn([wake]).action).toBe('quiet')
  })
})

describe('@ForgeClaw mentions (Channel Watch)', () => {
  const reply = (text) => buildMentionReply({ text, state: fixtureState(), now: NOW, repoSlug: 'DeviousDevv303/forgeclaw', runId: 'cw-1' })

  it('a report ask gets the live verified state, signed, with no loop marker', () => {
    const r = reply('@ForgeClaw report the board state')
    expect(r.kind).toBe('report')
    expect(r.body).toContain('Verified live repo state for **DeviousDevv303/forgeclaw**')
    expect(r.body).toContain('Channel Watch run cw-1')
    expect(r.body).not.toContain('forgeclaw-loop:v1')
  })

  it('a Guardian-class ask is refused by the same classifier the loop uses', () => {
    for (const [text, words] of [['@ForgeClaw merge PR #12', 'merging a pull request'], ['@ForgeClaw place an order on Kalshi', 'moving money or placing an order'], ['@ForgeClaw paste the API key here', 'handling credentials']]) {
      const r = reply(text)
      expect(r.kind, text).toBe('refuse')
      expect(r.body, text).toContain(`This asks for ${words}.`)
      expect(r.body, text).toContain('Nothing was executed.')
    }
  })

  it('anything else says plainly that Stage 1 cannot do it', () => {
    const r = reply('@ForgeClaw refactor the funds ledger')
    expect(r.kind).toBe('other')
    expect(r.body).toContain('Stage 2 (model-driven work) is not built yet, so nothing was done.')
  })

  it('a mention reply never answers a channel call', () => {
    const call = callComment('fc-m', 'report status')
    const parsed = parseCalls([call], { owner: OWNER })[0]
    const posted = comment(`${reply('@ForgeClaw report status fc-m').body}`, { author: 'github-actions[bot]' })
    expect(isAnswered(parsed, [call, posted], { owner: OWNER })).toBe(false)
  })
})
