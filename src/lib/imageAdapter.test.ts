// @vitest-environment node
// The image adapter makes generate-image.yml model-swappable. These tests pin what must not drift:
// the size-resolved default (FLUX.2 klein 4B up to 512, SD1.5 above) matches between the TS dispatch
// and the Python spec, the TS allowlist matches the Python one, Turbo models never get a size
// they were not benchmarked at, the runner is pinned, and the dependencies are exact pins.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultImageModel, executeTool, FORGE_TOOLS, IMAGE_BAKEOFF_MODELS, IMAGE_MODELS, type ToolContext } from './forgeTools'
import { takeGeneratedImage } from './imageArtifact'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

const SCRIPT_DIR = '.github/scripts'
const read = (p: string) => readFileSync(p, 'utf8')

/** Run build_spec in a fresh interpreter. -B and PYTHONDONTWRITEBYTECODE keep __pycache__ out of the tree. */
function spec(env: Record<string, string>) {
  const code = `
import json, sys
sys.path.insert(0, ${JSON.stringify(SCRIPT_DIR)})
import generate_image as g
try:
    print(json.dumps({"ok": g.build_spec(json.loads(sys.argv[1]))}))
except g.SpecError as e:
    print(json.dumps({"error": str(e)}))
`
  const r = spawnSync('python3', ['-B', '-c', code, JSON.stringify(env)], {
    encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  })
  if (r.status !== 0) throw new Error(r.stderr)
  return JSON.parse(r.stdout) as { ok?: Record<string, unknown>; error?: string }
}

describe('generate_image.py build_spec', () => {
  it('defaults to FLUX.2 klein 4B at 512 with its bakeoff settings', () => {
    const { ok } = spec({ PROMPT: 'a fox' })
    expect(ok).toMatchObject({ model: 'flux2-klein-4b', repo: 'black-forest-labs/FLUX.2-klein-4B', steps: 4, guidance: 1, staged: true, width: 512, height: 512 })
    expect(ok?.negative).toBeNull()
    expect(ok?.generation_prompt).toBe('a fox, realistic style, high quality, detailed')
  })

  it('treats an empty MODEL (an older dispatch) as the default, resolved by size', () => {
    expect(spec({ PROMPT: 'a fox', MODEL: '' }).ok?.model).toBe('flux2-klein-4b')
    expect(spec({ PROMPT: 'a fox', MODEL: '', WIDTH: '1024', HEIGHT: '1024' }).ok?.model).toBe('sd15')
  })

  it('keeps the TypeScript and Python default-model resolvers in step', () => {
    for (const [width, height] of [[256, 256], [512, 512], [512, 768], [1024, 512], [1024, 1024]] as const) {
      const resolved = spec({ PROMPT: 'p', WIDTH: String(width), HEIGHT: String(height) }).ok?.model
      expect(resolved, `${width}x${height}`).toBe(defaultImageModel(width, height))
    }
  })

  it('resolves the Turbo models with their benchmarked settings', () => {
    expect(spec({ PROMPT: 'p', MODEL: 'sdxl-turbo' }).ok).toMatchObject({ steps: 1, guidance: 0, staged: true, negative: null })
    expect(spec({ PROMPT: 'p', MODEL: 'sd-turbo' }).ok).toMatchObject({ steps: 4, guidance: 0, staged: false, negative: null })
  })

  it('records licence terms for every model, flagging the Turbo ones for verification', () => {
    expect(String(spec({ PROMPT: 'p', MODEL: 'sd15' }).ok?.license)).toContain('OpenRAIL-M')
    expect(String(spec({ PROMPT: 'p' }).ok?.license)).toContain('Apache License 2.0')
    for (const model of ['sdxl-turbo', 'sd-turbo']) {
      expect(String(spec({ PROMPT: 'p', MODEL: model }).ok?.license)).toContain('Verify before commercial use')
    }
  })

  it('rejects an unknown model rather than falling back silently', () => {
    expect(spec({ PROMPT: 'p', MODEL: 'sdxl-base' }).error).toMatch(/unknown model/)
    expect(spec({ PROMPT: 'p', MODEL: '../x' }).error).toMatch(/unknown model/)
  })

  it('refuses Turbo sizes above 512 but still allows SD1.5 up to 1024', () => {
    expect(spec({ PROMPT: 'p', MODEL: 'sdxl-turbo', WIDTH: '768', HEIGHT: '512' }).error).toMatch(/only verified up to 512/)
    expect(spec({ PROMPT: 'p', MODEL: 'sd-turbo', WIDTH: '512', HEIGHT: '1024' }).error).toMatch(/only verified up to 512/)
    expect(spec({ PROMPT: 'p', WIDTH: '1024', HEIGHT: '1024' }).ok).toMatchObject({ model: 'sd15', width: 1024, height: 1024 })
  })

  it('keeps the original prompt and size validation', () => {
    expect(spec({ PROMPT: '   ' }).error).toMatch(/prompt/)
    expect(spec({ PROMPT: 'x'.repeat(4001) }).error).toMatch(/prompt/)
    expect(spec({ PROMPT: 'p', WIDTH: '250' }).error).toMatch(/between 256 and 1024/)
    expect(spec({ PROMPT: 'p', WIDTH: '513' }).error).toMatch(/divisible by 8/)
    expect(spec({ PROMPT: 'p', WIDTH: 'abc' }).error).toMatch(/integers/)
  })
})

