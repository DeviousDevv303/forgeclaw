// @vitest-environment jsdom
// 2026-10-25 (owner): NEXUS should be "listening and learning from these simulations on how to do it". It learns each run's
// shape and outcome once, as an unapproved candidate, and never treats a sim's poll as evidence.
import { beforeEach, describe, expect, it } from 'vitest'
import { appendSimRunLearning } from './corpus'
import { answerOutcome, NOT_EVIDENCE_TOOLS } from './nexusConvergence'
import { learnFromSim, SIM_LEARNED_KEY, simLearningInput, type SimRecord } from './mirofishSim'

beforeEach(() => { localStorage.clear() })

const record = (over: Partial<SimRecord> = {}): SimRecord => ({
  attempt: 2, status: 'completed', reason: '', invocation_id: 'spike2-20261025-2', sides: ['Petr Yan', 'Merab Dvalishvili'],
  key: { card_id: 'SPIKE2-UFC333', market_ticker: 'KXUFCFIGHT-26OCT24YANDVA-YAN' },
  seed: { packet_sha256: '896001433a7087c7006c7aedfc42059e08f81b5a3b84d57aa84ebe74c3b711d8', packet_chars: 662 },
  config: { preset: 'tiny', engine_label: 'kimi-k2.6', agents_prepared: 4, simulated_actions: 6, relogged_seed_posts_dropped: 9 },
  extraction: { n: 4, picks: { A: 3, B: 1 }, median_p_a: 53.5 }, usage: { cost_usd: 0.298718, calls: 58 },
  artifacts: { run_url: 'https://github.com/o/r/actions/runs/40241533761' },
  ...over,
})

describe('NEXUS learns from sims', () => {
  it('learns the run\'s shape and outcome, not its poll as a fact', () => {
    expect(simLearningInput(record())).toEqual({
      simKey: 'SPIKE2-UFC333/KXUFCFIGHT-26OCT24YANDVA-YAN/2', invocationId: 'spike2-20261025-2', status: 'completed', reason: '',
      preset: 'tiny', model: 'kimi-k2.6', packetSha256: '896001433a7087c7006c7aedfc42059e08f81b5a3b84d57aa84ebe74c3b711d8', packetChars: 662,
      agents: 4, simulatedActions: 6, reloggedSeedPosts: 9, pollAnswered: 4, costUsd: 0.298718, calls: 58,
      runUrl: 'https://github.com/o/r/actions/runs/40241533761',
    })
  })

  it('a sim record stays an unapproved candidate: it never converges into knowledge on its own', async () => {
    const { candidate } = await appendSimRunLearning(simLearningInput(record())!)
    expect(candidate.admissionStatus).toBe('candidate')
    expect(candidate.metadata.admittedBy).toBeUndefined()
    expect(candidate.source).toBe('mirofish:github-actions')
    expect(candidate.metadata.notEvidence).toBe('true')
    expect(candidate.generatedResult).toMatch(/never evidence about the fight/)
    expect(candidate.input).toContain('[SIM_RUN] SPIKE2-UFC333/KXUFCFIGHT-26OCT24YANDVA-YAN/2, preset tiny, kimi-k2.6; packet 662 chars')
  })

  it('learns a failed run too: how it failed is what the next run needs', async () => {
    const { candidate } = await appendSimRunLearning(simLearningInput(record({ attempt: 1, status: 'failed', reason: '[report] MiroFish answered HTTP 409' }))!)
    expect(candidate.generatedResult).toContain('failed ([report] MiroFish answered HTTP 409)')
  })

  it('viewing a run twice records it once', async () => {
    expect(await learnFromSim(record())).toBe(true)
    expect(await learnFromSim(record())).toBe(false)
    expect(JSON.parse(localStorage.getItem(SIM_LEARNED_KEY)!)).toEqual(['SPIKE2-UFC333/KXUFCFIGHT-26OCT24YANDVA-YAN/2'])
    expect(await learnFromSim(record({ attempt: 3 }))).toBe(true)
  })

  it('a record without its key is not learned', async () => {
    expect(await learnFromSim(record({ key: {} }))).toBe(false)
    expect(localStorage.getItem(SIM_LEARNED_KEY)).toBeNull()
  })

  it('an answer backed only by a sim is "completed", never "verified" evidence', () => {
    expect(NOT_EVIDENCE_TOOLS.has('mirofish_sim')).toBe(true)
    expect(NOT_EVIDENCE_TOOLS.has('mirofish_sim_result')).toBe(true)
    expect(answerOutcome(false, [{ name: 'mirofish_sim_result' }])).toBe('completed')
    expect(answerOutcome(false, [{ name: 'mirofish_sim' }, { name: 'espn_fight_stats' }])).toBe('verified')
  })
})
