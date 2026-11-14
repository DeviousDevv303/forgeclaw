// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

/**
 * The in-house fight simulation (replaces MiroFish, owner order 2026-11-14).
 *
 * One research step gathers a single public-facts packet. A fixed set of five persona agents then each give a probability that
 * fighter A wins, working ONLY from that same packet. The app does the arithmetic (median, range, pick counts) itself and builds the
 * report itself: no model writes the summary, so nothing in the result is a model's claim about the model's own work.
 *
 * What it is NOT, stated in every report: evidence about the fight. The personas are model output; their reasons are unverified. A
 * simulation moves no stake, no weight and no position (the old sim lane weighed 0% until it earned a record; this one never feeds
 * the funds ledger at all). Model calls are injected, so every rule here is tested with scripted models.
 *
 * Pure of storage and network: `research` and `ask` are supplied by the caller (App.tsx wires them to a hosted provider).
 */

export interface Matchup { a: string; b: string }

const SEP = '(?:vs\\.?|versus|v\\.?)'
const STOP = '(?:ufc|mma|match|fight|bout|this|tomorrow|tomorrows|tonight|on|at|for|in|card|main|event|and|then|please|with|using|from)'
const LEAD = /\b(?:simulation|sim|simulate)\b(?:\s+(?:of|on|for))?\s+(?:the\s+)?/i

function titleCase(name: string): string {
  const clean = name.replace(/\s+/g, ' ').trim()
  return /[A-Z]/.test(clean) ? clean : clean.replace(/\b[a-z]/g, c => c.toUpperCase())
}

/** The two sides named in a request such as "Run a simulation of josh hokit vs ciryl gane ufc match this Saturday", or null. */
export function parseMatchup(text: string): Matchup | null {
  const message = text.replace(/\s+/g, ' ').trim()
  if (!message) return null
  const sides = new RegExp(`^(.+?)\\s+${SEP}\\s+(.+?)(?=\\s+${STOP}\\b|[.,!?;]|$)`, 'i')
  const lead = LEAD.exec(message)
  const found = lead ? sides.exec(message.slice(lead.index + lead[0].length)) : null
  if (found) return { a: titleCase(found[1]), b: titleCase(found[2]) }
  const word = "[A-Za-z'.-]+"
  const loose = new RegExp(`((?:${word}\\s+){0,2}${word})\\s+${SEP}\\s+(${word}(?:\\s+${word}){0,2}?)(?=\\s+${STOP}\\b|[.,!?;]|$)`, 'i').exec(message)
  return loose ? { a: titleCase(loose[1]), b: titleCase(loose[2]) } : null
}

export type HostedId = 'moonshot' | 'openrouter'
export interface HostedChoice { provider: HostedId; model: string; apiKey: string }
const HOSTED_PRIORITY: readonly HostedId[] = ['moonshot', 'openrouter']

/**
 * The hosted model a simulation runs on: the active provider when it is hosted and keyed, otherwise the first keyed one (Kimi, then
 * OpenRouter, which also routes to Claude models). The Nexus checkpoint cannot run this, whatever provider is selected for chat.
 */
export function pickSimulationProvider(input: { active: string; keys: Partial<Record<HostedId, string>>; models: Partial<Record<HostedId, string>> }): HostedChoice | null {
  const keyed = (id: HostedId) => (input.keys[id] ?? '').trim().length > 0
  const id = HOSTED_PRIORITY.includes(input.active as HostedId) && keyed(input.active as HostedId) ? (input.active as HostedId) : HOSTED_PRIORITY.find(keyed)
  return id ? { provider: id, model: input.models[id] ?? '', apiKey: (input.keys[id] ?? '').trim() } : null
}

export const SIMULATION_MIN_VALID = 3
const PACKET_PROMPT_CHARS = 2_500
const PACKET_REPORT_CHARS = 600
const REASON_MAX_CHARS = 200

