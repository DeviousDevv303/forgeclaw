import { describe, expect, it, vi } from 'vitest'
import { buildLearningEvent, MAX_LEARNING_FIELD_CHARS, outcomeFromToolOutput, recordLearningEvent, recordVerifiedProposal, type LearningRecorder, type VerifiedProposalInput, type VerifiedProposalRecorder } from './learningEvents'

const base = { channel: 'tool' as const, input: 'memory_read key="a"', result: 'ok', outcome: 'completed' as const, runtime: 'corpus', model: 'qwen' }

describe('outcomeFromToolOutput', () => {
  it('treats normal output as completed, never verified', () => expect(outcomeFromToolOutput('listing…')).toBe('completed'))
  it('treats tool errors as failed', () => expect(outcomeFromToolOutput('[TOOL ERROR] nope')).toBe('failed'))
  it('treats ✗ output as failed', () => expect(outcomeFromToolOutput('✗ exit 2')).toBe('failed'))
  it('treats Guardian refusals as blocked', () => {
    expect(outcomeFromToolOutput('[GUARDIAN BLOCK] needs co-sign')).toBe('blocked')
    expect(outcomeFromToolOutput('[GUARDIAN REJECTED] no')).toBe('blocked')
  })
})

describe('buildLearningEvent', () => {
  it('stamps channel, outcome and the unapproved admission marker', () => {
    const built = buildLearningEvent({ ...base, toolName: 'memory_read', actor: 'operator' })
    expect(built.source).toBe('learning:tool')
    expect(built.metadata).toMatchObject({ channel: 'tool', outcome: 'completed', tool: 'memory_read', actor: 'operator', admission: 'unapproved' })
    expect(built.context).toContain('outcome=completed')
  })
  it('defaults voice-channel events to voice origin and others to typed', () => {
    expect(buildLearningEvent({ ...base, channel: 'voice', lineage: 'none' }).metadata?.origin).toBe('voice')
    expect(buildLearningEvent(base).metadata?.origin).toBe('typed')
  })
  it('redacts secrets in input and result and flags it', () => {
    const built = buildLearningEvent({ ...base, input: 'curl -H "Authorization: Bearer abc123" with ghp_abcdef1234567890', result: 'token=sk-live-123' })
    expect(built.input).not.toMatch(/abc123|ghp_abcdef/)
    expect(built.result).not.toContain('sk-live-123')
    expect(built.metadata?.redacted_or_truncated).toBe('true')
  })
  it('bounds long text', () => {
    const built = buildLearningEvent({ ...base, result: 'x'.repeat(MAX_LEARNING_FIELD_CHARS * 3) })
    expect(built.result.length).toBeLessThanOrEqual(MAX_LEARNING_FIELD_CHARS)
  })
  it('keeps outcomes distinct in the hashed context', () => {
    expect(buildLearningEvent(base).context).not.toBe(buildLearningEvent({ ...base, outcome: 'failed' }).context)
  })
})

describe('recordLearningEvent', () => {
  it('appends through the repository', async () => {
    const seen: unknown[] = []
    const recorder: LearningRecorder = { appendInteraction: async input => { seen.push(input) } }
    expect(await recordLearningEvent(base, recorder)).toBe(true)
    expect(seen).toHaveLength(1)
  })
  it('skips blank input', async () => {
    const recorder: LearningRecorder = { appendInteraction: async () => { throw new Error('should not run') } }
    expect(await recordLearningEvent({ ...base, input: '  ' }, recorder)).toBe(false)
  })
  it('never throws when storage fails', async () => {
    const recorder: LearningRecorder = { appendInteraction: async () => { throw new Error('quota') } }
    expect(await recordLearningEvent(base, recorder)).toBe(false)
  })
})

