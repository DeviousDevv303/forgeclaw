// NEXUS Intelligence step 4 prep: SYNTHETIC grammar traces. NOT operator data, NOT admitted data.
//   npx vite-node nexus-llm/train/gen-synthetic-traces.ts --out <file.jsonl> [--n 3000] [--seed 7]
// Every row carries synthetic:true. Rows never enter a Guardian training set. Any prompt in ANY frozen eval suite is dropped.
// Evidence labels are never hand-written: each trace takes canonicalEvidence() of its steps (the rule the eval scores against).
// Trading traces are PROPOSE-ONLY and their tool results come from the app's own ledger/market/owner-price code, run in memory.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyFundsCommand, emptyFunds, formatFundsStatus, formatProposal, FundsError, proposePosition, type FundsState, type ProposalInput } from '../../src/lib/fundsLedger'
import { formatMarkets, type KalshiMarket } from '../../src/lib/kalshiMarkets'
import { formatOwnerPrices, parseOwnerPrices } from '../../src/lib/kalshiOwnerPrices'
import { extractImagePrompt, inferImageStyle, isImageGenerationRequest } from '../../src/lib/imageRequest'
import { extractExplicitToolCall, isExplicitToolRequest, isRepositoryHeadQuestion } from '../../src/lib/codingAgentRuntime'
import { routeLiveDataQuestion } from '../../src/lib/liveDataRouting'
import { toolsForUrls } from '../../src/lib/toolExposure'
import { encodeTranscript, validateTranscript, type ToolSchema, type Transcript } from '../src/grammar'
import { normalizePrompt } from '../exporter/export'
import { canonicalEvidence, type EvalStep } from '../eval/score'
import { frozenPrompts } from '../eval/frozen-prompts'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const opt = (n: string, d: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const out = opt('--out', '')
if (!out) { console.error('usage: gen-synthetic-traces.ts --out <file.jsonl> [--n 3000] [--seed 7]'); process.exit(2) }
const N = Number(opt('--n', '3000'))
let state = Number(opt('--seed', '7')) >>> 0
const rnd = () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))

const snapshot = JSON.parse(readFileSync(join(here, '../spec/tools.snapshot.json'), 'utf8')) as { tools: ToolSchema[]; notEvidenceTools: string[] }
const tools = snapshot.tools
const notEvidence = new Set(snapshot.notEvidenceTools)
const evalPrompts = frozenPrompts()
const NOW = Date.parse('2026-10-27T12:00:00Z')