export interface Persona { id: string; role: string; brief: string }
export const PERSONAS: readonly Persona[] = [
  { id: 'matchup', role: 'Matchup analyst', brief: 'You judge fighting styles: who has the path to victory, and what each fighter does to the other\'s best tool.' },
  { id: 'stats', role: 'Statistics analyst', brief: 'You judge records against comparable opposition, finish and decision rates, age, layoff and weight-class changes, and you discount small samples.' },
  { id: 'market', role: 'Market skeptic', brief: 'You start from the betting market and the no-vig line as the baseline, distrust any story the price already contains, and move away from it only on named information.' },
  { id: 'camp', role: 'Camp and injury reporter', brief: 'You weigh only what is confirmed about camp, weight cut, injuries, short-notice changes and withdrawals, and you ignore rumor.' },
  { id: 'crowd', role: 'Fan crowd voice', brief: 'You speak for what fans and forums believe, and you know that crowds tend to overrate the earlier winner and the favorite.' },
]

export function personaSystemPrompt(persona: Persona): string {
  return `You are the ${persona.role} in a five-agent fight simulation. ${persona.brief} ` +
    'Work ONLY from the research packet and the two names you are given; if the packet does not say it, you do not know it, so stay near 0.5. ' +
    'Reply with exactly one line of JSON and nothing else: {"winner":"A" or "B","probability_a":a number from 0 to 1 for fighter A winning,"reason":"one sentence, at most 160 characters"}.'
}

export function personaTask(matchup: Matchup, packet: string): string {
  const facts = packet.trim()
    ? packet.slice(0, PACKET_PROMPT_CHARS)
    : '(none: no research was gathered, so work from the two names alone and show your uncertainty by staying near 0.5)'
  return `Fighter A: ${matchup.a}\nFighter B: ${matchup.b}\n\nResearch packet (public facts gathered for this fight; it may be incomplete):\n${facts}`
}

export type PersonaParse = { ok: true; probabilityA: number; reason: string } | { ok: false; why: string }