describe('recordVerifiedProposal', () => {
  const proposal: VerifiedProposalInput = {
    toolName: 'shell_patch',
    request: 'Fix the parser',
    files: ['src/parser.ts', '', 'src/parser.test.ts'],
    change: 'diff --git a/src/parser.ts b/src/parser.ts\n+token=sk-live-secret',
    changeKind: 'unified-diff',
    selectedProvider: 'selected-model',
    actingProvider: 'acting-model',
    workflow: 'shell-repair.yml',
    workflowRunId: 42,
    workflowRunUrl: 'https://github.com/acme/forge/actions/runs/42',
    pullRequestNumber: 77,
    pullRequestUrl: 'https://github.com/acme/forge/pull/77',
  }

  function fakeRecorder() {
    const appendShellExperience = vi.fn<VerifiedProposalRecorder['appendShellExperience']>(async input => {
      void input
      return { candidate: { id: 'candidate-1' } }
    })
    return { recorder: { appendShellExperience } satisfies VerifiedProposalRecorder, appendShellExperience }
  }

  it('sanitizes secrets, bounds stored fields, and preserves verified-proposal provenance', async () => {
    const { recorder, appendShellExperience } = fakeRecorder()
    const longProposal = {
      ...proposal,
      request: 'x'.repeat(5_000),
      files: ['src/parser.ts', 'f'.repeat(1_200)],
      change: `token=${'z'.repeat(5_000)}`,
      selectedProvider: 's'.repeat(300),
      actingProvider: 'acting-model',
      workflow: 'w'.repeat(300),
      workflowRunUrl: `https://example.test/${'u'.repeat(1_200)}`,
      pullRequestUrl: `https://example.test/${'p'.repeat(1_200)}`,
    }

    const result = await recordVerifiedProposal(longProposal, recorder)
    expect(result).toEqual({ stored: true, candidateId: 'candidate-1' })
    expect(appendShellExperience).toHaveBeenCalledOnce()
    const stored = appendShellExperience.mock.calls[0][0]
    expect(stored.input).toHaveLength(MAX_LEARNING_FIELD_CHARS)
    expect(stored.input).toBe('x'.repeat(MAX_LEARNING_FIELD_CHARS))
    expect(stored.context).toContain('src/parser.ts')
    expect(stored.context.split('\n')[0]).toHaveLength(1_007) // "Files: " plus the 1,000-character bound
    expect(stored.context).not.toContain('z'.repeat(16))
    expect(stored.context).toContain('[REDACTED secret]')
    expect(stored.context.length).toBeLessThanOrEqual(MAX_LEARNING_FIELD_CHARS)
    expect(stored.provenance.selected_provider).toHaveLength(160)
    expect(stored.provenance.workflow).toHaveLength(200)
    expect(stored.provenance.workflow_run_url).toHaveLength(1_000)
    expect(stored.provenance.pull_request_url).toHaveLength(1_000)
    expect(stored.provenance).toMatchObject({
      outcome: 'verified',
      admission: 'unapproved',
      tool: 'shell_patch',
      acting_provider: 'acting-model',
      workflow_run_id: '42',
      pull_request_number: '77',
      change_kind: 'unified-diff',
    })
    expect(stored.model).toBe('acting-model')
    expect(stored.source).toBe('forgeclaw:verified-proposal')
    expect(stored.result).toContain('run #42 succeeded')
    expect(stored.result).toContain('pull request #77 was opened')
  })

  it('records only an unapproved shell-experience candidate and returns its id', async () => {
    const { recorder, appendShellExperience } = fakeRecorder()
    const result = await recordVerifiedProposal({ ...proposal, toolName: 'sculpt_self' }, recorder)

    expect(result).toEqual({ stored: true, candidateId: 'candidate-1' })
    expect(appendShellExperience).toHaveBeenCalledWith(expect.objectContaining({
      source: 'forgeclaw:verified-proposal',
      provenance: expect.objectContaining({
        outcome: 'verified', admission: 'unapproved', tool: 'sculpt_self',
        selected_provider: 'selected-model', acting_provider: 'acting-model',
      }),
    }))
  })

  it.each([
    ['request', { request: '  ' }],
    ['workflow run id', { workflowRunId: 0 }],
    ['workflow run URL', { workflowRunUrl: '' }],
    ['pull request number', { pullRequestNumber: 0 }],
    ['pull request URL', { pullRequestUrl: '' }],
  ])('rejects a proposal missing its required %s reference without recording', async (_reference, override) => {
    const { recorder, appendShellExperience } = fakeRecorder()
    const result = await recordVerifiedProposal({ ...proposal, ...override }, recorder)

    expect(result).toEqual({ stored: false })
    expect(appendShellExperience).not.toHaveBeenCalled()
  })

  it('returns stored:false without throwing when candidate storage fails', async () => {
    const recorder: VerifiedProposalRecorder = { appendShellExperience: async () => { throw new Error('quota exceeded') } }

    await expect(recordVerifiedProposal(proposal, recorder)).resolves.toEqual({ stored: false })
  })
})