// HIGH-ENTROPY argument values (2026-10-27, run 4): run 2's model memorized a 13-subject image list instead of copying the user's
// words into the call, so every value a call carries is now combinatorial; the only way to fit the data is to copy from the prompt.
const ADJ = ['red', 'rusty', 'giant', 'tiny', 'quiet', 'neon', 'golden', 'frozen', 'muddy', 'striped', 'ancient', 'shiny', 'broken', 'wooden', 'purple', 'foggy', 'electric', 'paper', 'glass', 'copper', 'burning', 'hidden', 'floating', 'sleepy']
// Nouns and events used by eval/loop/scenarios.json (pickup truck, beaver, lighthouse, wrench, refinery; fed, bitcoin) are deliberately
// ABSENT, so a loop pass on them is copying unseen words, not recall.
const NOUN = ['tugboat', 'crane', 'forklift', 'owl', 'cactus', 'tractor', 'bridge', 'windmill', 'welder', 'drone', 'barn', 'fox', 'robot', 'pipeline', 'bulldozer', 'ladder', 'kettle', 'bison', 'train', 'castle', 'tent', 'scaffold', 'canoe', 'mailbox', 'hammer', 'kiln', 'silo', 'trawler', 'excavator', 'beehive']
const PLACE = ['in the snow', 'at dawn', 'at night', 'in a storm', 'on a hill', 'by the sea', 'in the desert', 'under neon lights', 'in a forest', 'on Mars', 'in the rain', 'at sunset', 'in a city street', 'on a frozen lake', 'inside a workshop']
const WORD = ['alpha', 'beta', 'gamma', 'delta', 'omega', 'sigma', 'lambda', 'kappa', 'river', 'stone', 'cedar', 'ember', 'harbor', 'falcon', 'quartz', 'meadow', 'signal', 'anchor', 'copper', 'thistle', 'orbit', 'lantern', 'basalt', 'willow']
const TOPIC = ['solar panel efficiency', 'how bread rises', 'tide tables', 'the rules of cricket', 'grain prices', 'the speed of sound', 'rebar sizes', 'concrete curing time', 'welding rod types', 'OSHA ladder rules', 'diesel prices', 'heat pump sizing', 'roof pitch math', 'torque specs']
const DIRS = ['src', 'docs', 'scripts', 'public', 'tests', 'lib', 'config', 'tools', 'assets', 'examples']
const EXT = ['.ts', '.md', '.json', '.py', '.sh', '.css', '.yml', '.txt']
const word = () => rnd() < 0.25 ? capNonce() : pick(WORD)
/** Half the prompts start with a capital, as people type them; a call copies the text as written (run 6 never saw a capital to copy). */
const cap = (p: string) => rnd() < 0.5 ? p.charAt(0).toUpperCase() + p.slice(1) : p
const subject = () => `${rnd() < 0.7 ? `a ${pick(ADJ)} ` : 'a '}${rnd() < 0.3 ? capNonce() : pick(NOUN)}${rnd() < 0.7 ? ` ${pick(PLACE)}` : ''}`
const topic = () => rnd() < 0.5 ? pick(TOPIC) : `${pick(TOPIC)} ${pick(['in', 'for', 'near'])} ${pick(['Houston', 'Galveston', 'Denver', 'winter', '2026', 'Texas', 'small shops'])}`
const dirName = () => rnd() < 0.4 ? pick(DIRS) : `${pick(DIRS)}/${word()}`
const fileName = () => rnd() < 0.15 ? pick(['README.md', 'package.json', 'LICENSE', 'tsconfig.json']) : `${dirName()}/${word()}${rnd() < 0.4 ? `_${word()}` : ''}${pick(EXT)}`
const memPair = (): [string, string] => [`${word()}_${pick(['note', 'code', 'task', 'size', 'time', 'list'])}`, `${pick(ADJ)} ${pick(NOUN)} ${pick(['at nine', 'on tuesday', '13 mm', 'by friday', 'twice', 'later'])}`]
// NONCE augmentation (run 8): invented words that exist nowhere else, injected into copied material (image subjects,
// file/memory/search words, Kalshi event phrases) so the copy head practises carrying ARBITRARY tokens, not just the
// pools above. Hard constraint: this vocabulary is disjoint from every frozen eval/benchmark text — asserted below
// against the raw files (exact word, substring either direction), so a future edit that collides fails generation.
const NONCE = ['zorvane', 'quindle', 'braskit', 'tomvera', 'snarpel', 'dulvane', 'kremish', 'ostelio', 'pravunda', 'jelvick', 'morvane', 'veskari', 'ondruel', 'palindra', 'skovena', 'turvello', 'azmira', 'belkora', 'drunavel', 'eskovia', 'falindra', 'gorvessa', 'halvorn', 'jorvane', 'kelvora', 'lumistra', 'norvega', 'omvessa', 'pelvane', 'quorvane', 'ristova', 'solvane', 'trevisko', 'umvella', 'vorvane', 'welskova', 'xarvane', 'yondruel', 'zelvora', 'askovar', 'brundel', 'corvessa', 'dolmere', 'ervane', 'falkora', 'gundrel', 'haskova', 'istvane']
{
  const frozenText = ['../eval/v1/cases.jsonl', '../eval/domains-v1/cases.jsonl', '../eval/loop/scenarios.json']
    .map(p => readFileSync(join(here, p), 'utf8')).join('\n').toLowerCase()
  const frozenWords = new Set(frozenText.match(/[a-z]+/g) ?? [])
  for (const w of NONCE) {
    if (frozenWords.has(w) || frozenText.includes(w)) throw new Error(`nonce word "${w}" appears in a frozen eval text`)
    for (const fw of frozenWords) if (fw.length >= 4 && w.includes(fw)) throw new Error(`nonce word "${w}" contains frozen eval word "${fw}"`)
  }
}
// Capitalized nonce (run 9 fix, Claude 2026-10-31): copy targets were always lowercase, so the copy head never learned to carry a
// CAPITALIZED span whose first tokenizer piece is a lone capital letter (Fed->['F','ed']). Confirmed on run 8: lowercase 'bitcoin'
// copied clean, capitalized 'Fed'->'E'. Half the time a nonce entity is Title-cased so the head practises lone-capital-led spans.
const capNonce = () => { const w = pick(NONCE); return rnd() < 0.5 ? w.charAt(0).toUpperCase() + w.slice(1) : w }
const styles = ['realistic', 'artistic', 'cartoon', 'anime', 'watercolor', 'oil painting', 'pixel art', 'cinematic']
const words = WORD
const snippet = () => Array.from({ length: 3 + Math.floor(rnd() * 5) }, () => pick(words)).join(' ')
/** Fictional markets: real-looking ticker shapes, invented strikes and dates. */
const cities = [['NY', 'NYC'], ['MIA', 'Miami'], ['LAX', 'Los Angeles'], ['CHI', 'Chicago'], ['AUS', 'Austin'], ['DEN', 'Denver']] as const
const fakeMarket = (): { m: KalshiMarket; name: string; query: string } => {
  const [code, city] = pick(cities), strike = int(40, 95), day = int(1, 28), ask = int(12, 88) / 100
  const ticker = `KXHIGH${code}-26NOV${String(day).padStart(2, '0')}-T${strike}`
  return { name: `${city} above ${strike}F on Nov ${day}`, query: `${city} ${strike}F`, m: { ticker, event_ticker: ticker.split('-T')[0], title: `Will the high temp in ${city} be above ${strike}F on Nov ${day}, 2026?`, status: 'active',
    close_time: `2026-11-${String(day).padStart(2, '0')}T04:59:00Z`, yes_bid_dollars: (ask - 0.02).toFixed(4), yes_ask_dollars: ask.toFixed(4), no_ask_dollars: (1 - ask + 0.02).toFixed(4),
    last_price_dollars: (ask - 0.01).toFixed(4), volume_fp: String(int(500, 50000)), volume_24h_fp: String(int(100, 9000)), open_interest_fp: String(int(100, 20000)), exchange_index: 0 } }
}
const cents = (x: number) => `$${x.toFixed(2)}`

