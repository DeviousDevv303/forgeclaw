// NEXUS Intelligence step 4 prep: SYNTHETIC grammar traces for pipeline smoke tests. NOT operator data, NOT admitted data.
//   npx vite-node nexus-llm/train/gen-synthetic-traces.ts --out <file.jsonl> [--n 3000] [--seed 7]
// Every row carries synthetic:true. Rows never enter a Guardian training set. Any prompt that matches a frozen-eval prompt is dropped.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeTranscript, validateTranscript, type Evidence, type ToolSchema, type Transcript } from '../src/grammar'
import { normalizePrompt } from '../exporter/export'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const opt = (n: string, d: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const out = opt('--out', '')
if (!out) { console.error('usage: gen-synthetic-traces.ts --out <file.jsonl> [--n 3000] [--seed 7]'); process.exit(2) }
const N = Number(opt('--n', '3000'))
let state = Number(opt('--seed', '7')) >>> 0
const rnd = () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]

const snapshot = JSON.parse(readFileSync(join(here, '../spec/tools.snapshot.json'), 'utf8')) as { tools: ToolSchema[]; notEvidenceTools: string[] }
const tools = snapshot.tools
const notEvidence = new Set(snapshot.notEvidenceTools)
const evalPrompts = new Set(readFileSync(join(here, '../eval/v1/cases.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => normalizePrompt((JSON.parse(l) as { prompt: string }).prompt)))

const files = ['README.md', 'package.json', 'src/main.tsx', 'src/lib/storage.ts', 'docs/notes.md', 'src/lib/github.ts', 'tsconfig.json', 'scripts/build.sh', 'src/App.css', 'LICENSE']
const dirs = ['src', 'docs', 'src/lib', 'scripts', 'src/components', 'public']
const topics = ['solar panel efficiency', 'the history of the bicycle', 'how bread rises', 'wind turbine blade maintenance', 'the tallest mountain in Europe', 'tide tables for Galveston', 'how vaccines work', 'the rules of cricket', 'grain prices this week', 'the speed of sound']
const subjects = ['a lighthouse in a storm', 'a red bicycle on a hill', 'a quiet harbor at dawn', 'a robot reading a book', 'a field of sunflowers', 'a snowy cabin', 'a desert road at night']
const keys = ['blade_note', 'shopping', 'gate_code_hint', 'next_task', 'tool_size', 'meeting_time']
const vals = ['check root bolts', 'milk and eggs', 'ask Sam', 'oil the hinge', '13 mm', 'tuesday at nine']
const words = ['alpha', 'beta', 'gamma', 'delta', 'omega', 'sigma', 'lambda', 'kappa']
const snippet = () => Array.from({ length: 3 + Math.floor(rnd() * 5) }, () => pick(words)).join(' ')

interface Row { id: string; synthetic: true; prompt: string; text: string; kind: string }
const rows: Row[] = []
const perKind = new Map<string, number>()
const CAP = Math.ceil(N / 9)
let dropped = 0

function emit(kind: string, prompt: string, t: Transcript): void {
  const norm = normalizePrompt(prompt)
  if (evalPrompts.has(norm)) { dropped++; return }
  const errs = validateTranscript(t, tools, notEvidence)
  if (errs.length) throw new Error(`synthetic transcript invalid (${kind}): ${errs[0]}`)
  const text = encodeTranscript(t, tools)
  if ((perKind.get(kind) ?? 0) >= CAP) return
  perKind.set(kind, (perKind.get(kind) ?? 0) + 1)
  rows.push({ id: `syn-${String(rows.length + 1).padStart(5, '0')}`, synthetic: true, prompt, text, kind })
}
const oneStep = (name: string, a: Record<string, unknown>, status: 'ok' | 'error', text: string, ev: Evidence, answer: string): Transcript =>
  ({ route: 'tool', steps: [{ call: { name, arguments: a }, result: { status, text } }], evidence: ev, answer })
const errText = () => pick(['[TOOL ERROR] GitHub 404: Not Found', '[TOOL ERROR] request timed out', '[TOOL ERROR] GitHub 403: Forbidden'])

const makers: Array<() => void> = [
  () => { const f = pick(files); const p = pick([`show me ${f}`, `open ${f}`, `what is in ${f}?`, `read the file ${f}`, `can you print ${f}`])
    const a = { path: f }; const ok = rnd() < 0.8
    emit('read', p, ok ? oneStep('github_read_file', a, 'ok', snippet(), 'verified', `Here is what ${f} contains: ${snippet().slice(0, 30)}.`) : oneStep('github_read_file', a, 'error', errText(), 'failed', `I could not read ${f}: the tool failed.`)) },
  () => { const d = pick(dirs); const p = pick([`list the files in ${d}`, `what is inside ${d}?`, `show the ${d} folder`])
    const a = { path: d }; const ok = rnd() < 0.8
    emit('list', p, ok ? oneStep('github_list_files', a, 'ok', `${pick(files)}\n${pick(files)}`, 'verified', `The folder ${d} contains the files listed above.`) : oneStep('github_list_files', a, 'error', errText(), 'failed', `I could not list ${d}: the tool failed.`)) },
  () => { const q = pick(topics); const p = pick([`look up ${q}`, `search the web for ${q}`, `find information about ${q}`, `google ${q}`])
    const a = { query: q }
    emit('search', p, oneStep('web_search', a, 'ok', snippet(), 'verified', `I searched for ${q} and found the results above.`)) },
  () => { const i = Math.floor(rnd() * keys.length); const p = pick([`remember that ${keys[i]} is ${vals[i]}`, `save ${vals[i]} as ${keys[i]}`])
    emit('memory_write', p, oneStep('memory_write', { key: keys[i], value: vals[i] }, 'ok', 'Saved', 'completed', `Saved ${keys[i]}. That is a note, not a checked fact.`)) },
  () => { const i = Math.floor(rnd() * keys.length); const p = pick([`what did I save as ${keys[i]}?`, `recall ${keys[i]}`])
    emit('memory_read', p, oneStep('memory_read', { key: keys[i] }, 'ok', vals[i], 'completed', `You saved: ${vals[i]}. That is your own note.`)) },
  () => { const s = pick(subjects); const p = pick([`generate an image of ${s}`, `make a picture of ${s}`, `create an illustration of ${s}`])
    emit('image', p, oneStep('generate_image', { prompt: s }, 'ok', 'image ready', 'completed', 'The image was generated and is shown above.')) },
  () => { const p = pick(['what is the latest commit on main?', 'give me the head sha of main', 'which commit is main on right now?'])
    emit('repo_state', p, oneStep('github_repo_state', {}, 'ok', `main at ${Math.floor(rnd() * 16 ** 7).toString(16).padStart(7, '0')}`, 'verified', 'The repository state is listed above.')) },
  () => { const p = pick(['hi there', 'hey', 'thank you so much', 'good evening', 'how are you today?', 'that is all for now', 'nice work'])
    emit('direct', p, { route: 'direct', steps: [], evidence: 'not_verified', answer: pick(['Hello! How can I help?', 'You are welcome.', 'Glad to help.']) }) },
  () => { const f = pick(files); const p = pick([`what does ${f} say about licensing?`, `tell me the version in ${f}`])
    emit('no_evidence', p, { route: 'direct', steps: [], evidence: 'not_verified', answer: `I have not read ${f}, so I cannot say. I can read it for you.` }) },
]
let guard = 0
// Uniform over kinds, capped per kind so every behaviour is represented; repeats are fine for synthetic data.
while (rows.length < N && guard++ < N * 50) pick(makers)()
writeFileSync(out, rows.map(r => JSON.stringify(r)).join('\n') + '\n')
const byKind: Record<string, number> = {}
for (const r of rows) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1
console.log(`wrote ${rows.length} SYNTHETIC rows (${dropped} dropped for matching a frozen-eval prompt) ${JSON.stringify(byKind)}`)