describe('generate_image.py caller settings', () => {
  it('carries a neutral seed and no settings notes when nothing was set', () => {
    const { ok } = spec({ PROMPT: 'a fox', MODEL: 'sd15' })
    expect(ok?.seed).toBeNull()
    expect(ok?.settings_notes).toEqual([])
    expect(ok?.negative).toContain('blurry')
  })

  it('honors steps, guidance, seed and negative prompt exactly on sd15', () => {
    const { ok } = spec({ PROMPT: 'p', MODEL: 'sd15', STEPS: '40', GUIDANCE: '9.5', SEED: '42', NEGATIVE_PROMPT: 'no text, no watermark' })
    expect(ok).toMatchObject({ steps: 40, guidance: 9.5, seed: 42, negative: 'no text, no watermark' })
    expect(ok?.settings_notes).toEqual([])
  })

  it('replaces the built-in negative prompt only when the caller sets one', () => {
    expect(spec({ PROMPT: 'p', MODEL: 'sd15' }).ok?.negative).toContain('watermark, signature')
    expect(spec({ PROMPT: 'p', MODEL: 'sd15', NEGATIVE_PROMPT: '  ' }).ok?.negative).toContain('watermark, signature')
    expect(spec({ PROMPT: 'p', MODEL: 'sd15', NEGATIVE_PROMPT: 'extra fingers' }).ok?.negative).toBe('extra fingers')
  })

  it('clamps distilled steps to the 1-4 regime and notes it, but honors a seed', () => {
    const { ok } = spec({ PROMPT: 'p', MODEL: 'sdxl-turbo', STEPS: '30', SEED: '7' })
    expect(ok).toMatchObject({ steps: 4, seed: 7 })
    expect(ok?.settings_notes as string[]).toHaveLength(1)
    expect(String((ok?.settings_notes as string[])[0])).toContain('clamped to 4')
    expect(spec({ PROMPT: 'p', MODEL: 'sd-turbo', STEPS: '3' }).ok).toMatchObject({ steps: 3, settings_notes: [] })
  })

  it('ignores guidance and negative prompts on distilled models, with notes, never silently', () => {
    const { ok } = spec({ PROMPT: 'p', MODEL: 'sdxl-turbo', GUIDANCE: '7', NEGATIVE_PROMPT: 'blur' })
    expect(ok).toMatchObject({ model: 'sdxl-turbo', guidance: 0, negative: null })
    const notes = (ok?.settings_notes as string[]).join('\n')
    expect(notes).toContain('guidance 7.0 ignored')
    expect(notes).toContain('negative prompt ignored')
  })

  it('rejects out-of-range or malformed settings', () => {
    for (const env of [
      { STEPS: '0' }, { STEPS: '151' }, { STEPS: 'abc' },
      { GUIDANCE: '-1' }, { GUIDANCE: '31' }, { GUIDANCE: 'x' },
      { SEED: '-1' }, { SEED: '2147483648' }, { SEED: '1.5' },
      { NEGATIVE_PROMPT: 'x'.repeat(1001) },
    ] as Array<Record<string, string>>) {
      expect(spec({ PROMPT: 'p', MODEL: 'sd15', ...env }).error, JSON.stringify(env)).toBeTruthy()
    }
    expect(spec({ PROMPT: 'p', MODEL: 'sd15', STEPS: '150', GUIDANCE: '30', SEED: '2147483647' }).ok).toMatchObject({ steps: 150, guidance: 30, seed: 2147483647 })
  })

  it('resolves the wired bakeoff candidate: flux2-klein-4b builds a staged spec', () => {
    const { ok } = spec({ PROMPT: 'p', MODEL: 'flux2-klein-4b', SEED: '42' })
    expect(ok).toMatchObject({
      model: 'flux2-klein-4b', repo: 'black-forest-labs/FLUX.2-klein-4B',
      steps: 4, guidance: 1.0, seed: 42, staged: true, negative: null,
    })
    expect(ok?.settings_notes).toEqual([])
  })

  it('resolves klein caller settings against its distilled regime, with notes', () => {
    const { ok } = spec({ PROMPT: 'p', MODEL: 'flux2-klein-4b', STEPS: '30', GUIDANCE: '7', NEGATIVE_PROMPT: 'blur' })
    expect(ok).toMatchObject({ steps: 4, guidance: 1.0, negative: null })
    const notes = (ok?.settings_notes as string[]).join('\n')
    expect(notes).toContain('clamped to 4')
    expect(notes).toContain('guidance 7.0 ignored')
    expect(notes).toContain('negative prompt ignored')
  })

  it('still refuses z-image-turbo: in the table, but no loader can run it on the runner', () => {
    expect(spec({ PROMPT: 'p', MODEL: 'z-image-turbo' }).error).toMatch(/bakeoff candidate whose loader is not verified/)
  })
})

