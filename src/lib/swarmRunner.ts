// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

/**
 * Runs an owner-typed /swarm (swarm.ts holds the rules; this is the glue, the same shape as simulationRunner.ts).
 *
 * One planning call, then the children in parallel on the existing sub-agent loop, then one combining call, all on a HOSTED
 * model chosen by the keys in Settings. Every child tool call goes through executeTool and Guardian exactly as any sub-agent's
 * does, and a child is offered only its read-only tools, so nothing here writes, spends or spawns. A child that throws is
 * reported as failed; it never takes the others down and is never retried silently.
 */
import { callProvider, PROVIDERS } from './modelProviders'
import type { ProviderId } from './modelProviders'
import { runSubAgent } from './managedAgent'
import type { ToolContext, ToolDef } from './forgeTools'
import { pickSimulationProvider, type HostedId } from './fightSimulation'
import {
  childSystemPrompt, formatSwarm, parseSwarmPlan, PLANNER_SYSTEM, plannerTask, SWARM_NEEDS_KEY_NOTICE, SYNTHESIS_SYSTEM, synthesisTask,
  type SwarmChildResult,
} from './swarm'

export interface SwarmRequestDeps {
  active: string
  keys: Partial<Record<HostedId, string>>
  models: Partial<Record<HostedId, string>>
  allTools: ToolDef[]
  toolCtx: ToolContext
  signal?: AbortSignal
  /** Called once per agent as it starts and as it ends, so the app can record and show real events. */
  onAgent?: (event: { phase: 'start' | 'end'; index: number; provider: string; model: string; result?: SwarmChildResult }) => void
  /** Test seams; production leaves them unset. */
  runSubAgentFn?: typeof runSubAgent
  callProviderFn?: typeof callProvider
}

export interface SwarmRequestResult {
  ok: boolean
  text: string
  /** Set only when a hosted model actually ran, so the message is never attributed to a model that did not answer. */
  provider?: string
  model?: string
  results?: SwarmChildResult[]
}

const PLAN_MAX_TOKENS = 900
const SYNTHESIS_MAX_TOKENS = 700

export async function runSwarmRequest(task: string, deps: SwarmRequestDeps): Promise<SwarmRequestResult> {
  const choice = pickSimulationProvider({ active: deps.active, keys: deps.keys, models: deps.models })
  if (!choice) return { ok: false, text: SWARM_NEEDS_KEY_NOTICE }
  const subAgent = deps.runSubAgentFn ?? runSubAgent
  const call = deps.callProviderFn ?? callProvider
  const providerId = choice.provider as ProviderId
  const label = `${PROVIDERS[providerId]?.name ?? choice.provider} · ${choice.model || 'default model'}`
  const attributed = { provider: choice.provider, model: choice.model }

  const planReply = (await call(providerId, choice.model, PLANNER_SYSTEM, [{ role: 'user', content: plannerTask(task) }], choice.apiKey, { signal: deps.signal, maxTokens: PLAN_MAX_TOKENS })).text
  const plan = parseSwarmPlan(planReply)
  if (!plan.ok) return { ok: false, text: `No swarm was run: ${plan.reason}. Planned by ${label}; no agent was started.`, ...attributed }

  const results = await Promise.all(plan.agents.map(async (agent, index): Promise<SwarmChildResult> => {
    deps.onAgent?.({ phase: 'start', index, ...attributed })
    let result: SwarmChildResult
    try {
      const text = await subAgent(childSystemPrompt(agent), agent.task, agent.tools, providerId, choice.model, choice.apiKey, deps.allTools, { ...deps.toolCtx, signal: deps.signal, spawnAgent: undefined })
      result = text.trim() ? { agent, status: 'returned', text: text.trim() } : { agent, status: 'failed', text: 'the agent returned nothing' }
    } catch (error) {
      result = { agent, status: 'failed', text: error instanceof Error ? error.message : String(error) }
    }
    deps.onAgent?.({ phase: 'end', index, ...attributed, result })
    return result
  }))

  const returned = results.filter(r => r.status === 'returned')
  if (returned.length === 0) return { ok: false, text: formatSwarm({ task, results, synthesis: null }, label), ...attributed, results }
  let synthesis: string | null = null
  let synthesisError: string | undefined
  try {
    synthesis = (await call(providerId, choice.model, SYNTHESIS_SYSTEM, [{ role: 'user', content: synthesisTask(task, results) }], choice.apiKey, { signal: deps.signal, maxTokens: SYNTHESIS_MAX_TOKENS })).text.trim() || null
    if (!synthesis) synthesisError = 'the combining step returned nothing'
  } catch (error) {
    synthesisError = `the combining step failed (${error instanceof Error ? error.message : String(error)})`
  }
  // Complete only when every agent returned and the reports were combined. Anything less is shown, and marked incomplete.
  const ok = synthesis !== null && returned.length === results.length
  return { ok, text: formatSwarm({ task, results, synthesis, synthesisError }, label), ...attributed, results }
}
