// @vitest-environment jsdom
// Live NEXUS before/after run. Skipped unless NEXUS_AB is set, so it never runs in CI or in the normal suite and never
// spends tokens or GitHub Actions minutes by accident. See docs/nexus-ab-harness.md for the exact command and variables.
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildDeepSeekTaskPayload } from '../ai/deepseekContext'
import { stripReasoningArtifacts } from '../ai/responseFilter'
import { anthropicProvider, DEFAULT_ANTHROPIC_MODEL } from '../ai/providers/anthropicProvider'
import { DEFAULT_DEEPSEEK_API_MODEL, deepseekApiProvider } from '../ai/providers/deepseekApiProvider'
import { DEFAULT_MOONSHOT_MODEL, moonshotProvider } from '../ai/providers/moonshotProvider'
import { DEFAULT_OPENROUTER_MODEL, openrouterProvider } from '../ai/providers/openrouterProvider'
import type { AIProvider } from '../ai/types'
import { executeTool, loadToolContext } from '../forgeTools'
import { heuristicsForPrompt } from '../nexusHeuristics'
import { AB_CASES } from './cases'
import { renderReport, runExperiment, summarize, type Ask, type Trial } from './harness'

const env = (name: string): string => (process.env[name] ?? '').trim()
const BASE_SYSTEM = 'You are ForgeClaw, a concise and helpful AI assistant.'

interface Target { id: string; model: string; ask: Ask }

const HOSTED: Record<string, { provider: AIProvider; model: string }> = {
  moonshot: { provider: moonshotProvider, model: DEFAULT_MOONSHOT_MODEL },
  deepseekapi: { provider: deepseekApiProvider, model: DEFAULT_DEEPSEEK_API_MODEL },
  openrouter: { provider: openrouterProvider, model: DEFAULT_OPENROUTER_MODEL },
  anthropic: { provider: anthropicProvider, model: DEFAULT_ANTHROPIC_MODEL },
}

/** Hosted providers get NEXUS the way App.tsx delivers it: the owner's heuristics block appended to the system prompt. */
function hostedTarget(id: string): Target {
  const key = env(`NEXUS_AB_KEY_${id.toUpperCase()}`)
  if (!key) throw new Error(`NEXUS_AB_KEY_${id.toUpperCase()} is not set; refusing to skip a provider you asked for`)
  const { provider, model: defaultModel } = HOSTED[id]
  const model = env(`NEXUS_AB_MODEL_${id.toUpperCase()}`) || defaultModel
  return {
    id, model,
    ask: async ({ arm, kase }) => {
      const block = arm === 'on' ? heuristicsForPrompt({ approved: [kase.rule], rejected: [] }, []) : ''
      const systemPrompt = [BASE_SYSTEM, block].filter(Boolean).join('\n\n')
      const response = await provider.send({ systemPrompt, messages: [{ role: 'user', content: kase.task }], model, maxTokens: 4000 }, key)
      return { answer: response.text, sent: `${systemPrompt}\n\n${kase.task}` }
    },
  }
}

/**
 * The 16B goes through the real path: buildDeepSeekTaskPayload -> executeTool('deepseek_reason') -> the workflow dispatch.
 * `sent` is read off the actual dispatch request, after forgeTools.ts has applied its context rules, so this measures what
 * the workflow really received, not what the app meant to send. nexus_learn is false so harness runs never become
 * learning candidates in NEXUS.
 */
function deepseek16bTarget(): Target {
  const token = env('NEXUS_AB_GH_TOKEN')
  if (!token) throw new Error('NEXUS_AB_GH_TOKEN is not set; refusing to skip deepseek16b')
  let dispatched = ''
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (/\/dispatches$/.test(String(input)) && typeof init?.body === 'string') {
      const inputs = (JSON.parse(init.body) as { inputs?: { task?: string; context?: string } }).inputs ?? {}
      dispatched = `${inputs.task ?? ''}\n\n${inputs.context ?? ''}`
    }
    return realFetch(input, init)
  }) as typeof fetch
  return {
    id: 'deepseek16b', model: 'Qwen3-8B via deepseek-16b.yml',
    ask: async ({ arm, kase }) => {
      localStorage.clear()
      if (arm === 'on') localStorage.setItem('nexus_heuristics_v1', JSON.stringify({ approved: [kase.rule], rejected: [] }))
      const payload = buildDeepSeekTaskPayload(kase.task)
      dispatched = ''
      const output = await executeTool(
        { id: `ab-${Date.now()}`, name: 'deepseek_reason', input: { task: payload.task, context: payload.context ?? '', nexus_learn: false } },
        { ...loadToolContext(), ghToken: token, guardianPosture: 'operator-shell', actor: 'operator', requestGuardianApproval: async () => true },
      )
      if (!output.startsWith('✓ DeepSeek-16B completed as ')) throw new Error(output.slice(0, 300))
      return { answer: stripReasoningArtifacts(output.split('\n\n').slice(1).join('\n\n')), sent: dispatched }
    },
  }
}

describe.skipIf(!env('NEXUS_AB'))('NEXUS before/after (live)', () => {
  it('runs the requested providers and writes a report', async () => {
    const ids = (env('NEXUS_AB_PROVIDERS') || 'deepseek16b').split(',').map(s => s.trim()).filter(Boolean)
    const reps = Number(env('NEXUS_AB_REPS') || '3')
    const only = env('NEXUS_AB_CASES').split(',').map(s => s.trim()).filter(Boolean)
    const cases = only.length ? AB_CASES.filter(c => only.includes(c.id)) : AB_CASES
    const secrets = Object.entries(process.env).filter(([k, v]) => /^NEXUS_AB_(KEY|GH_TOKEN)/.test(k) && v).map(([, v]) => v as string)
    const redact = (text: string) => secrets.reduce((t, s) => t.split(s).join('[redacted]'), text)
    const outDir = env('NEXUS_AB_OUT') || join(tmpdir(), 'nexus-ab')
    mkdirSync(outDir, { recursive: true })
    const ranAt = new Date().toISOString()
    const sections: string[] = [`# NEXUS before/after results (${ranAt})`, '']
    const raw: Record<string, Trial[]> = {}
    for (const id of ids) {
      const target = id === 'deepseek16b' ? deepseek16bTarget() : HOSTED[id] ? hostedTarget(id) : (() => { throw new Error(`unknown provider "${id}"`) })()
      const trials = await runExperiment({ cases, reps, ask: target.ask, redact })
      raw[id] = trials
      sections.push(renderReport(id, target.model, summarize(trials), { reps, ranAt }))
    }
    writeFileSync(join(outDir, 'report.md'), sections.join('\n'))
    writeFileSync(join(outDir, 'trials.json'), redact(JSON.stringify(raw, null, 2)))
    console.log(`NEXUS A/B report written to ${join(outDir, 'report.md')}`)
    expect(Object.keys(raw)).toEqual(ids)
  }, 6 * 60 * 60 * 1000)
})