interface Row { id: string; synthetic: true; prompt: string; text: string; kind: string; mode: 'copy' | 'create'; copySpans: string[] }
const rows: Row[] = []
const perKind = new Map<string, number>()
let dropped = 0
let CAP = 0

const S = (name: string, a: Record<string, unknown>, status: 'ok' | 'error', text: string): EvalStep => ({ name, args: a, status, text })
/** A tool trace whose evidence is the canonical label for its steps. */
const traced = (steps: EvalStep[], answer: string): Transcript =>
  ({ route: 'tool', steps: steps.map(s => ({ call: { name: s.name, arguments: s.args }, result: { status: s.status, text: s.text } })), evidence: canonicalEvidence(steps, notEvidence)[0], answer })
const direct = (answer: string): Transcript => ({ route: 'direct', steps: [], evidence: 'not_verified', answer })
function emit(kind: string, prompt: string, t: Transcript): void {
  if (evalPrompts.has(normalizePrompt(prompt))) { dropped++; return }
  const errs = validateTranscript(t, tools, notEvidence)
  if (errs.length) throw new Error(`synthetic transcript invalid (${kind}): ${errs[0]}`)
  if ((perKind.get(kind) ?? 0) >= CAP) return
  perKind.set(kind, (perKind.get(kind) ?? 0) + 1)
  // Run 8 mode + copy spans, one mechanical rule (mirrored by the harness in predict.py): a row is COPY when one of
  // its calls carries an argument value that appears verbatim in the prompt; those values are its copied spans and
  // their tokens earn extra loss weight. Everything else — composed answers, bare calls — is CREATE.
  const copySpans: string[] = []
  for (const s of t.steps) for (const v of Object.values(s.call.arguments).flatMap(x => Array.isArray(x) ? x : [x]))
    if (typeof v === 'string' && v.length >= 4 && prompt.includes(v) && !copySpans.includes(v)) copySpans.push(v)
  rows.push({ id: `syn-${String(rows.length + 1).padStart(5, '0')}`, synthetic: true, prompt, text: encodeTranscript(t, tools), kind, mode: copySpans.length ? 'copy' : 'create', copySpans })
}
const errText = () => pick(['[TOOL ERROR] GitHub 404: Not Found', '[TOOL ERROR] request timed out', '[TOOL ERROR] GitHub 403: Forbidden'])

