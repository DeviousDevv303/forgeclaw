// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

/**
 * Explicit requests to RUN a simulation.
 *
 * MiroFish, ForgeClaw's only simulation tool, was removed on 2026-11-14 at the owner's order. Since then nothing in the app
 * handles a simulation request, so under the Nexus provider it went to the checkpoint, which is a tool-call specialist
 * and cannot run the in-house swarm yet: the owner got word salad and a roughly one-minute Actions run spent to produce it.
 * The Nexus router answers such a request itself (providerRouter.ts), the way it already handles an image request.
 *
 * Narrow on purpose, like isImageGenerationRequest: only an explicit instruction to run a simulation, never talk about
 * simulations ("what is a simulation", "simulation theory", "I ran a simulation yesterday").
 */
import { extractImagePrompt } from './imageRequest'

const RUN_VERB = '(?:run|start|launch|rerun|re-run|kick off|perform|execute|do)'
const SIM_NOUN = '(?:simulation|sim|swarm sim(?:ulation)?|swarm)'
const FIGHT_WORDS = '(?:fight|bout|match|matchup|card|ufc|mma|vs\\.?|versus)'

const RUN_A_SIMULATION = new RegExp(`\\b${RUN_VERB}\\b[^.?!\\n]{0,40}\\b${SIM_NOUN}\\b`, 'i')
// "simulate" alone is also ordinary English ("simulate a keyboard"), so it needs a fight context to count.
const SIMULATE_A_FIGHT = new RegExp(`\\bsimulate\\b[^.?!\\n]{0,80}\\b${FIGHT_WORDS}(?![a-z])`, 'i')

export function isSimulationRequest(text: string): boolean {
  const message = extractImagePrompt(text).trim()
  if (!message) return false
  return RUN_A_SIMULATION.test(message) || SIMULATE_A_FIGHT.test(message)
}

/**
 * What the Nexus router says instead of dispatching the checkpoint, when a simulation request reaches it. In the chat box the request
 * is run by the in-house fight simulation (App.tsx, simulationRunner.ts) on a hosted model before it ever gets here; this is the
 * backstop for any path that does reach the checkpoint. Provider truth: Nexus was not asked, so it says nothing.
 */
export const SIMULATION_UNAVAILABLE_NOTICE =
  'No simulation was run on the Nexus checkpoint: it cannot run one, and Nexus was not asked. The in-house fight simulation runs on a ' +
  'hosted model (a Kimi or OpenRouter key set in Settings) and is started from the chat box.'
