// @vitest-environment node
// The image adapter makes generate-image.yml model-swappable. These tests pin what must not drift:
// SD1.5 stays the default, the TS allowlist matches the Python one, Turbo models never get a size
// they were not benchmarked at, the runner is pinned, and the dependencies are exact pins.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeTool, FORGE_TOOLS, IMAGE_MODELS, type ToolContext } from './forgeTools'

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
  it('defaults to Stable Diffusion 1.5 with the previous settings', () => {
    const { ok } = spec({ PROMPT: 'a fox' })
    expect(ok).toMatchObject({ model: 'sd15', repo: 'runwayml/stable-diffusion-v1-5', steps: 30, guidance: 7.5, staged: false, width: 512, height: 512 })
    expect(ok?.negative).toContain('blurry')
    expect(ok?.generation_prompt).toBe('a fox, realistic style, high quality, detailed')
  })

  it('treats an empty MODEL (an older dispatch) as the default', () => {
    expect(spec({ PROMPT: 'a fox', MODEL: '' }).ok?.model).toBe('sd15')
  })

  it('resolves the Turbo models with their benchmarked settings', () => {
    expect(spec({ PROMPT: 'p', MODEL: 'sdxl-turbo' }).ok).toMatchObject({ steps: 1, guidance: 0, staged: true, negative: null })
    expect(spec({ PROMPT: 'p', MODEL: 'sd-turbo' }).ok).toMatchObject({ steps: 4, guidance: 0, staged: false, negative: null })
  })

  it('records licence terms for every model, flagging the Turbo ones for verification', () => {
    expect(String(spec({ PROMPT: 'p' }).ok?.license)).toContain('OpenRAIL-M')
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
    expect(spec({ PROMPT: 'p', WIDTH: '1024', HEIGHT: '1024' }).ok).toMatchObject({ width: 1024, height: 1024 })
  })

  it('keeps the original prompt and size validation', () => {
    expect(spec({ PROMPT: '   ' }).error).toMatch(/prompt/)
    expect(spec({ PROMPT: 'x'.repeat(4001) }).error).toMatch(/prompt/)
    expect(spec({ PROMPT: 'p', WIDTH: '250' }).error).toMatch(/between 256 and 1024/)
    expect(spec({ PROMPT: 'p', WIDTH: '513' }).error).toMatch(/divisible by 8/)
    expect(spec({ PROMPT: 'p', WIDTH: 'abc' }).error).toMatch(/integers/)
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

  it('passes the model through env, defaults it to sd15, and runs the script', () => {
    expect(workflow).toMatch(/model:\n\s+description:[^\n]+\n\s+required: false\n\s+default: sd15/)
    expect(workflow).toContain('MODEL: ${{ inputs.model }}')
    expect(workflow).toContain('run: python .github/scripts/generate_image.py')
    expect(workflow).not.toContain('python - <<')
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
    expect(key).toContain("inputs.model || 'sd15'")
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
  afterEach(() => { vi.unstubAllGlobals() })
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

  it('sends model sd15 when none is given', async () => {
    const m = dispatchMock(); vi.stubGlobal('fetch', m)
    await executeTool(call({ prompt: 'a fox' }), ctx())
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
})