// ─── trading helpers: the app's own code, in memory ─────────────────────────────────────────────────────────────────
const funded = (amount = int(100, 2000)): FundsState => applyFundsCommand(emptyFunds(), { kind: 'deposit', amount }, NOW).state
const rationale = (name: string, p: number) => pick([
  `The forecast for ${name} points to about ${Math.round(p * 100)}% from two independent models; the market price looks low against that.`,
  `NWS and the ensemble mean both favour ${name}; my estimate is ${Math.round(p * 100)}%, above what the contract costs.`,
  `Recent station data and the official forecast support ${name} at roughly ${Math.round(p * 100)}%, which beats the price.`,
])
function proposeStep(st: FundsState, input: ProposalInput): EvalStep {
  const a = { venue: input.venue, market: input.market, side: input.side, price: input.price, probability: input.probability, rationale: input.rationale, sources: input.sources, ...(input.mode ? { mode: input.mode } : {}) }
  try { const r = proposePosition(st, input, NOW); return S('funds_propose', a, 'ok', formatProposal(r.position, r.sizing)) }
  catch (e) { if (!(e instanceof FundsError)) throw e; return S('funds_propose', a, 'error', `[TOOL ERROR] Not proposed: ${e.message}`) }
}
const idOf = (text: string) => /Proposed (p\d+)/.exec(text)?.[1] ?? 'the proposal'
function proposalAnswer(s: EvalStep): string {
  if (s.status === 'ok') {
    const id = idOf(s.text)
    return s.args.mode === 'paper'
      ? pick([`Paper position ${id} is tracked against the phantom bankroll. No money is involved.`, `Recorded ${id} as a paper trade, so no real money moves.`])
      : pick([`Proposed ${id}. It waits for you: type /funds approve ${id} or /funds reject ${id}. I cannot place orders.`, `I proposed ${id}; nothing is placed until you approve it with /funds approve ${id}.`])
  }
  const why = s.text.replace(/^\[TOOL ERROR\] Not proposed: /, '')
  if (/No edge/.test(why)) return 'Not proposed: there is no edge, because my estimate does not beat the price.'
  if (/fees/.test(why)) return 'Not proposed: the fees eat the small edge, so the expected profit is not positive.'
  if (/No funds/.test(why)) return 'Not proposed: the ledger has no funds. You can add them with /funds add <amount>.'
  if (/source/.test(why)) return 'Not proposed: a proposal needs at least one source. I have to research it first.'
  if (/HALTED/.test(why)) return 'Not proposed: trading is halted by the loss stop. Only you can lift it with /funds resume.'
  return `Not proposed: ${why.slice(0, 120)}`
}

// ─── router-labelled families: the CALL is whatever the app's own deterministic router decides for the prompt ────────
const NOW_DATE = new Date(NOW)
const teams = ['Rangers', 'Astros', 'Lakers', 'Celtics', 'Packers', 'Bears', 'Yankees', 'Dodgers', 'Spurs', 'Rockets']
const places = ['Houston', 'Austin', 'Denver', 'Phoenix', 'Chicago', 'Miami', 'Seattle', 'Boston']
const coins = ['ethereum', 'bitcoin', 'solana', 'dogecoin', 'gold', 'the S&P 500']
const runId = () => String(int(100000000, 999999999))
const sha = () => Math.floor(rnd() * 16 ** 7).toString(16).padStart(7, '0')
/** Router output, with numeric strings turned into numbers where the tool's schema says number. Finding (app, not fixed here):
 *  routeLiveDataQuestion emits weather_forecast day:"0" although the schema declares day a number; NEXUS emits the schema type. */
const toSchema = (name: string, input: Record<string, unknown>): Record<string, unknown> => {
  const props = tools.find(t => t.name === name)?.parameters.properties ?? {}
  return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, (props[k] as { type?: string } | undefined)?.type === 'number' && typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v]))
}
const routerCall = (p: string): { name: string; input: Record<string, unknown> } | null => {
  if (isExplicitToolRequest(p)) { const c = extractExplicitToolCall(p); return c && !c.error ? { name: c.name, input: toSchema(c.name, c.input as Record<string, unknown>) } : null }
  const r = routeLiveDataQuestion(p, NOW_DATE)
  return r ? { name: r.name, input: toSchema(r.name, r.input as Record<string, unknown>) } : null
}
const okText = (name: string) => name === 'weather_forecast' ? `Forecast: high ${int(40, 99)}F, low ${int(20, 70)}F, ${pick(['sunny', 'rain likely', 'cloudy', 'windy'])}.` : snippet()
function routed(kind: string, p: string): void {
  const c = routerCall(p)
  if (!c) return
  const ok = rnd() < 0.8
  const st = S(c.name, c.input, ok ? 'ok' : 'error', ok ? okText(c.name) : errText())
  emit(kind, p, traced([st], ok ? pick(['Here is what the tool returned above.', 'The result is shown above.', `${c.name} answered; the details are above.`]) : `The ${c.name} call failed, so I cannot answer that from evidence.`))
}

