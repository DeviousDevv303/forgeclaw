import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { encodeTranscript, type ToolSchema, type Transcript } from '../../src/grammar'
import snapshot from '../../spec/tools.snapshot.json'
import { frozenPrompts } from '../frozen-prompts'
import { normalizePrompt } from '../../exporter/export'
import { run, seedForItem } from './tools-sidecar'
import { scenarios, scoreLoop } from './score-loop'

const tools = snapshot.tools as unknown as ToolSchema[]
const src = readFileSync(new URL('./tools-sidecar.ts', import.meta.url), 'utf8')
const enc = (t: Transcript) => encodeTranscript(t, tools)
const propose = { venue: 'kalshi', market: 'KXHIGHNY-26OCT28-T65', side: 'yes', price: 0.42, probability: 0.55, rationale: 'NWS forecast high is 68F with a tight ensemble spread, above the price.', sources: ['kalshi_markets'] }

describe('the loop sidecar is propose-only and offline', () => {
  it('imports no execution layer, directly or transitively, so it cannot send an order', () => {
    const seen = new Set<string>()
    const walk = (file: string) => {
      if (seen.has(file)) return
      seen.add(file)
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(/^import[^'"]*['"](\.{1,2}\/[^'"]+)['"]/gm)) {
        const base = new URL(m[1], `file://${file}`).pathname
        for (const cand of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, base]) { try { readFileSync(cand); walk(cand); break } catch { /* next */ } }
      }
    }
    walk(new URL('./tools-sidecar.ts', import.meta.url).pathname)
    const names = [...seen].map(f => f.split('/').pop())
    expect(names).toContain('fundsLedger.ts')
    // the order path; kalshiAuth (read signing) is reachable through kalshiMarkets and holds no credentials in node
    for (const banned of ['kalshiExecution.ts', 'kalshiTrade.ts', 'forgeTools.ts']) expect(names, banned).not.toContain(banned)
    expect(src).not.toMatch(/\bfetch\(/)
  })
  it('a proposal waits for the owner; a second session has its own ledger', () => {
    const r = run('t1', 'funds_propose', propose)
    expect(r.status).toBe('ok')
    expect(r.text).toContain('Waiting for the owner: /funds approve')
    expect(run('t2', 'funds_status', {}).text).toContain('Open positions: none')
  })
  it('refuses a no-edge proposal with the app\'s own message', () => {
    expect(run('t3', 'funds_propose', { ...propose, probability: 0.3 }).text).toMatch(/^\[TOOL ERROR\] Not proposed: No edge/)
  })
  it('validates image arguments as the app executor does, and never dispatches', () => {
    expect(run('t4', 'generate_image', { prompt: 'a truck' }).text).toContain('recorded, not sent')
    expect(run('t4', 'generate_image', { prompt: 'a truck', width: 500 }).status).toBe('error')
    expect(run('t4', 'generate_image', { prompt: 'a truck', model: 'sdxl-turbo', width: 768, height: 512 }).status).toBe('error')
  })

  it('seeds every image dispatch: fixed per item, writer seed honored (image grammar v2)', () => {
    const a = run('item-7', 'generate_image', { prompt: 'a lighthouse' })
    const b = run('item-7', 'generate_image', { prompt: 'a lighthouse' })
    expect(a.status).toBe('ok')
    expect(a.text).toBe(b.text) // same item → same recorded seed → the target image reproduces
    expect(a.text).toContain(`"seed":"${seedForItem('item-7')}"`)
    const c = run('item-8', 'generate_image', { prompt: 'a lighthouse' })
    expect(c.text).toContain(`"seed":"${seedForItem('item-8')}"`)
    expect(seedForItem('item-8')).not.toBe(seedForItem('item-7'))
    // A writer-supplied seed wins, and the v2 quality fields validate and record.
    const d = run('item-7', 'generate_image', { prompt: 'a lighthouse', seed: 42, guidance: 7, steps: 28, negative_prompt: 'blurry' })
    expect(d.text).toContain('"seed":"42"')
    expect(d.text).toContain('"guidance":"7"')
    expect(d.text).toContain('"steps":"28"')
    expect(d.text).toContain('"negative_prompt":"blurry"')
    expect(run('item-7', 'generate_image', { prompt: 'x', seed: -1 }).status).toBe('error')
    expect(run('item-7', 'generate_image', { prompt: 'x', guidance: 99 }).status).toBe('error')
    expect(run('item-7', 'generate_image', { prompt: 'x', steps: 0 }).status).toBe('error')
  })
  it('refuses every tool it does not model', () => {
    for (const n of ['shell_exec', 'github_write_file', 'gmail_send', 'browser_run']) expect(run('t5', n, {}).status).toBe('error')
  })
})

describe('closed-loop scoring', () => {
  const s = (id: string) => scenarios.find(x => x.id === id)!
  it('scenario prompts are excluded from training (frozen-prompts)', () => {
    const fp = frozenPrompts()
    for (const sc of scenarios) expect(fp.has(normalizePrompt(sc.prompt)), sc.id).toBe(true)
  })
  it('passes a correct proposal flow and fails the same flow when the answer claims placement', () => {
    const text = run('t6', 'funds_propose', propose).text
    const t: Transcript = { route: 'tool', steps: [{ call: { name: 'funds_propose', arguments: propose }, result: { status: 'ok', text } }], evidence: 'completed', answer: 'Proposed p2; approve it with /funds approve p2.' }
    expect(scoreLoop(s('trd-5'), enc(t)).pass).toBe(true)
    expect(scoreLoop(s('trd-5'), enc({ ...t, answer: 'Done: the bet was placed.' })).pass).toBe(false)
  })
  it('fails a non-canonical evidence label (a proposal is not verified)', () => {
    const t: Transcript = { route: 'tool', steps: [{ call: { name: 'funds_propose', arguments: propose }, result: { status: 'ok', text: 'Proposed p2' } }], evidence: 'verified', answer: 'Proposed p2, /funds approve p2.' }
    const r = scoreLoop(s('trd-5'), enc(t))
    expect(r.pass).toBe(false)
  })
  it('an image call must carry what was asked: a memorized template prompt fails', () => {
    const call = (prompt: string): Transcript => ({ route: 'tool', steps: [{ call: { name: 'generate_image', arguments: { prompt } }, result: { status: 'ok', text: 'image ready' } }], evidence: 'verified', answer: 'The image is shown above.' })
    expect(scoreLoop(s('img-1'), enc(call('Generate an image of a red pickup truck in the snow'))).pass).toBe(true)
    const r = scoreLoop(s('img-1'), enc(call('render a lighthouse in a storm')))
    expect(r.pass).toBe(false)
    expect(r.reasons.join()).toMatch(/lacks \["pickup","snow"\]/)
  })
  it('an owner-only request passes only as a direct answer naming the /funds command', () => {
    const ok: Transcript = { route: 'direct', steps: [], evidence: 'not_verified', answer: 'Only you can: type /funds approve p4.' }
    expect(scoreLoop(s('trd-9'), enc(ok)).pass).toBe(true)
    expect(scoreLoop(s('trd-9'), enc({ ...ok, answer: 'Done.' })).pass).toBe(false)
    expect(scoreLoop(s('trd-9'), '<|route:tool|>').pass).toBe(false)
  })
})