describe('allowlist and workflow wiring', () => {
  it('keeps the TypeScript and Python model allowlists identical', () => {
    const r = spawnSync('python3', ['-B', '-c', `import sys, json; sys.path.insert(0, ${JSON.stringify(SCRIPT_DIR)}); import generate_image as g; print(json.dumps(sorted(g.MODELS)))`],
      { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
    expect(JSON.parse(r.stdout)).toEqual([...IMAGE_MODELS].sort())
  })

  it('advertises the model enum in the tool schema as optional', () => {
    const tool = FORGE_TOOLS.find(t => t.name === 'generate_image')!
    const props = tool.parameters.properties as Record<string, { enum?: string[] }>
    expect(props.model.enum).toEqual([...IMAGE_MODELS])
    expect(tool.parameters.required).toEqual(['prompt'])
  })

  const workflow = read('.github/workflows/generate-image.yml')

  it('pins the runner and never uses ubuntu-latest', () => {
    expect(workflow).toContain('runs-on: ubuntu-24.04')
    expect(workflow).not.toContain('ubuntu-latest')
  })

  it('passes the model through env, leaves its default empty for the script resolver, and runs the script', () => {
    expect(workflow).toMatch(/model:\n\s+description:[^\n]+\n\s+required: false\n\s+default: ''/)
    expect(workflow).not.toContain('default: sd15')
    expect(workflow).toContain('MODEL: ${{ inputs.model }}')
    expect(workflow).toContain('run: python .github/scripts/generate_image.py')
    expect(workflow).not.toContain('python - <<')
  })

  it('wires the caller settings through workflow inputs into the script env, all optional', () => {
    for (const [input, env] of [['steps', 'STEPS'], ['guidance', 'GUIDANCE'], ['seed', 'SEED'], ['negative_prompt', 'NEGATIVE_PROMPT']] as const) {
      expect(workflow, input).toMatch(new RegExp(`${input}:\\n\\s+description:[^\\n]+\\n\\s+required: false\\n\\s+default: ''`))
      expect(workflow, env).toContain(`${env}: \${{ inputs.${input} }}`)
    }
  })

  it('invalidates the model cache when the script or requirements change', () => {
    expect(workflow).toContain(".github/scripts/generate_image.py")
    expect(workflow).toContain(".github/requirements-image.txt")
  })

  it('keys the weights cache per model so one model cannot shadow another', () => {
    // actions/cache never overwrites an existing key: a shared key meant whichever model ran first
    // (sd-turbo) was cached and the others re-downloaded on every run.
    const key = workflow.split('\n').find(l => l.trim().startsWith('key: image-models-'))
    expect(key).toBeDefined()
    expect(key).toContain("inputs.model || 'auto'")
  })

  it('ships exact dependency pins, including torch', () => {
    const lines = read('.github/requirements-image.txt').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    expect(lines.length).toBeGreaterThan(5)
    for (const line of lines) expect(line, line).toMatch(/^[A-Za-z0-9_.-]+==[0-9][^\s]*$/)
    expect(workflow).toMatch(/torch==\d+\.\d+\.\d+\+cpu torchvision==\d+\.\d+\.\d+\+cpu/)
  })

  it('uploads the structured metadata alongside the PNG', () => {
    expect(workflow).toContain('generation_meta.json')
  })

  it('parses as valid Python without writing bytecode', () => {
    const r = spawnSync('python3', ['-B', '-c', `import ast,sys; ast.parse(open(${JSON.stringify(SCRIPT_DIR + '/generate_image.py')}).read())`], { encoding: 'utf8' })
    expect(r.status).toBe(0)
  })
})

describe('generate_image dispatch', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()) })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
  const ctx = (): ToolContext => ({ ghToken: 't', ghOwner: 'o', ghRepo: 'r', actor: 'operator', requestGuardianApproval: async () => true })
  const call = (input: Record<string, unknown>) => ({ id: '1', name: 'generate_image', input })

  function dispatchMock() {
    // The dispatch is made to fail so the test stops right after capturing the body.
    return vi.fn(async (url: string, init?: RequestInit) => String(url).endsWith('/generate-image.yml/dispatches') && init?.method === 'POST'
      ? new Response('nope', { status: 500 })
      : new Response('{}', { status: 404 }))
  }
  const dispatched = (m: ReturnType<typeof dispatchMock>) => {
    const hit = m.mock.calls.find(([url]) => String(url).endsWith('/generate-image.yml/dispatches'))
    return hit ? JSON.parse((hit[1] as RequestInit).body as string) : undefined
  }

  it('sends model flux2-klein-4b when none is given at the default 512 size', async () => {
    const m = dispatchMock(); vi.stubGlobal('fetch', m)
    await executeTool(call({ prompt: 'a fox' }), ctx())
    expect(dispatched(m).inputs.model).toBe('flux2-klein-4b')
  })

  it('sends model sd15 when none is given above 512, the only size it is verified at', async () => {
    const m = dispatchMock(); vi.stubGlobal('fetch', m)
    await executeTool(call({ prompt: 'a fox', width: 1024, height: 1024 }), ctx())
    expect(dispatched(m).inputs.model).toBe('sd15')
  })

  it('passes an explicit allowed model through', async () => {
    const m = dispatchMock(); vi.stubGlobal('fetch', m)
    await executeTool(call({ prompt: 'a fox', model: 'sdxl-turbo' }), ctx())
    expect(dispatched(m).inputs.model).toBe('sdxl-turbo')
  })

  it('rejects an unknown model before any dispatch', async () => {
    const m = dispatchMock(); vi.stubGlobal('fetch', m)
    const out = await executeTool(call({ prompt: 'a fox', model: 'flux' }), ctx())
    expect(out).toMatch(/TOOL ERROR/)
    expect(out).toContain('Unknown image model')
    expect(dispatched(m)).toBeUndefined()
  })

  it('rejects a Turbo model above 512 before any dispatch', async () => {
    const m = dispatchMock(); vi.stubGlobal('fetch', m)
    const out = await executeTool(call({ prompt: 'a fox', model: 'sd-turbo', width: 1024, height: 1024 }), ctx())
    expect(out).toMatch(/TOOL ERROR/)
    expect(out).toContain('only verified up to 512')
    expect(dispatched(m)).toBeUndefined()
  })

  it('passes caller settings to the workflow exactly as set', async () => {
    const m = dispatchMock(); vi.stubGlobal('fetch', m)
    await executeTool(call({ prompt: 'a fox', model: 'sd15', steps: 40, guidance: 9.5, seed: 42, negative_prompt: 'no text' }), ctx())
    const inputs = dispatched(m).inputs
    expect(inputs.steps).toBe('40')
    expect(inputs.guidance).toBe('9.5')
    expect(inputs.seed).toBe('42')
    expect(inputs.negative_prompt).toBe('no text')
  })

  it('sends no settings keys at all when none were set (the pre-wiring dispatch shape)', async () => {
    const m = dispatchMock(); vi.stubGlobal('fetch', m)
    await executeTool(call({ prompt: 'a fox' }), ctx())
    const inputs = dispatched(m).inputs
    expect(inputs).not.toHaveProperty('steps')
    expect(inputs).not.toHaveProperty('guidance')
    expect(inputs).not.toHaveProperty('seed')
    expect(inputs).not.toHaveProperty('negative_prompt')
  })

  it('rejects out-of-range settings before any dispatch', async () => {
    for (const input of [
      { steps: 0 }, { steps: 151 }, { steps: 2.5 },
      { guidance: -1 }, { guidance: 31 },
      { seed: -1 }, { seed: 2147483648 },
      { negative_prompt: 'x'.repeat(1001) },
    ]) {
      const m = dispatchMock(); vi.stubGlobal('fetch', m)
      const out = await executeTool(call({ prompt: 'a fox', model: 'sd15', ...input }), ctx())
      expect(out, JSON.stringify(input)).toMatch(/TOOL ERROR/)
      expect(dispatched(m), JSON.stringify(input)).toBeUndefined()
    }
  })

  it('refuses the bakeoff candidates before any dispatch', async () => {
    for (const model of IMAGE_BAKEOFF_MODELS) {
      const m = dispatchMock(); vi.stubGlobal('fetch', m)
      const out = await executeTool(call({ prompt: 'a fox', model }), ctx())
      expect(out).toMatch(/TOOL ERROR/)
      expect(out).toContain('bakeoff candidate')
      expect(dispatched(m)).toBeUndefined()
    }
    // And they are never a size-resolved default, at any size.
    for (const [w, h] of [[256, 256], [512, 512], [768, 768], [1024, 1024]] as const) {
      expect(IMAGE_BAKEOFF_MODELS).not.toContain(defaultImageModel(w, h))
    }
  })

  it('dispatches the wired bakeoff candidate flux2-klein-4b as an explicit model', async () => {
    const m = dispatchMock(); vi.stubGlobal('fetch', m)
    await executeTool(call({ prompt: 'a fox', model: 'flux2-klein-4b' }), ctx())
    expect(dispatched(m).inputs.model).toBe('flux2-klein-4b')
  })

  it('returns the rendered image from its mirror when Actions run discovery is blocked by browser CORS', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const pngBytes = new Uint8Array([137,80,78,71,13,10,26,10, 0,0,0,13,73,72,68,82, 0,0,0,1,0,0,0,1,8,2,0,0,0, 144,119,83,222])
    let invocationId = ''
    let mirrorReads = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/generate-image.yml/dispatches') && init?.method === 'POST') {
        invocationId = JSON.parse(String(init.body)).inputs.invocation_id
        return new Response(null, { status: 204 })
      }
      if (url.includes('/generate-image.yml/runs?')) throw new TypeError('Failed to fetch')
      if (url.includes('raw.githubusercontent.com')) {
        mirrorReads += 1
        return mirrorReads < 3 ? new Response(null, { status: 404 }) : new Response(pngBytes, { headers: { 'Content-Type': 'image/png' } })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const pending = executeTool(call({ prompt: 'a fox' }), { ...ctx(), providerId: 'nexus-intelligence' })
    let output: string | undefined
    pending.then(result => { output = result })
    for (let elapsed = 0; elapsed < 150_000 && output === undefined; elapsed += 1000) {
      await vi.advanceTimersByTimeAsync(1000)
    }

    expect(invocationId).toMatch(/^sd-/)
    expect(output).toContain('✓ Image generated by Nexus Intelligence\'s image generator')
    expect(output).toContain('recovered from the generated-image mirror')
    expect(output).toContain(`Invocation: ${invocationId}`)
    expect(output).not.toContain('via run #')
    expect(takeGeneratedImage(invocationId)).toMatch(/^data:image\/png;base64,/)
    expect(mirrorReads).toBe(3)
  })

  it('does not try the public mirror when Actions discovery reports a permission error', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/generate-image.yml/dispatches') && init?.method === 'POST') return new Response(null, { status: 204 })
      if (url.includes('/generate-image.yml/runs?')) return new Response('forbidden', { status: 403, statusText: 'Forbidden' })
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const output = await executeTool(call({ prompt: 'a fox' }), ctx())
    expect(output).toContain('GitHub HTTP 403')
    expect(output).not.toContain('recovered from the generated-image mirror')
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('raw.githubusercontent.com'))).toBe(false)
  })

  it('keeps the TypeScript validation and the Python spec in step on setting boundaries', async () => {
    // Accept/reject must agree across the boundary: a call the app validates must not be
    // refused by the runner, and vice versa. Resolution (e.g. the distilled clamp) is the
    // runner's alone, so the cases use sd15, where both sides resolve identically.
    const cases: Array<{ input: Record<string, unknown>; env: Record<string, string>; accepted: boolean }> = [
      { input: { steps: 1 }, env: { STEPS: '1' }, accepted: true },
      { input: { steps: 150 }, env: { STEPS: '150' }, accepted: true },
      { input: { steps: 151 }, env: { STEPS: '151' }, accepted: false },
      { input: { steps: 0 }, env: { STEPS: '0' }, accepted: false },
      { input: { guidance: 0 }, env: { GUIDANCE: '0' }, accepted: true },
      { input: { guidance: 30 }, env: { GUIDANCE: '30' }, accepted: true },
      { input: { guidance: 31 }, env: { GUIDANCE: '31' }, accepted: false },
      { input: { seed: 0 }, env: { SEED: '0' }, accepted: true },
      { input: { seed: 2147483647 }, env: { SEED: '2147483647' }, accepted: true },
      { input: { seed: 2147483648 }, env: { SEED: '2147483648' }, accepted: false },
      { input: { negative_prompt: 'x'.repeat(1000) }, env: { NEGATIVE_PROMPT: 'x'.repeat(1000) }, accepted: true },
      { input: { negative_prompt: 'x'.repeat(1001) }, env: { NEGATIVE_PROMPT: 'x'.repeat(1001) }, accepted: false },
    ]
    for (const { input, env, accepted } of cases) {
      const label = JSON.stringify({ input, env })
      expect(spec({ PROMPT: 'p', MODEL: 'sd15', ...env }).ok !== undefined, `python ${label}`).toBe(accepted)
      const m = dispatchMock(); vi.stubGlobal('fetch', m)
      await executeTool(call({ prompt: 'a fox', model: 'sd15', ...input }), ctx())
      expect(dispatched(m) !== undefined, `ts ${label}`).toBe(accepted)
    }
  })
})