const makers: Array<[string, () => void]> = [
  ['explicit', () => {
    const f = fileName(), d = dirName(), q = topic(), [k, v] = memPair()
    routed('explicit', pick([`github_read_file path="${f}"`, `github_list_files path="${d}"`, `web_search query="${q}"`, `memory_write key="${k}" value="${v}"`, `memory_read key="${k}"`,
      'memory_list', 'github_repo_state', `github_get_run_status run_id="${runId()}"`, `github_get_run_logs run_id="${runId()}"`, `github_search_code query="${word()}"`, `github_verify_commit sha="${sha()}"`]))
  }],
  ['live', () => {
    const t = pick(teams), pl = pick(places), c = pick(coins)
    routed('live', pick([`Who won the ${t} game tonight?`, `Who won the ${t} game last night?`, `What is the weather in ${pl} today?`, `What is the weather in ${pl} tomorrow?`,
      `What is the price of ${c} right now?`, `When does the ${t} game start tonight?`, `What is the score of the ${t} game right now?`]))
  }],
  ['head', () => {
    const p = pick(['show the latest main commit', 'what is the head sha?', 'what is the current head commit of main?', 'give me the latest commit sha on main', 'report the head commit'])
    if (!isRepositoryHeadQuestion(p)) return
    emit('head', p, traced([S('github_repo_state', {}, 'ok', `main at ${sha()}`)], 'The repository state is listed above.'))
  }],
  ['url', () => {
    const n = int(2, 400), rid = runId(), f = fileName(), d = dirName()
    const [p, call] = pick([
      [`Check https://github.com/DeviousDevv303/forgeclaw/pull/${n}`, { name: 'github_pr_info', input: { pull_number: String(n) } }],
      [`What happened in https://github.com/DeviousDevv303/forgeclaw/pull/${n}?`, { name: 'github_pr_info', input: { pull_number: String(n) } }],
      [`Look at https://github.com/DeviousDevv303/forgeclaw/actions/runs/${rid}`, { name: 'github_get_run_status', input: { run_id: rid } }],
      [`Why did https://github.com/DeviousDevv303/forgeclaw/actions/runs/${rid} fail?`, { name: 'github_get_run_logs', input: { run_id: rid } }],
      [`Open https://github.com/DeviousDevv303/forgeclaw/blob/main/${f}`, { name: 'github_read_file', input: { path: f } }],
      [`Show https://github.com/DeviousDevv303/forgeclaw/tree/main/${d}`, { name: 'github_list_files', input: { path: d } }],
    ] as const)
    if (!toolsForUrls(p, 'DeviousDevv303', 'forgeclaw').includes(call.name)) return // the app's router must agree with the call
    const ok = rnd() < 0.8
    emit('url', p, traced([S(call.name, { ...call.input }, ok ? 'ok' : 'error', ok ? snippet() : errText())], ok ? 'Here is what that link shows, from the tool result above.' : 'I could not read that link: the tool failed.'))
  }],
  // ── repository / web / memory (as before; labels now canonical) ──
  ['read', () => { const f = fileName(); const p = pick([`show me ${f}`, `open ${f}`, `what is in ${f}?`, `read the file ${f}`, `can you print ${f}`])
    const s = rnd() < 0.8 ? S('github_read_file', { path: f }, 'ok', snippet()) : S('github_read_file', { path: f }, 'error', errText())
    emit('read', p, traced([s], s.status === 'ok' ? `Here is what ${f} contains: ${s.text.slice(0, 30)}.` : `I could not read ${f}: the tool failed.`)) }],
  ['list', () => { const d = dirName(); const p = pick([`list the files in ${d}`, `what is inside ${d}?`, `show the ${d} folder`])
    const s = rnd() < 0.8 ? S('github_list_files', { path: d }, 'ok', `${fileName()}\n${fileName()}`) : S('github_list_files', { path: d }, 'error', errText())
    emit('list', p, traced([s], s.status === 'ok' ? `The folder ${d} contains the files listed above.` : `I could not list ${d}: the tool failed.`)) }],
  ['search', () => { const q = topic(); const p = pick([`look up ${q}`, `search the web for ${q}`, `find information about ${q}`, `google ${q}`])
    emit('search', p, traced([S('web_search', { query: q }, 'ok', snippet())], `I searched for ${q} and found the results above.`)) }],
  ['memory_write', () => { const [k, v] = memPair(); const p = pick([`remember that ${k} is ${v}`, `save ${v} as ${k}`])
    emit('memory_write', p, traced([S('memory_write', { key: k, value: v }, 'ok', 'Saved')], `Saved ${k}. That is a note, not a checked fact.`)) }],
  ['memory_read', () => { const [k, v] = memPair(); const p = pick([`what did I save as ${k}?`, `recall ${k}`])
    emit('memory_read', p, traced([S('memory_read', { key: k }, 'ok', v)], `You saved: ${v}. That is your own note.`)) }],
  ['repo_state', () => { const p = pick(['what is the latest commit on main?', 'give me the head sha of main', 'which commit is main on right now?'])
    emit('repo_state', p, traced([S('github_repo_state', {}, 'ok', `main at ${Math.floor(rnd() * 16 ** 7).toString(16).padStart(7, '0')}`)], 'The repository state is listed above.')) }],
  ['direct', () => { const p = pick(['hi there', 'hey', 'thank you so much', 'good evening', 'how are you today?', 'that is all for now', 'nice work'])
    emit('direct', p, direct(pick(['Hello! How can I help?', 'You are welcome.', 'Glad to help.']))) }],
  ['no_evidence', () => { const f = fileName(); const p = pick([`what does ${f} say about licensing?`, `tell me the version in ${f}`])
    emit('no_evidence', p, direct(`I have not read ${f}, so I cannot say. I can read it for you.`)) }],
  // ── images ──
  ['image', () => { const s = subject(), st = pick(styles)
    const p = cap(pick([`generate an image of ${s}`, `make a ${st} picture of ${s}`, `create an illustration of ${s}`, `draw ${s} in ${st} style`, `design a ${st} logo of ${s}`, `render ${s} as a ${st} wallpaper`]))
    if (!isImageGenerationRequest(p)) return
    const a: Record<string, unknown> = { prompt: extractImagePrompt(p), style: inferImageStyle(p) }
    const size = rnd() < 0.3 ? pick([[512, 512], [768, 512], [512, 768], [1024, 1024]] as const) : null
    if (size) { a.width = size[0]; a.height = size[1] }
    const turbo = size && size[0] === 512 && size[1] === 512 && rnd() < 0.5 ? pick(['sdxl-turbo', 'sd-turbo']) : null
    if (turbo) a.model = turbo
    const prompt = size ? `${p}, ${size[0]}x${size[1]}${turbo ? ` with ${turbo}` : ''}` : p
    const ok = rnd() < 0.8
    const s1 = S('generate_image', a, ok ? 'ok' : 'error', ok ? 'image ready' : pick(['[TOOL ERROR] workflow failed', '[TOOL ERROR] the image workflow timed out']))
    emit('image', prompt, traced([s1], ok ? 'The image was generated and is shown above.' : 'The image could not be generated: the workflow failed. Nothing is shown.')) }],
  ['image_analyze', () => { const p = pick(['what is in the photo I attached?', 'look at the attached picture and describe it', 'tell me what this attached image shows', 'check the attached photo for damage'])
    const thing = pick(['a rusted pipe flange', 'a cracked concrete slab', 'a forklift with a flat tire', 'a coil of copper wire', 'a scaffold missing a guardrail'])
    emit('image_analyze', p, traced([S('analyze_image', { image_url: 'attached' }, 'ok', `The picture shows ${thing}.`)], `The vision model describes ${thing}. That is its reading, not something I checked.`)) }],
  ['image_talk', () => { const p = pick(['how does stable diffusion make pictures?', 'what is an image prompt?', 'why are turbo image models limited to 512 pixels?', 'what resolution should a phone wallpaper be?'])
    if (isImageGenerationRequest(p)) return
    emit('image_talk', p, direct(pick(['I can explain in general terms, but I have not checked a source here.', 'In general terms only: I did not look this up.']))) }],
  // ── trading: propose-only ──
  ['kalshi_read', () => { const { m, name, query } = fakeMarket()
    // The call carries what the prompt carries: the ticker when one is given, otherwise the words that name the market.
    const byTicker = rnd() < 0.4
    const p = byTicker ? pick([`check Kalshi for ${m.ticker}`, `kalshi price of ${m.ticker}`, `what does ${m.ticker} trade at on Kalshi?`])
      : pick([`what is the Kalshi price for ${name}?`, `kalshi odds on ${name}`, `how likely does Kalshi think ${name} is?`])
    const q = byTicker ? { ticker: m.ticker } : { query }
    const ok = rnd() < 0.75
    const s = ok ? S('kalshi_markets', q, 'ok', formatMarkets([m], q, NOW, 1))
      : S('kalshi_markets', q, 'error', pick(['[TOOL ERROR] Kalshi could not be reached (Failed to fetch). No snapshot within 15 min to fall back to; ask again in a minute, or ask the owner for the prices they see and pass them to kalshi_owner_prices.', '[TOOL ERROR] Kalshi answered HTTP 429 (rate limited).']))
    const ask = Number(m.yes_ask_dollars)
    emit('kalshi_read', p, traced([s], ok ? `Kalshi's YES ask for ${m.ticker} is ${cents(ask)}, an implied ${Math.round(ask * 100)}%. That is a price, not a guarantee.`
      : 'I could not read Kalshi, so I have no price. If you tell me the price you see, I can use it as your number.')) }],
  ['kalshi_search', () => {
    const ev = rnd() < 0.3 ? pick([`${pick(NONCE)} futures above ${int(20, 900)}`, `the ${pick(NONCE)} index at a record high`, `${pick(NONCE)} coin above ${int(2, 90)} dollars`, `a ${pick(NONCE)} shortage in Texas`])
      : pick(['Tesla above 300', 'Nvidia beating earnings', 'the ECB cutting rates', 'Apple above 250', 'Ohio State winning', 'the Lakers winning', 'Toyota recalls', 'OPEC cutting output', 'recession', 'unemployment', 'gas prices', 'rain in Seattle', 'snow in Denver', 'inflation', 'ethereum above 5k', 'a government shutdown', 'the S&P 500 record', 'gold above 3000', 'a hurricane landfall', 'egg prices'])
    const when = pick(['', ' this month', ' in December', ' by Friday', ' this year'])
    const p = pick([`What are the Kalshi odds on ${ev}${when}?`, `What does Kalshi charge for ${ev}${when}?`, `Show me Kalshi markets about ${ev}`, `How likely does Kalshi think ${ev} is${when}?`])
    const query = ev.replace(/^(a |the )/, '')
    const ask = int(5, 95) / 100, ticker = `KX${query.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 8)}-26${pick(['NOV', 'DEC'])}`
    const m: KalshiMarket = { ticker, title: `Will ${query} happen${when || ' this year'}?`, status: 'active', close_time: '2026-12-31T23:00:00Z', yes_bid_dollars: (ask - 0.02).toFixed(4), yes_ask_dollars: ask.toFixed(4), no_ask_dollars: (1.02 - ask).toFixed(4), last_price_dollars: (ask - 0.01).toFixed(4), volume_fp: String(int(500, 90000)), volume_24h_fp: String(int(100, 9000)), open_interest_fp: String(int(100, 20000)), exchange_index: 0 }
    const found = rnd() < 0.8
    const res = formatMarkets(found ? [m] : [], { query }, NOW, found ? 1 : int(200, 900))
    emit('kalshi_search', p, traced([S('kalshi_markets', { query }, 'ok', res)], found ? `Kalshi's YES ask on ${ticker} is ${cents(ask)}, an implied ${Math.round(ask * 100)}%. That is a price, not a guarantee.` : `Kalshi lists no open market matching "${query}". I will not guess a price.`)) }],
  ['owner_prices', () => { const { m } = fakeMarket(); const c = int(5, 95)
    const prices = `${m.ticker} ${pick(['yes', 'no'])} ${c}c`
    const p = pick([`kalshi is down, I see ${prices}`, `use my price: ${prices}`, `the app shows ${prices}, go with that`])
    emit('owner_prices', p, traced([S('kalshi_owner_prices', { prices }, 'ok', formatOwnerPrices(parseOwnerPrices(prices)))], `Using your price of ${cents(c / 100)} for ${m.ticker}. That is the owner's number, not market data I read.`)) }],
  ['funds_status', () => { const st = rnd() < 0.2 ? { ...funded(), halted: { at: NOW, reason: 'Daily loss limit reached.' } } : funded()
    const p = pick(['what is my bankroll?', 'how much can I trade with?', 'show my funds', 'what positions are open?', 'can you trade for me today?', 'plan some bets with my money'])
    const bank = /Bankroll (\$[\d,.]+)/.exec(formatFundsStatus(st, NOW))?.[1] ?? 'the amount shown'
    emit('funds_status', p, traced([S('funds_status', {}, 'ok', formatFundsStatus(st, NOW))], st.halted ? 'Trading is halted by the loss stop, so I will propose nothing real. Only you can lift it with /funds resume.' : `Your bankroll is ${bank}. ForgeClaw records funds; it never holds or moves money.`)) }],
  ['propose', () => { const { m, name } = fakeMarket(); const price = Number(m.yes_ask_dollars)
    const roll = rnd()
    const prob = roll < 0.55 ? Math.min(0.97, price + int(6, 20) / 100) : roll < 0.75 ? Math.max(0.03, price - int(1, 10) / 100) : Math.min(0.97, price + 0.004)
    const st = rnd() < 0.1 ? emptyFunds() : rnd() < 0.1 ? { ...funded(), halted: { at: NOW, reason: 'Daily loss limit reached.' } } : funded()
    const input: ProposalInput = { venue: 'kalshi', market: m.ticker, side: 'yes', price, probability: Math.round(prob * 1000) / 1000, rationale: rationale(name, prob), sources: rnd() < 0.08 ? [] : [`kalshi_markets ${m.ticker}`, 'https://forecast.weather.gov/'], ...(rnd() < 0.25 ? { mode: 'paper' as const } : {}) }
    const p = input.mode === 'paper' ? pick([`paper trade ${name}`, `track a paper bet on ${name}`]) : pick([`put money on ${name}`, `bet on ${name}`, `propose a trade on ${name}`, `buy yes on ${m.ticker}`])
    const read = S('kalshi_markets', { ticker: m.ticker }, 'ok', formatMarkets([m], { ticker: m.ticker }, NOW, 1))
    const prop = proposeStep(st, input)
    emit('propose', p, traced(rnd() < 0.5 ? [read, prop] : [prop], proposalAnswer(prop))) }],
  ['settle', () => { const p = pick(['settle my kalshi bets', 'did any of my kalshi positions finish? settle them', 'check every placed kalshi position'])
    const t = pick(['No placed Kalshi positions to settle.', 'p4 settled from Kalshi: won, +$3.12.', 'p2 is still open on Kalshi (no result yet).'])
    emit('settle', p, traced([S('funds_settle', { id: 'all' }, 'ok', t)], `Settled from Kalshi's own result: ${t}`)) }],
  ['owner_only', () => { const id = `p${int(1, 9)}`
    const amt = int(5, 500)
    const [p, cmd] = pick([[`approve ${id}`, `/funds approve ${id}`], [`go ahead and place ${id}`, `/funds approve ${id}`], [`approve ${id} and place it now`, `/funds approve ${id}`], [`place ${id} for me`, `/funds approve ${id}`],
      [`reject ${id}`, `/funds reject ${id}`], [`add $${amt} to my bankroll`, '/funds add <amount>'], [`move $${amt} into my Kalshi bankroll`, '/funds add <amount>'], [`put $${amt} of my money into trading`, '/funds add <amount>'],
      [`set autoapprove to $${amt}`, '/funds limits autoapprove=<amount>'], [`turn on autoapprove at $${amt}`, '/funds limits autoapprove=<amount>'], [`switch autoapprove on for bets under $${amt}`, '/funds limits autoapprove=<amount>'],
      ['resume trading', '/funds resume'], ['stop all trading now', '/funds halt'], ['halt everything', '/funds halt']] as const)
    emit('owner_only', p, direct(`Only you can do that: type ${cmd}. I can propose positions, but I cannot approve, place or move money.`)) }],
  ['price_trap', () => { const { m, name } = fakeMarket()
    emit('price_trap', pick([`just tell me the price of ${m.ticker}`, `what does ${name} cost on Kalshi, roughly?`]), direct('I have not read Kalshi in this conversation, so I will not guess a price. I can look it up.')) }],
]
CAP = Math.ceil(N / makers.length)
let guard = 0
// Uniform over kinds, capped per kind so every behaviour is represented; repeats are fine for synthetic data.
while (rows.length < N && guard++ < N * 80) pick(makers)[1]()
writeFileSync(out, rows.map(r => JSON.stringify(r)).join('\n') + '\n')
const byKind: Record<string, number> = {}
for (const r of rows) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1
console.log(`wrote ${rows.length} SYNTHETIC rows (${dropped} dropped for matching a frozen-eval prompt) ${JSON.stringify(byKind)}`)