/** Strict: one JSON object with a winner, a probability in [0,1] that agrees with the winner, and a reason. Nothing is repaired. */
export function parsePersonaReply(raw: string): PersonaParse {
  const match = /\{[^{}]*\}/.exec(raw ?? '')
  if (!match) return { ok: false, why: 'no JSON object' }
  let value: unknown
  try { value = JSON.parse(match[0]) } catch { return { ok: false, why: 'not valid JSON' } }
  if (!value || typeof value !== 'object') return { ok: false, why: 'not an object' }
  const { winner, probability_a: probability, reason } = value as Record<string, unknown>
  if (typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 1) return { ok: false, why: 'probability_a is not a number from 0 to 1' }
  if (winner !== 'A' && winner !== 'B') return { ok: false, why: 'winner is not "A" or "B"' }
  if ((probability > 0.5 && winner !== 'A') || (probability < 0.5 && winner !== 'B')) return { ok: false, why: 'winner contradicts the probability' }
  // eslint-disable-next-line no-control-regex
  const clean = (typeof reason === 'string' ? reason : '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, REASON_MAX_CHARS)
  return { ok: true, probabilityA: probability, reason: clean }
}

export interface PersonaVerdict { id: string; role: string; probabilityA: number; reason: string }
export interface Aggregate { valid: number; median: number; min: number; max: number; picksA: number; picksB: number; noCall: number }

const round3 = (n: number) => Math.round(n * 1000) / 1000

export function aggregateVerdicts(verdicts: readonly PersonaVerdict[]): Aggregate | null {
  if (verdicts.length === 0) return null
  const sorted = verdicts.map(v => v.probabilityA).sort((x, y) => x - y)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return {
    valid: verdicts.length,
    median: round3(median), min: round3(sorted[0]), max: round3(sorted[sorted.length - 1]),
    picksA: verdicts.filter(v => v.probabilityA > 0.5).length,
    picksB: verdicts.filter(v => v.probabilityA < 0.5).length,
    noCall: verdicts.filter(v => v.probabilityA === 0.5).length,
  }
}

export interface SimulationDeps {
  /** Gathers the public-facts packet for the fight. It may throw or return nothing; the report says so. */
  research(matchup: Matchup): Promise<string>
  /** One single-shot persona call: system prompt and task in, the model's raw text out. */
  ask(system: string, task: string): Promise<string>
  signal?: AbortSignal
}

export interface SimulationOutcome {
  matchup: Matchup
  packet: string
  researchOk: boolean
  verdicts: PersonaVerdict[]
  /** Roles whose answer was missing, unreadable or inconsistent, in persona order. */
  invalidRoles: string[]
  aggregate: Aggregate | null
  inconclusive: boolean
}

const RESEARCH_FAILURE = /^\s*(?:\(no response\)|\(sub-agent|\[SUB-AGENT|\[TOOL ERROR|\[GUARDIAN)/i

export async function runFightSimulation(matchup: Matchup, deps: SimulationDeps): Promise<SimulationOutcome> {
  if (deps.signal?.aborted) throw new Error('Simulation aborted')
  let packet = ''
  try { packet = (await deps.research(matchup)) ?? '' } catch { packet = '' }
  const researchOk = packet.trim().length >= 20 && !RESEARCH_FAILURE.test(packet)
  if (!researchOk) packet = ''
  if (deps.signal?.aborted) throw new Error('Simulation aborted')

  const task = personaTask(matchup, packet)
  const settled = await Promise.all(PERSONAS.map(async (persona): Promise<PersonaVerdict | null> => {
    try {
      const parsed = parsePersonaReply(await deps.ask(personaSystemPrompt(persona), task))
      return parsed.ok ? { id: persona.id, role: persona.role, probabilityA: parsed.probabilityA, reason: parsed.reason } : null
    } catch { return null }
  }))
  if (deps.signal?.aborted) throw new Error('Simulation aborted')

  const verdicts = settled.filter((v): v is PersonaVerdict => v !== null)
  const invalidRoles = PERSONAS.filter((_, i) => settled[i] === null).map(p => p.role)
  const inconclusive = verdicts.length < SIMULATION_MIN_VALID
  return { matchup, packet, researchOk, verdicts, invalidRoles, aggregate: inconclusive ? null : aggregateVerdicts(verdicts), inconclusive }
}

const pct = (p: number) => Math.round(p * 100)

/** The report, built by the app from the parsed data. `runLabel` names the hosted model that ran the personas. */
export function formatSimulation(outcome: SimulationOutcome, runLabel: string): string {
  const { matchup, aggregate } = outcome
  const lines = [
    `Fight simulation: ${matchup.a} vs ${matchup.b}`,
    `Run on ${runLabel}: one research step, then ${PERSONAS.length} persona agents given the same packet.`,
    'Not evidence about the fight: the personas are model output, and their reasons are unverified model output. Nothing here moves a stake, a weight or a position.',
    '',
  ]
  if (aggregate) {
    lines.push(`Median ${matchup.a} ${pct(aggregate.median)}% / ${matchup.b} ${100 - pct(aggregate.median)}% (personas ranged ${pct(aggregate.min)}-${pct(aggregate.max)}% for ${matchup.a}).`)
    lines.push(`Picks: ${matchup.a} ${aggregate.picksA}, ${matchup.b} ${aggregate.picksB}, no call ${aggregate.noCall}. ${aggregate.valid} of ${PERSONAS.length} personas gave a valid answer.`)
  } else {
    lines.push(`Inconclusive: only ${outcome.verdicts.length} of ${PERSONAS.length} personas gave a valid answer (at least ${SIMULATION_MIN_VALID} are needed), so no result is shown.`)
  }
  lines.push('')
  for (const v of outcome.verdicts) lines.push(`- ${v.role}: ${matchup.a} ${pct(v.probabilityA)}%${v.reason ? ` - "${v.reason}"` : ''}`)
  for (const role of outcome.invalidRoles) lines.push(`- ${role}: no valid answer (not counted)`)
  lines.push('')
  lines.push(outcome.researchOk
    ? `Research packet (first ${PACKET_REPORT_CHARS} characters): ${outcome.packet.slice(0, PACKET_REPORT_CHARS).replace(/\s+/g, ' ')}`
    : 'No research was gathered, so the personas worked from the two names alone; treat these numbers accordingly.')
  return lines.join('\n')
}

/** What a simulation request gets when it cannot run: no hosted key to run it on, or no two sides named. Nothing was run. */
export const SIMULATION_NEEDS_KEY_NOTICE =
  'No simulation was run. The in-house simulation needs a hosted model to run its persona agents, and none is set up: add a Kimi or ' +
  'OpenRouter key in Settings (OpenRouter reaches Claude models too). The Nexus checkpoint cannot run it, and Nexus was not asked.'
export const SIMULATION_NEEDS_SIDES_NOTICE =
  'No simulation was run: I could not tell who fights whom. Name both sides, for example "run a simulation of Hokit vs Gane".'
