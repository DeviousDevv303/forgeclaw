// @vitest-environment node
// The DeepSeek workflow trims the MIDDLE of an over-long prompt, and the supplied context sits in the middle. The NEXUS
// guidance must never be what gets cut (owner's law: no stage strips it silently). This runs the REAL helper out of
// .github/workflows/deepseek-16b.yml against the real deepseek_gguf.fit_text with a fake tokenizer (one token per 4 chars).
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync('.github/workflows/deepseek-16b.yml', 'utf8')
const begin = workflow.indexOf('# --- NEXUS guidance protection (begin)')
const end = workflow.indexOf('# --- NEXUS guidance protection (end)')
const helper = workflow.slice(begin, end).split('\n').map(line => line.replace(/^ {10}/, '')).join('\n')

const GUIDANCE = `NEXUS GUIDANCE (what the owner has taught NEXUS)\n- say plainly when a step failed\n[END NEXUS GUIDANCE]`

function run(prompt: string, budget: number): { out: string; trimmed: boolean; guidance: string; tokens: number; legacy: string } {
  const py = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('deepseek_gguf', '.github/scripts/deepseek_gguf.py')
deepseek_gguf = importlib.util.module_from_spec(spec); spec.loader.exec_module(deepseek_gguf)
${helper}
data = json.load(sys.stdin)
count = lambda text: (len(text) + 3) // 4
out, trimmed, guidance = fit_keeping_guidance(data['prompt'], count, data['budget'])
legacy, _ = deepseek_gguf.fit_text(data['prompt'], count, data['budget'])
print(json.dumps({'out': out, 'trimmed': trimmed, 'guidance': guidance, 'tokens': count(out), 'legacy': legacy}))
`
  const r = spawnSync('python3', ['-I', '-B', '-c', py], { input: JSON.stringify({ prompt, budget }), encoding: 'utf8' })
  expect(r.status, r.stderr).toBe(0)
  return JSON.parse(r.stdout) as ReturnType<typeof run>
}

const filler = (n: number) => 'lorem ipsum dolor sit amet '.repeat(n)
const head = 'HEAD instructions\nTask:\nwrite a poem about cats\n\nVerified project, CORPUS, and tool context:\n'
const tail = '\n\nAnswer the actual task directly.'

describe('the workflow prompt trim', () => {
  it('the old trim cuts guidance that sits in the middle (the defect)', () => {
    const prompt = head + filler(100) + GUIDANCE + '\n\n' + filler(400) + tail
    expect(run(prompt, 600).legacy).not.toContain('say plainly when a step failed')
  })
  it('keeps the guidance while still trimming the rest to the budget', () => {
    const prompt = head + filler(100) + GUIDANCE + '\n\n' + filler(400) + tail
    const r = run(prompt, 600)
    expect(r.trimmed).toBe(true)
    expect(r.guidance).toBe('kept')
    expect(r.out).toContain('say plainly when a step failed')
    expect(r.out).toContain('[END NEXUS GUIDANCE]')
    expect(r.out.startsWith('HEAD instructions')).toBe(true)
    expect(r.out.endsWith('Answer the actual task directly.')).toBe(true)
    expect(r.tokens).toBeLessThanOrEqual(600)
  })
  it('keeps the guidance when it is far from the head and the tail', () => {
    const prompt = head + filler(300) + GUIDANCE + '\n\n' + filler(300) + tail
    expect(run(prompt, 500).out).toContain('say plainly when a step failed')
  })
  it('leaves a prompt that fits untouched and reports the guidance as kept', () => {
    const prompt = head + GUIDANCE + tail
    expect(run(prompt, 4000)).toMatchObject({ out: prompt, trimmed: false, guidance: 'kept' })
  })
  it('behaves exactly like the old trim when there is no guidance', () => {
    const prompt = head + filler(500) + tail
    const r = run(prompt, 400)
    expect(r.guidance).toBe('none')
    expect(r.out).toBe(r.legacy)
    expect(r.trimmed).toBe(true)
  })
})
