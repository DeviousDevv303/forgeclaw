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

/** What the Nexus router says instead of dispatching the checkpoint. Provider truth: Nexus was not asked, so it says nothing. */
export const SIMULATION_UNAVAILABLE_NOTICE =
  'No simulation was run. ForgeClaw has no simulation tool any more: the MiroFish swarm simulation was removed on 2026-11-14, ' +
  'and the Nexus checkpoint cannot run the in-house swarm (spawn_agent) yet, because its first controlled swarm baseline did not ' +
  'get it to spawn a working sub-agent. Nexus was not asked, so no model answer is shown here. For a fight read now, switch to ' +
  'Kimi or Claude in Settings and ask for the matchup research: they can use web research, ESPN fight stats and Kalshi prices.'
