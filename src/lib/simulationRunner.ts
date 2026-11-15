// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

/**
 * Runs the in-house fight simulation for a chat request (fightSimulation.ts holds the rules; this is the glue).
 *
 * It runs on a capable HOSTED model (Kimi, Claude or OpenRouter, by the keys in Settings) whichever provider is selected for chat:
 * the Nexus checkpoint cannot run it. The research step is the existing sub-agent loop with exactly two read-only tools
 * (web_search, espn_fight_stats), so every tool call still goes through executeTool and Guardian. The persona calls are single-shot
 * text calls with no tools. Nothing here writes anything, spends money through a tool, or touches the funds ledger.
 */
import { callProvider, PROVIDERS } from './modelProviders'
import type { ProviderId } from './modelProviders'
import { runSubAgent } from './managedAgent'
import type { ToolContext, ToolDef } from './forgeTools'
import {
  formatSimulation, parseMatchup, pickSimulationProvider, runFightSimulation, SIMULATION_NEEDS_KEY_NOTICE, SIMULATION_NEEDS_SIDES_NOTICE,
  type HostedId, type Matchup,
} from './fightSimulation'

export interface SimulationRequestDeps {
  active: string
  keys: Partial<Record<HostedId, string>>
  models: Partial<Record<HostedId, string>>
  allTools: ToolDef[]
  toolCtx: ToolContext
  signal?: AbortSignal
  /** Test seams; production leaves them unset. */
  runSubAgentFn?: typeof runSubAgent
  callProviderFn?: typeof callProvider
}

export interface SimulationRequestResult {
  ok: boolean
  text: string
  /** Set only when a hosted model actually ran, so the message is never attributed to a model that did not answer. */
  provider?: string
  model?: string
}

const RESEARCH_TOOLS = ['web_search', 'espn_fight_stats']
const PERSONA_MAX_TOKENS = 300

const RESEARCH_SYSTEM =
  'You are the research step of a fight simulation. Use web_search and espn_fight_stats to find public facts about this fight and report only what ' +
  'the results say, naming the source of each fact. Reply with a plain factual packet of at most 1,500 characters: records, recent results, weight class, ' +
  'scheduled rounds, confirmed injuries or camp news, and betting odds if you find them. No opinions and no prediction.'

function researchTask(matchup: Matchup): string {
  return `Today is ${new Date().toISOString().slice(0, 10)}. Find the public facts for the fight ${matchup.a} vs ${matchup.b}. ` +
    'If you cannot find the fight, say so plainly instead of guessing.'
}

export async function runSimulationRequest(promptText: string, deps: SimulationRequestDeps): Promise<SimulationRequestResult> {
  const matchup = parseMatchup(promptText)
  if (!matchup) return { ok: false, text: SIMULATION_NEEDS_SIDES_NOTICE }
  const choice = pickSimulationProvider({ active: deps.active, keys: deps.keys, models: deps.models })
  if (!choice) return { ok: false, text: SIMULATION_NEEDS_KEY_NOTICE }

  const subAgent = deps.runSubAgentFn ?? runSubAgent
  const call = deps.callProviderFn ?? callProvider
  const providerId = choice.provider as ProviderId
  const outcome = await runFightSimulation(matchup, {
    signal: deps.signal,
    research: () => subAgent(RESEARCH_SYSTEM, researchTask(matchup), RESEARCH_TOOLS, providerId, choice.model, choice.apiKey, deps.allTools, { ...deps.toolCtx, signal: deps.signal }),
    ask: async (system, task) => (await call(providerId, choice.model, system, [{ role: 'user', content: task }], choice.apiKey, { signal: deps.signal, maxTokens: PERSONA_MAX_TOKENS })).text,
  })
  const label = `${PROVIDERS[providerId]?.name ?? choice.provider} · ${choice.model || 'default model'}`
  return { ok: !outcome.inconclusive, text: formatSimulation(outcome, label), provider: choice.provider, model: choice.model }
}
