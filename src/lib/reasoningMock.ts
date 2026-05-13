import type { ReasoningData, ReasoningPhase, ReasoningStep, ToolCall } from '../components/reasoning/types'

type ToolCallInput = Omit<ToolCall, 'id'>

const PHASE_SCRIPTS: Array<{
  name: string
  index: 1 | 2 | 3 | 4 | 5
  steps: Array<{ content: string; toolCalls?: ToolCallInput[] }>
}> = [
  {
    name: 'Assumptions',
    index: 1,
    steps: [
      { content: 'The user query implies a need for structured output. Assuming context is fresh with no prior state bleed.' },
      {
        content: 'No ambiguity in intent detected; direct mapping to available capability set.',
        toolCalls: [{
          name: 'context.resolve',
          args: { query: 'user intent', depth: 1 },
          status: 'success',
          result: '{"intent":"structured_output","confidence":0.94}',
          startedAt: 0,
          completedAt: 100,
        }],
      },
    ],
  },
  {
    name: 'Heuristics',
    index: 2,
    steps: [
      { content: 'Pattern match: similar queries resolve via decomposition into sub-tasks rather than a monolithic response.' },
      { content: 'Historical signal: step-by-step output preferred over summary. Bayesian weight: 0.87.' },
    ],
  },
  {
    name: 'First Principles',
    index: 3,
    steps: [
      { content: 'From base axioms: all agent output must be verifiable, scoped, and non-destructive by default.' },
      {
        content: 'Trust budget: local inference deferred to cloud for tasks exceeding complexity threshold θ=0.7.',
        toolCalls: [
          {
            name: 'autonomy.evaluate',
            args: { taskComplexity: 0.82, threshold: 0.7 },
            status: 'success',
            result: '{"action":"ALLOW","rule":"R0","trace":["contract found","identity valid","scope authorized"]}',
            startedAt: 0,
            completedAt: 80,
          },
          {
            name: 'corpus.recall',
            args: { k: 3, query: 'first principles reasoning' },
            status: 'success',
            result: '["entry-4821","entry-3301","entry-0192"]',
            startedAt: 0,
            completedAt: 150,
          },
        ],
      },
    ],
  },
  {
    name: 'Extension',
    index: 4,
    steps: [
      { content: 'Extend baseline solution: add streaming status per phase to enable progressive disclosure.' },
      { content: 'Edge case: empty phases array must render gracefully — guard added at ReasoningChain boundary.' },
    ],
  },
  {
    name: 'Convergence',
    index: 5,
    steps: [
      { content: 'All five phases synthesised. Confidence: 0.91. Output routed to response formatter.' },
    ],
  },
]

function makeStep(
  content: string,
  toolCallInputs: ToolCallInput[] | undefined,
  baseTime: number,
): ReasoningStep {
  return {
    id: `step-${Math.random().toString(36).slice(2, 10)}`,
    content,
    status: 'complete',
    startedAt: baseTime,
    completedAt: baseTime + 120,
    toolCalls: toolCallInputs?.map(tc => ({
      ...tc,
      id: `tc-${Math.random().toString(36).slice(2, 10)}`,
      startedAt: baseTime + tc.startedAt,
      completedAt: tc.completedAt != null ? baseTime + tc.completedAt : undefined,
    })),
  }
}

export function buildMockReasoning(): ReasoningData {
  if (!import.meta.env.DEV) {
    throw new Error('buildMockReasoning is a development utility and must not be called in production.')
  }

  const now = Date.now()
  const phases: ReasoningPhase[] = PHASE_SCRIPTS.map((script, i) => {
    const phaseStart = now + i * 250
    return {
      id: `phase-${script.index}`,
      index: script.index,
      name: script.name,
      status: 'complete',
      startedAt: phaseStart,
      completedAt: phaseStart + 200,
      steps: script.steps.map(s => makeStep(s.content, s.toolCalls, phaseStart)),
    }
  })

  return {
    id: `reasoning-mock-${now}`,
    version: 1,
    phases,
    status: 'complete',
    startedAt: now,
    completedAt: now + 1250,
  }
}
