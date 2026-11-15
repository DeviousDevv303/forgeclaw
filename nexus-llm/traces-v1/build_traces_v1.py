#!/usr/bin/env python3
"""traces-v1 builder — Nexus multi-domain training program, build step 2.

Part 1: shell census (counted, never estimated) over the named sources.
Part 2: trace sets v1 for the tool-use and context-window domains, shaped
from verified corpora only (fallacy-audit ledger, watcher proving record,
PR #337 incident record, tonight's live-search incident records), in the
run-9 dataset row format ({id, synthetic, prompt, text, kind, mode,
copySpans}) plus an embedded provenance sidecar per trace-shaper-design.md
section 3.2. Leakage ban enforced mechanically (frozen prompt match,
frozen ticker match, 48-char normalized shingle overlap vs every frozen
file) plus pre-registered identity exclusions. No training is launched.
"""
import json, re, os, glob, collections, datetime, hashlib

H = os.path.expanduser
WS = H('~/workspace')
OUT = os.path.join(WS, 'nexus-llm', 'traces-v1')
os.makedirs(OUT, exist_ok=True)
NOW = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

# ---------------------------------------------------------------- census
census = {}

intake_path = os.path.join(WS, 'canary', 'nexus-intake.jsonl')
intake_lines = [l for l in open(intake_path).read().splitlines() if l.strip()]
kinds = collections.Counter()
shell_mentions = 0
cmdpat = re.compile(r'\b(git |curl |npm |npx |vitest|tsc|eslint|wrangler|python3? |gh |sha256|grep )')
outpat = re.compile(r'(exit|passed|green|succeeded|success|failed|error|verified|matched|returned|HTTP \d|ran )', re.I)
cmd_outcome_lines = 0
for l in intake_lines:
    try:
        r = json.loads(l)
    except Exception:
        kinds['<unparseable>'] += 1
        continue
    kinds[r.get('kind', '<none>')] += 1
    if 'shell' in l.lower():
        shell_mentions += 1
    if cmdpat.search(l) and outpat.search(l):
        cmd_outcome_lines += 1
census['intake'] = {
    'total_lines': len(intake_lines), 'kinds': dict(kinds.most_common()),
    'lines_mentioning_shell': shell_mentions,
    'prose_lines_with_command_and_outcome_tokens': cmd_outcome_lines,
    'usable_shell_traces': 0,
    'note': 'No intake record is a shell-execution record: no kind carries an invoked command plus its structured outcome. The command+outcome lines are Bank/audit prose that mention commands inside narratives (e.g. the F-037..F-039 parser records).',
}

prov = json.load(open(os.path.join(WS, 'fleet', 'watcher-proving.json')))
grades = prov['grades']
gf_records = sum(1 for g in grades if 'git fetch' in json.dumps(g)) + \
             sum(1 for dv in prov['divergences'] if 'git fetch' in json.dumps(dv))
census['watcher_proving'] = {
    'graded_reports': len(grades), 'divergences': len(prov['divergences']),
    'clean_grades': sum(1 for g in grades if str(g.get('verdict', '')).startswith('CLEAN')),
    'divergence_grades': sum(1 for g in grades if str(g.get('verdict', '')).startswith('DIVERGENCE')),
    'records_of_git_fetch_crosscheck_command_plus_outcome': gf_records,
    'usable_shell_traces': gf_records,
    'note': 'Each git-fetch cross-check is a real (command + outcome) shell episode recorded in prose inside a grade/divergence entry: the command was run by the grader and its result decided the verdict. The remaining grade verifications were API/D1 reads (tool calls, not shell).',
}

ledger = open(os.path.join(WS, 'fallacy-audit', 'LEDGER.md')).read()
finding_rows = {}
for line in ledger.splitlines():
    m = re.match(r'^\| (F-\d{3}) \| (.*)', line)
    if m:
        fid, rest = m.group(1), m.group(2)
        parts = [p.strip() for p in rest.split('|')]
        if fid not in finding_rows or len(parts[0]) > len(finding_rows[fid]['claim']):
            finding_rows[fid] = {'claim': parts[0],
                                 'evidence': parts[1] if len(parts) > 1 else '',
                                 'status': '|'.join(parts[2:]) if len(parts) > 2 else '',
                                 'row': line}
headless_rows = sum(1 for r in finding_rows.values() if 'headless' in (r['claim'] + r['evidence']).lower())
census['fallacy_ledger'] = {
    'finding_ids_total': 39,
    'finding_rows_in_table': len(finding_rows),
    'finding_carried_in_pass_prose_only': ['F-017'],
    'table_rows_whose_verification_was_an_executed_headless_run': headless_rows,
    'whole_file_headless_mentions': ledger.count('headless'),
    'whole_file_vitest_mentions': ledger.count('vitest'),
    'whole_file_structured_N_over_N_outcome_strings': len(re.findall(r'\d+/\d+', ledger)),
    'usable_shell_traces': headless_rows,
    'note': 'A table row marked headless records at least one executed verification run (scratch vitest / real-code headless run) with its outcome deciding the verdict — e.g. F-039: real parseNexusIntake over the published 534-line file -> 511 records. Pass-log prose carries many more executed gate runs (the N/N strings), not individually trace-shaped.',
}

ac_files = glob.glob(os.path.join(WS, 'agent-channel', '*.md'))
ac_shell_files = [f for f in ac_files if 'shell_exec' in open(f).read()]
ac_shell_mentions = sum(open(f).read().count('shell_exec') for f in ac_files)
census['agent_channel'] = {
    'files': len(ac_files), 'files_mentioning_shell_exec': len(ac_shell_files),
    'shell_exec_mentions': ac_shell_mentions, 'usable_shell_traces': 0,
    'note': 'Mentions are directives/discussion about the shell tool (incl. the ForgeClaw shell_exec design thread), not executed (command + outcome) records.',
}

cron_files = [f for f in glob.glob(os.path.join(WS, 'cron.d', '**', '*'), recursive=True) if os.path.isfile(f)]
cron_live = [f for f in cron_files if '_archive' not in f and '_invalid' not in f]
cron_cmd_bodies = [f for f in cron_files if re.search(r'`(git|curl|npm|python)', open(f).read())]
census['cron_bodies'] = {
    'total_files': len(cron_files), 'live_files': len(cron_live),
    'archived_files': len(cron_files) - len(cron_live),
    'bodies_with_verbatim_shell_commands': len(cron_cmd_bodies),
    'bodies_that_are_shell_scripts': 0, 'usable_shell_traces': 0,
    'note': 'Job bodies are prose instructions to agents. Exactly one live body (fleet-watcher) prescribes verbatim shell commands (git fetch origin main + git log -1 in a scratch clone) as its freshness cross-check; a prescription is not an execution record.',
}

log_files = sorted(glob.glob(H('~/memory/2026-10-*.md')))
tot_shell_exec = 0
strict_lines = 0
for f in log_files:
    for line in open(f):
        if 'shell_exec' in line:
            tot_shell_exec += 1
            if outpat.search(line):
                strict_lines += 1
census['daily_logs'] = {
    'files': len(log_files), 'shell_exec_mention_lines': tot_shell_exec,
    'mention_lines_also_carrying_an_outcome_token': strict_lines,
    'usable_shell_traces': 0,
    'note': 'Daily logs journal shell_exec design decisions, wiring history and directives in prose. Even the lines that pair a mention with an outcome word do not carry the invoked command string plus its structured result, so none are trace-usable as recorded.',
}

scratch = os.path.join(WS, '.scratch')
deploys = {os.path.basename(f)[len('nb_deploy_'):-3] for f in glob.glob(os.path.join(scratch, 'nb_deploy_*.py'))}
verifies = {os.path.basename(f)[len('nb_verify_deploy_'):-3] for f in glob.glob(os.path.join(scratch, 'nb_verify_*.py'))}
pairs = deploys & verifies
nb_py = glob.glob(os.path.join(scratch, 'nb_*.py'))
watch_sh = glob.glob(os.path.join(WS, 'nb_watch*.sh')) + glob.glob(os.path.join(WS, 'nb_overnight.sh'))
watch_logs = glob.glob(os.path.join(WS, 'nb_watch*.log')) + glob.glob(os.path.join(WS, 'nb_overnight.log'))
census['bank_scripts'] = {
    'nb_deploy_scripts': len(deploys), 'nb_verify_deploy_scripts': len(verifies),
    'deploy_verify_pairs': len(pairs), 'nb_python_files_in_scratch': len(nb_py),
    'watch_shell_scripts': len(watch_sh), 'watch_logs': len(watch_logs),
    'usable_shell_traces': 0,
    'note': 'The deploy/verify scripts are codified shell operations (each deploy script posts a bundle, each verify script checks 10 bindings and deployment at 100%) and the watch scripts/logs are command+output streams, but none of them is journaled as a graded (command + outcome) episode in a corpus record; they are a shaping source for a later pass, counted here as artifacts, not traces.',
}

run9_kinds = collections.Counter()
for l in open(os.path.join(WS, 'run9-combination', 'data.jsonl')):
    try:
        k = json.loads(l).get('kind', '')
    except Exception:
        continue
    if k.startswith('shell'):
        run9_kinds[k] += 1
census['run9_synthetic_shell_rows'] = {
    'counts': dict(run9_kinds), 'label': 'synthetic:true — context only, NOT census material (the census counts real records only)',
}

# ------------------------------------------------------------- frozen sets
FROZEN_FILES = []
for pat in ['run8-reads/nexus-llm/eval/v1/cases.jsonl',
            'run8-reads/nexus-llm/eval/domains-v1/cases.jsonl',
            'run8-reads/nexus-llm/eval/capbench-v1.1.jsonl',
            'run8-reads/nexus-llm/eval/capbench-heldout-v1.1.jsonl',
            'run8-reads/nexus-llm/eval/capbench-affect-v1.jsonl',
            'run8-reads/nexus-llm/eval/unrestrict-v1.jsonl',
            'run8-reads/nexus-llm/eval/unrestrict-heldout-v1.jsonl',
            'run8-reads/nexus-llm/eval/frozen-prompts.ts',
            'fleet-specs/watcher-q-fixtures.jsonl',
            'fleet-specs/curator-fixtures.jsonl',
            'nexus-trading-benchmark/frozen-set-v1.jsonl']:
    p = os.path.join(WS, pat)
    if os.path.exists(p):
        FROZEN_FILES.append(p)
for d in ['run8-reads/nexus-llm/eval/coding', 'run8-reads/nexus-llm/eval/loop']:
    FROZEN_FILES += [f for f in glob.glob(os.path.join(WS, d, '**', '*'), recursive=True) if os.path.isfile(f)]

def norm(s):
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9 ]', ' ', s.lower())).strip()

frozen_prompts = set()
frozen_tickers = set()
shingle_index = {}   # shingle -> source label
SH = 48
CONTENT_DENSE = ('watcher-q-fixtures.jsonl', 'curator-fixtures.jsonl', 'frozen-set-v1.jsonl')

def _shingle(text, label):
    n = norm(text)
    for i in range(0, max(0, len(n) - SH), 12):
        shingle_index.setdefault(n[i:i + SH], label)

def _strings_deep(o):
    if isinstance(o, str):
        yield o
    elif isinstance(o, dict):
        for v in o.values():
            yield from _strings_deep(v)
    elif isinstance(o, list):
        for v in o:
            yield from _strings_deep(v)

for p in FROZEN_FILES:
    raw = open(p, errors='replace').read()
    label = os.path.relpath(p, WS)
    base = os.path.basename(p)
    if base in CONTENT_DENSE:
        # Fixture/trading files are exam content end-to-end: shingle everything.
        _shingle(raw, label)
    for l in raw.splitlines():
        l = l.strip()
        if l.startswith('{'):
            try:
                r = json.loads(l)
            except Exception:
                continue
            for key in ('prompt', 'question', 'input'):
                v = r.get(key)
                if isinstance(v, str) and v:
                    frozen_prompts.add(norm(v))
            frozen_tickers |= set(re.findall(r'KX[A-Z0-9][A-Z0-9\-]+', json.dumps(r)))
            if base not in CONTENT_DENSE:
                # Eval suites: the content payload is the item's prompt plus the
                # string values inside its expected call/answer — shingle those,
                # NOT the file's raw bytes (whose gold-call JSON is the same
                # transcript scaffolding every training row shares by design).
                payload = []
                if isinstance(r.get('prompt'), str):
                    payload.append(r['prompt'])
                for key in ('expect', 'expected', 'gold', 'answer'):
                    if key in r:
                        payload += list(_strings_deep(r[key]))
                _shingle(' '.join(payload), label)
frozen_tickers |= set(re.findall(r'KX[A-Z0-9][A-Z0-9\-]+', open(os.path.join(WS, 'nexus-trading-benchmark', 'frozen-set-v1.jsonl')).read()))

def trace_content(trace):
    """The fact-carrying parts of a trace: its prompt, its result blocks and
    its answer block. The <|call|> transcript header is excluded — it is the
    grammar scaffolding every run-9 row and every eval gold share by design;
    the leakage ban protects exam CONTENT, not the shared format."""
    parts = [trace['prompt']]
    parts += re.findall(r'<\|result:ok\|>(.*?)<\|/result\|>', trace['text'])
    parts += re.findall(r'<\|answer\|>(.*?)<\|/answer\|>', trace['text'])
    return ' '.join(parts)

def leakage(trace):
    """Returns a drop reason string, or None if clean."""
    if norm(trace['prompt']) in frozen_prompts:
        return 'frozen_eval_prompt'
    for t in re.findall(r'KX[A-Z0-9][A-Z0-9\-]+', trace['prompt'] + trace['text']):
        if t in frozen_tickers:
            return 'frozen_trading_benchmark_v1:' + t
    n = norm(trace_content(trace))
    for i in range(0, max(0, len(n) - SH), 12):
        hit = shingle_index.get(n[i:i + SH])
        if hit:
            return 'frozen_shingle_overlap:' + hit
    return None

# ---------------------------------------------------------------- helpers
def prov(run_id, source, ref, check, label_source='grader_recorded', guardian=False, value_source='prose'):
    return {'run_id': run_id, 'source': source, 'ref': ref, 'check': check,
            'label': 'real', 'synthetic': False, 'label_source': label_source,
            'value_source': value_source, 'guardian_eligible': guardian,
            'shaper_version': 'traces-v1', 'shaped_at': NOW}

def mkrow(rid, prompt, text, kind, provenance):
    spans = []
    for cand in re.findall(r'(F-\d{3}|src/[\w./\-]+|[\w./\-]+\.ts:\d+|Watcher Report \d+)', prompt):
        if cand in text and cand not in spans:
            spans.append(cand)
    return {'id': rid, 'synthetic': False, 'prompt': prompt, 'text': text,
            'kind': kind, 'mode': 'copy' if spans else 'create',
            'copySpans': spans, 'provenance': provenance}

def transcript(call_name, call_args, result, ev, answer, result_ok=True):
    return ('<|route:tool|><|call|>' + json.dumps({'name': call_name, 'arguments': call_args}) +
            '<|/call|><|result:ok|>' + result + '<|/result|><|ev:' + ev + '|>' +
            '<|answer|>' + answer + '<|/answer|><|end|>')

# ------------------------------------------------------- fallacy traces
# verdict + disposition per finding, from the ledger rows read at build time.
DROP_FINDINGS = {
    'F-001': 'frozen_item_identity:curator-fixtures CU-01 candidate is this finding\'s intake record',
    'F-008': 'frozen_item_identity:curator-fixtures CU-15 candidate is this finding\'s record with the ref mutated to F-099 (near-duplicate of a frozen item)',
    'F-037': 'frozen_item_identity:curator-fixtures CU-09..CU-13 candidates are the five intake records this finding is about',
    'F-038': 'frozen_item_identity:curator-fixtures CU-03/CU-14 candidate ref m-1793294098053-1ddd3534 is this finding\'s subject record',
}
# per-finding shaping: (tool, args, result, ev, verdict, status_note)
F_SHAPE = {
 'F-002': ('github_read_file', {'path': 'src/lib/kalshiExecution.ts'},
   'kalshiExecution.ts:231 asserts the API does not move funds between shards. The Kalshi OpenAPI spec (v3.34.0) defines POST /portfolio/intra_exchange_instance_transfer — the transfer endpoint exists.',
   'verified', 'CONFIRMED', 'FIXED — owner merged #248 (eac1ae7, 2026-10-23); fix live on main.'),
 'F-003': ('github_read_file', {'path': 'src/lib/fundsLedger.ts'},
   'Two approval paths carried identical words with different consequences: chat-approve recorded only; typed/panel approve actually sent. The Activity panel said COMPLETE on the path that sent nothing (recorded 2026-10-23, #235 comment 6358517860).',
   'completed', 'CONFIRMED', 'FILED — the chat-approve mechanism no longer exists on main 597f05f (only typed /funds commands reach approval); the trap was removed by the rework.'),
 'F-004': ('http_fetch', {'url': 'ingles-con-calma deployed site'},
   'The deployed ingles-con-calma site answers live (HTTP 200) while its task banner read UNFINISHED; in the paired case the Activity panel read COMPLETE on an approval that was never sent (#235 comment 6358557150). The status layer reports both directions without a read-back.',
   'verified', 'CONFIRMED', 'FILED — fix queued behind #248 (readback discipline).'),
 'F-005': ('memory_read', {'key': 'corpus state'},
   'Screen dump 2026-10-23: the provider answered from stale corpus as gospel — it stated the repo was "private" and HEAD sat at Oct 20; both were wrong when said. The retrieved record was stale and was presented as current fact.',
   'completed', 'CONFIRMED', 'FILED — quarantine + batch-purge-by-run-ID is the queued prescription.'),
 'F-006': ('github_read_file', {'path': 'README.md'},
   'README line 73 still says the sculpt unlock "lasts 2 hours"; unlocks have persisted since #181. The doc states a lifetime the code no longer implements.',
   'completed', 'CONFIRMED', 'FILED — doc line stale vs the shipped unlock behavior.'),
 'F-007': ('web_search', {'query': 'OKC weather (live app turns, 2026-10-23)'},
   'Live app turns returned link lists without extracted data — the OKC weather questions were never answered from the results. A list of links is not an extraction.',
   'completed', 'CONFIRMED', 'Addressed in #249 (merged 0763c63, 2026-10-23).'),
 'F-009': ('shell_exec', {'command': 'headless: kalshiCredentialPresence() (kalshiAuth.ts:83) + targeted gate on the panel row vs the approve path'},
   'kalshiCredentialPresence() returns {keyId, privateKey} as separate halves. The Connectors panel asserted Kalshi ON from the key-ID half alone (src/App.tsx:3425, old) while the approve path refuses key-ID-only state: "no Kalshi private key saved in this browser (key ID is saved)".',
   'verified', 'CONFIRMED', 'FIXED — draft PR #257 (muse/f009-kalshi-panel-both-halves, head a096a430, byte-verified): the row now requires both halves.'),
 'F-010': ('shell_exec', {'command': 'headless: exercise safeSetItem failure paths for provider keys, chat history and the corpus blob'},
   'The F-001 defect class is still live outside the read-back paths: fm_anthropic_key, fm_moonshot_key, forgemind_history and forgemind_corpus persist via the silently-swallowing safeSetItem — a failed write is indistinguishable from a saved one.',
   'verified', 'CONFIRMED', 'FILED — silent-swallow on keys/chat/corpus (Kimi K-Q2 sequencing).'),
 'F-011': ('shell_exec', {'command': 'headless: run the real autoSettleKalshiPositions on main c806e1d with a fake settlement + throwing save'},
   'persist(state)\'s boolean — the saveFunds read-back result (fundsLedger.ts:726) — is discarded at the call site. With persistence failing, the ledger still reads placed while the auto-settle pop-up asserts settled: the pop-up claims a settlement the ledger never recorded.',
   'verified', 'CONFIRMED', 'FILED — money lane; persist verdict still discarded (re-verified live on 157e4256).'),
 'F-012': ('github_read_file', {'path': 'src/lib/kalshiExecution.ts'},
   'kalshiTrade.ts:272-273 includes averageFillPrice/averageFeePaid only when the V2 response carries them; kalshiExecution.ts:398 then records avgPrice: r.averageFillPrice ?? livePrice (and ?? 0 fees at :437) — recorded fill facts are substituted from the quote when Kalshi omits them.',
   'completed', 'CONFIRMED', 'FILED — money lane; substitution still live on 157e4256.'),
 'F-013': ('shell_exec', {'command': 'headless: load a corrupted forgemind_corpus blob, then trigger the save path'},
   'safeJsonParse\'s fallback (src/lib/storage.ts:28-35) makes a corrupt forgemind_corpus read as an empty corpus at load (src/App.tsx:785-788); the next save overwrites the blob, so corruption silently resets the corpus and the reset is then persisted.',
   'verified', 'CONFIRMED', 'FILED — silent reset + overwrite of the corpus.'),
 'F-014': ('github_read_file', {'path': 'src/lib/ddgWorkflowSearch.ts'},
   'Re-read on main 597f05f: the .catch(() => ({})) at ddgWorkflowSearch.ts:174 catches only JSON-parse failure of an HTTP-OK jobs response; jobs ?? [] yields jobs[0] undefined and the flow continues to the log read. The claimed defect — a swallowed error masking a failed search — does not exist in the current code.',
   'completed', 'DENIED', 'DENIED on main 597f05f (Pass 6) — the claim does not survive a re-read of the artifact.'),
 'F-015': ('github_read_file', {'path': 'src/lib/fundsLedger.ts'},
   'The reject case (fundsLedger.ts:605-610) records rejected and replies "Rejected p2." for an approved-with-kept-order-key (Unknown) position — no venue lookup, no cancel attempt, no warning, no refusal — while Kalshi may hold a live order under that key.',
   'completed', 'CONFIRMED', 'FILED — money lane; no kept-key/venue guard on the reject path.'),
 'F-016': ('github_read_file', {'path': 'README.md'},
   'Two doc premises claim error reports flow from every browser to the owner, but the automatic sender was removed by the owner\'s own decision (PR #222, 2026-10-21). README.md:81 still describes the removed flow as live.',
   'completed', 'CONFIRMED', 'FILED — doc premise contradicts the shipped code.'),
 'F-017': ('shell_exec', {'command': "headless: diagKeyFormatValid('local','','',true) — the real function, run on the audit branch"},
   'Returns true: for the local provider the "credential" is an endpoint URL, and diagKeyFormatValid (diagKeyFormat.ts:13-17) falls back to presence (diagnostics.keyPresent is !!localEndpoint, App.tsx:856/1032) — so a set endpoint renders the verdict "Key format valid" without any format check.',
   'verified', 'CONFIRMED', 'FIXED by follow-up — key-format reason unified with the verdict rule + panel render test.'),
 'F-018': ('github_read_file', {'path': 'README.md'},
   'README.md:77 still claims "Admission needs the owner\'s signed authorization" — but #212 (merged 2026-10-21, 9485608) closed the loop: knowledge converges with NO manual approval via convergencePhase.',
   'completed', 'CONFIRMED', 'FILED — README asserts the pre-#212 admission rule.'),
 'F-019': ('shell_exec', {'command': 'headless: diagnostics construction for activeProvider=local (App.tsx:917/1115) re-verified on 157e4256'},
   'Same lines as Pass 12/13: for the local provider, diagnostics.keyPresent is !!localEndpoint — presence of an endpoint URL — and that presence still feeds the key-format verdict. The F-017 fix\'s local branch asserts from presence, not from any check of the value.',
   'verified', 'CONFIRMED', 'OPEN — re-verified live on main 157e4256.'),
 'F-020': ('github_read_file', {'path': '.github/workflows/forgeclaw-loop.yml'},
   'forgeclaw-loop.yml:18-20 (and the README) assert the workflow landed via the browser-route mechanism; it actually landed via a direct agent push (b7982d9). The header describes a landing path that is not the one that happened.',
   'completed', 'CONFIRMED', 'FILED — protected path; the misdescription is the owner\'s named OK.'),
 'F-021': ('github_read_file', {'path': '.github/scripts/channel_watch.py'},
   'LINES["claude"] in channel_watch.py says "`@claude` starts the Claude Code workflow (claude.yml) when the owner or a collaborator..." — the notice over-claims on the pull_request-opened path: the trigger conditions are narrower than the sentence asserts.',
   'completed', 'CONFIRMED', 'FILED — channel-watch notice over-claims its own trigger.'),
 'F-022': ('shell_exec', {'command': 'headless: CorpusRepository.syncPending against an HTTP 200 reply with an unparseable body'},
   'response.json().catch(() => ({})) (src/lib/corpus.ts:686) swallows the parse failure, and syncPending asserts status: \'synced\' on a webhook reply it never read — HTTP 200 with garbage reads as a successful sync.',
   'verified', 'CONFIRMED', 'FILED — a status word asserting a state the artifact never verified.'),
 'F-023': ('github_read_file', {'path': 'src/lib/i18n.ts'},
   'i18n.ts:141-142 (EN) and :573-574 (ES) still render "Synced {n} candidate updates; admission still requires authorization." (via src/App.tsx:2493) — the pre-#212 admission rule, asserted by the post-sync status after #212 removed it.',
   'completed', 'CONFIRMED', 'FILED — status text asserts a superseded rule in both locales.'),
 'F-024': ('shell_exec', {'command': 'headless: render describeSignedReadsPause (kalshiMarkets.ts:144-147) under each pause state'},
   '#280\'s pause sentence renders "Signed Kalshi reads are paused until …" for pause state that is not Kalshi-specific — the sentence names a narrower scope than the state (signedReadsRefusedAt) actually covers.',
   'verified', 'CONFIRMED', 'FILED — pause sentence over-claims its scope.'),
 'F-025': ('shell_exec', {'command': 'git show 39747df — inspect the web-UI branch-update merge commit and its parents (982d1bda + d88914de)'},
   'Merge commit 39747df (2026-10-24T02:10:18Z) resolved src/lib/kalshiMarkets.ts to the branch\'s pre-#279 version: PR #282\'s own diff claim was silently falsified by its web-UI branch update — lines the PR claimed were not the lines that landed.',
   'verified', 'CONFIRMED', 'FILED — a web-UI conflict resolution treated as ceremony, verified as a code change only after the fact.'),
 'F-026': ('http_fetch', {'url': 'GitHub API: comments 6378671035 and 6378697801 on DeviousDevv303/forgeclaw'},
   'Both comment IDs return 404 — they do not exist. Pass 25\'s posting reports asserted two comments (a PR #282 resolution note and a #235 note) that were never posted: the audit\'s own record claimed artifacts that aren\'t there.',
   'verified', 'CONFIRMED', 'FILED — the audit\'s own phantom-reference finding; self-correction is the lesson.'),
 'F-027': ('shell_exec', {'command': 'headless: run both real parsers on one two-marker comment (app parseChannelCallsInComment + loop parseCalls) and compare counts'},
   'The loop\'s parseCalls (tools/server-loop/lib.mjs, matchAll) counts one call per forgeclaw-call:v1 marker; the app\'s parser counts differently — the two sides of one system disagreed about how many calls a single comment carried. (Parity re-verified Pass 60: both parsers return 2 for the two-marker comment, IDs call-a-001/call-b-002.)',
   'verified', 'CONFIRMED', 'FILED Pass 29; parity holds on re-swept main 157e4256.'),
 'F-028': ('shell_exec', {'command': 'headless: WhatsApp status surfaces with only the wa_credentials key present (header dot App.tsx:2627-2633; panel row App.tsx:3521)'},
   'Both surfaces assert "configured"/ON from mere presence of the wa_credentials key — the F-008 fix\'s own shape: presence of a stored value is not evidence the integration works.',
   'verified', 'CONFIRMED', 'FILED — presence asserted as configuration.'),
 'F-029': ('github_read_file', {'path': 'README.md'},
   'README.md:21 ("What ForgeClaw does") still claims NEXUS learning happens "with nothing admitted without the owner\'s signed approval" — the pre-#212 rule. The live route is convergence with no signed approval.',
   'completed', 'CONFIRMED', 'FILED — summary line asserts a superseded admission rule.'),
 'F-030': ('shell_exec', {'command': 'headless: writeStoredToken (githubAuth.ts) with failing storage, then clear the field and re-read'},
   'writeStoredToken swallowed storage failures (try/catch, void) and asserted "SAVED" without read-back; clearing the field never cleared the stored token. Both directions unverified: a save that didn\'t save, and a clear that didn\'t clear.',
   'verified', 'CONFIRMED', 'FILED — token persistence asserted without read-back.'),
 'F-031': ('shell_exec', {'command': 'headless: github_read_file on a >8000-char file — where does the truncation actually live?'},
   'The guide\'s Known-limits bullet attributes the 8,000-char DeepSeek sculpt limit to the read tool ("The github_read_file tool returns at most the first 8,000 characters…") — the limit lives in the sculpt path, not the read tool. The doc blames the wrong component.',
   'verified', 'CONFIRMED', 'FILED — limit misattributed to the wrong tool.'),
 'F-032': ('shell_exec', {'command': 'headless: memory_write and the save tool results under a failing safeSetItem (storage.ts:12-18)'},
   'Two tool results assert persistence they never verified, both built on the silently-swallowing safeSetItem: memory_write (src/lib/forgeTools.ts:1475-1479) returns a success mark for a write that may never have landed. The tool tells the user "saved" on an unchecked write.',
   'verified', 'CONFIRMED', 'FILED — tool results asserting unverified persistence.'),
 'F-033': ('github_read_file', {'path': 'docs/mirofish-runner.md'},
   'docs/mirofish-runner.md:108 claims "Verified offline (200+ Python tests, run in CI by src/scripts/mirofishRunner.test…)" — the count does not match the suite it names; the runner doc overstates its own verification count.',
   'completed', 'CONFIRMED', 'FILED — coverage claimed by prose, not by what the tests render.'),
 'F-034': ('github_read_file', {'path': 'README.md'},
   'README.md:30-38 Providers table lists four providers (DeepSeek, Moonshot, Anthropic, Local); the Muse · Meta provider landed in #301 — muse is in providerDefaults.ts:4 and modelProviders.ts:18,23 — and has no row. This is an omission, not a false assertion; whether the table intends completeness is the owner\'s call.',
   'not_verified', 'CANDIDATE', 'CANDIDATE — not filed on #235 as a finding; an omission awaiting the owner\'s completeness call. Do not assert it as a defect.'),
 'F-035': ('github_read_file', {'path': 'docs/mirofish-runner.md'},
   'docs/mirofish-runner.md:134 on main 7d6c770 reads "127 Python tests", but #306 (3194ca5, merged 2026-10-25 15:23 CDT) added 24 tests 16 minutes before #305 landed the doc — the true count moved under the fix that was supposed to correct it.',
   'completed', 'CONFIRMED', 'FILED — F-033\'s fixed count re-staled within the same merge evening.'),
 'F-036': ('shell_exec', {'command': 'headless: formatMarket scan verdict on main 5cb4909 with a failed series read in the input'},
   'seriesRead was built as [...KALSHI_GAME_SERIES] unconditionally (src/lib/kalshiMarkets.ts:589 on main 5cb4909): #317\'s board-scan no-match verdict claims a failed series was read in full — the verdict asserts coverage the read never achieved.',
   'verified', 'CONFIRMED', 'FILED — verdict claims a full read of a series whose read failed.'),
 'F-039': ('shell_exec', {'command': 'headless: run the real parseNexusIntake (main 4719bfdc) over the published nexus-intake-data intake file'},
   'Published file 534 lines -> 511 records. The dropped set is the F-037 five + the F-038 one + 17 more (local lines 475-480, 484-487, 518-521, 530-532): Bank/crew/fleet records carrying their narrative in a literal subject key (Watcher grades use verdict, two carry detail) that validateIntakeRecord (nexusIntake.ts:85-100) never reads, most also omitting ts. 13 of the 17 are Bank-class records that should auto-teach Nexus under the owner\'s 2026-10-29 ruling; they never parse. Well-shaped Bank records in the same file flow: 266 bank-class auto-admits; canary-source auto-admits 0, as designed.',
   'verified', 'CONFIRMED', 'FILED on #235 — comment 6538714435; fix is the producer/consumer shape fork, owner\'s sequencing.'),
}
F_017_ROW = {'claim': 'The F-017 fix\'s local-provider branch still asserts "Key format valid" from presence: for activeProvider === \'local\', diagnostics.keyPresent is !!localEndpoint (App.tsx:856, and the second diagnostics construction at App.tsx:1032) — the credential is an endpoint URL, not a key — and diagKeyFormatValid falls back to presence (diagKeyFormat.ts:13-17)',
             'evidence': 'Claim: src/App.tsx:3092 (main cf07891e). Artifact: the Diagnostics "API KEY" hint line. Live check: headless run of the real diagKeyFormatValid(\'local\',\'\',\'\',true) -> true', 'status': ''}
finding_rows['F-017'] = F_017_ROW

tool_use = []
drops = []
for fid in sorted(finding_rows):
    if fid in DROP_FINDINGS:
        drops.append({'candidate': 'fallacy:' + fid, 'reason': DROP_FINDINGS[fid]})
        continue
    shape = F_SHAPE.get(fid)
    if shape is None:
        drops.append({'candidate': 'fallacy:' + fid, 'reason': 'no shaping map (not emitted rather than improvised)'})
        continue
    tool, args, result, ev, verdict, status_note = shape
    claim = re.sub(r'\*\*', '', finding_rows[fid]['claim'])
    claim_short = claim if len(claim) <= 300 else claim[:297] + '...'
    prompt = f'Verify this claim before anyone acts on it (fallacy audit {fid}): {claim_short}'
    answer = (f'Verdict: {verdict}. ' +
              ('The claim holds against the artifact. ' if verdict == 'CONFIRMED' else
               'The claim does not hold against the artifact. ' if verdict == 'DENIED' else
               'Not asserted: this stays a candidate until the deciding check is run. ') +
              status_note)
    text = transcript(tool, args, result, ev, answer)
    trace = mkrow(f'real-fallacy-{fid.lower()}-verify', prompt, text, 'verify_claim_real',
                  prov(f'fallacy-audit-{fid.lower()}', 'fallacy-audit',
                       f'LEDGER.md {fid}', 'claim -> artifact read/live check -> verdict, per LEDGER.md',
                       guardian=(ev == 'verified')))
    tool_use.append(trace)

# ------------------------------------------------------- watcher traces
# Pre-registered identity exclusions: Watcher-Q fixtures WQ-01..WQ-12 are
# built from Reports 1-5 (verified by extracting every fixture's source
# field), so no trace is shaped from Reports 1-5 in either domain.
for n in (1, 2, 3, 4, 5):
    drops.append({'candidate': f'watcher-grading-episode:report-{n}',
                  'reason': 'frozen_item_identity:watcher-q-fixtures WQ-01..WQ-12 source Reports 1-5'})
for n in (2, 3, 4, 5):
    drops.append({'candidate': f'watcher-context-episode:report-{n}',
                  'reason': 'frozen_item_identity:watcher-q-fixtures WQ-01..WQ-12 source Reports 1-5'})

GRADE_SHAPES = {
 6: dict(
   prompt='Grade Watcher Report 6 before its streak counts. Its claims: Bank mandate m-1793404482413-d7155540, stake 35, goal 100, equity 22, realized 0, killed false, variant cg-1-strike93-x-ceiling-off, Kalshi 22 with no error; channel newest comment 6538948108 (366 total); main head 4719bfdc; canary runId 41293a23, ts 03:01:08Z, suspects []; campaign last_check_at 03:10:50Z. Verify against live ground truth and issue the verdict.',
   call=('shell_exec', {'command': 'git fetch origin main in a scratch clone; stat + read the canary and campaign state files from disk'},
         'origin/main = 4719bfdc. Disk canary file (mtime 04:01:06Z): runId 2f285924, ts 2026-10-31T04:01:01Z, suspects [scheduler-silence, snapshot-age]. Disk campaign file (mtime 04:25:17Z): last_check_at 2026-10-31T04:25:17Z. API + D1: stake 350000 micros, 0 intents, cash adjustments -127400 micros = equity 22c, agreeing with the report\'s Bank section to the cent.'),
   answer='Verdict: DIVERGENCE — the proving streak resets to 0 of 10. The Bank, channel and main sections verify exactly (equity derivation 350000 + 0 - 127400 micros = 22c; main double-verified). But section 3 presented STALE copies of both local state files as current: canary quoted as 41293a23 / 03:01:08Z / suspects [] against disk 2f285924 / 04:01:01Z / [scheduler-silence, snapshot-age], and campaign last_check_at quoted as 03:10:50Z against disk 04:25:17Z. The staleness was visible inside the report itself — its channel section carried comments from 03:58Z and 04:22Z, postdating the canary ts it quoted. Steering: the local-file freshness rule (compare file ts/mtime against cadence and against fresher evidence already in the report; re-read once; classify STALE-BY-TIME, never quote as current without the age).'),
 7: dict(
   prompt='Grade Watcher Report 7 before its streak counts. Its claims: Bank equity 22 (API and D1-derived agree), realized 0, killed false, trigger-only, variant cg-1-strike93-x-ceiling-off, Kalshi 22; channel quiet since comment 6538948108; main 4719bfdc; canary runId 2f285924, ts 04:01:01Z, suspects [scheduler-silence, snapshot-age]; campaign last_check_at 04:25:17Z; formation newest 1793387485890 with its age attached. Verify against live ground truth and issue the verdict.',
   call=('shell_exec', {'command': 'git fetch origin main in a scratch clone; read the canary and campaign state files from disk with mtimes'},
         'origin/main = 4719bfdc (both paths agree). Disk canary (mtime 04:01:06Z): runId 2f285924, ts 04:01:01Z, suspects [scheduler-silence, snapshot-age] — exact match. Disk campaign: last_check_at 04:25:17Z — exact match. D1: 350000 + 0 - 127400 micros = 22c = API equity.'),
   answer='Verdict: CLEAN — streak 1 of 10. Every claim verifies, and section 3 is corrected on both of Report 6\'s misses: the canary and campaign values match the disk files exactly, quoted with their timestamps. The Report 6 steering (local-file freshness) held on its first test.'),
 8: dict(
   prompt='Grade Watcher Report 8 before its streak counts. Its claims: Bank equity 22 (API and D1-derived agree), trigger-only, variant cg-1-strike93-x-ceiling-off, Kalshi 22 with error null; channel quiet since 6538948108; main 4719bfdc; canary runId 901ea105, ts 2026-10-31T05:01:09Z, suspects [scheduler-silence, snapshot-age]; campaign last_check_at 2026-10-31T05:10:13Z. The report also states its first canary/campaign reads were superseded mid-run and classifies them STALE-BY-TIME. Verify against live ground truth and issue the verdict.',
   call=('shell_exec', {'command': 'read the canary and campaign state files from disk; git fetch origin main in a scratch clone'},
         'Disk canary: runId 901ea105, ts 2026-10-31T05:01:09.009Z, suspects [scheduler-silence, snapshot-age] — EXACT. Disk campaign: last_check_at 2026-10-31T05:10:13.510619Z — EXACT. origin/main = 4719bfdc. D1-derived equity 22c = API 22c.'),
   answer='Verdict: CLEAN — streak 2 of 10. First report under the local-file freshness steering, and it applied the rule to itself: the mid-run superseded reads were caught, re-read, and classified STALE-BY-TIME in its own notes instead of being quoted as current. All file claims match disk exactly.'),
 9: dict(
   prompt='Grade Watcher Report 9 before its streak counts. Its claims: Bank equity 22 shown with its derivation (stake 350000 micros + 0 intents - 127400 micros adjustments), armed_state cashCents 22 agreeing; Kalshi balance read null with error \'too many requests\', reported verbatim; channel quiet since 6538948108, total 366; canary 901ea105 / 05:01:09Z / both suspects; campaign last_check 05:25:16Z; main cross-checked. Verify against live ground truth and issue the verdict.',
   call=('http_fetch', {'url': 'Nexus Bank /api/status + D1 settings and cash_adjustments reads'},
         'API: equity 22c, adjustments -13c, killed false, trigger-only. D1 derivation: 350000 + 0 - 127400 micros = 22c — agrees to the cent. Kalshi read at grading time also returns intermittently null with rate-limit errors; the verbatim report of a null is the spec-correct behavior, never a substitution.'),
   answer='Verdict: CLEAN — streak 3 of 10. The equity derivation is shown in the open and agrees to the cent on both paths; the Kalshi null is reported verbatim with its error, never substituted; campaign last_check 05:25:16Z is cadence-consistent (05:10 -> 05:25 on a ~15-minute cadence); the main freshness cross-check triggered correctly and both paths agreed.'),
}
for n, s in GRADE_SHAPES.items():
    text = transcript(s['call'][0], s['call'][1], s['call'][2], 'verified', s['answer'])
    tool_use.append(mkrow(f'real-watcher-grade-r{n}', s['prompt'], text, 'grade_report_real',
                          prov(f'fleet-watcher-grade-r{n}', 'fleet-watcher',
                               f'watcher-proving.json grades[{n}] + divergences',
                               'claim -> independent live reads (API/D1/git fetch/disk) -> verdict',
                               guardian=True)))

CONTEXT_SHAPES = {
 6: dict(
   prompt=('You are compiling a fleet status report at 04:30Z. In hand: a canary state snapshot reading runId 41293a23, ts 2026-10-31T03:01:08Z, suspects []; a campaign state value last_check_at 03:10:50Z; and, already collected in this same pass, channel comments timestamped 03:58Z and 04:22Z. The canary runs about hourly; the campaign checker about every 15 minutes. What do you report for the canary and campaign state?'),
   call=('shell_exec', {'command': 'stat + read the canary and campaign state files from disk'},
         'Canary file (mtime 04:01:06Z): runId 2f285924, ts 2026-10-31T04:01:01Z, suspects [scheduler-silence, snapshot-age]. Campaign file (mtime 04:25:17Z): last_check_at 2026-10-31T04:25:17Z.'),
   answer=('The in-hand snapshot values are STALE and must not be reported as current: the canary value is ~1.5 hours old against an hourly cadence, the campaign value is ~80 minutes old against a 15-minute cadence, and both are predated by evidence already in this report (channel comments at 03:58Z and 04:22Z) — a source whose newest item is older than evidence already in hand is a suspect source, not a fact. Report the fresh disk values WITH their timestamps: canary runId 2f285924, ts 04:01:01Z, suspects [scheduler-silence, snapshot-age]; campaign last_check_at 04:25:17Z. The superseded values are named as stale-by-time, never silently swapped.')),
 7: dict(
   prompt=('You are compiling a fleet status report. Your reads this pass: canary state runId 2f285924, ts 2026-10-31T04:01:01Z, suspects [scheduler-silence, snapshot-age]; campaign last_check_at 04:25:17Z. Before writing them up, what do you check, and how do you present the values?'),
   call=('shell_exec', {'command': 'stat + re-read both state files from disk and compare against the values in hand'},
         'Disk canary (mtime 04:01:06Z): runId 2f285924, ts 04:01:01Z — identical to the value in hand. Disk campaign: last_check_at 04:25:17Z — identical. Both ages are within their sources\' cadences (~hourly canary, ~15-minute campaign).'),
   answer=('Report the values as current WITH their timestamps attached: canary runId 2f285924 (ts 04:01:01Z, suspects [scheduler-silence, snapshot-age]); campaign last_check_at 04:25:17Z. The disk re-read confirms the in-hand values are the files\' actual contents — freshness is something you verify and show, not something a value carries by being recent-looking.')),
 8: dict(
   prompt=('You are mid-way through compiling a fleet status report. Your first reads, taken minutes ago, showed canary runId 2f285924 (ts 04:01:01Z) and campaign last_check_at 04:25:17Z. A scheduled run has since landed: the canary file now reads runId 901ea105, ts 05:01:09Z, and the campaign file reads last_check_at 05:10:13Z. What goes in the report?'),
   call=('shell_exec', {'command': 're-read both state files from disk'},
         'Canary: runId 901ea105, ts 2026-10-31T05:01:09.009Z, suspects [scheduler-silence, snapshot-age]. Campaign: last_check_at 2026-10-31T05:10:13.510619Z.'),
   answer=('Report the NEW values — canary runId 901ea105 (ts 05:01:09Z, suspects [scheduler-silence, snapshot-age]) and campaign last_check_at 05:10:13Z — and classify the superseded first reads explicitly as STALE-BY-TIME in the report\'s notes. A read that was true when taken and has since been replaced is not an error and not current: it is labeled with its age so no reader mistakes the sequence.')),
 9: dict(
   prompt=('You are compiling a fleet status report. The campaign checker\'s last_check reads 05:25:16Z this pass; last pass it read 05:10:13Z, on a ~15-minute cadence. The Kalshi balance read returns null with the error \'too many requests\'; your own derived equity from stake and adjustments is 22c. What do you report for the campaign state and the Kalshi balance?'),
   call=('http_fetch', {'url': 'Nexus Bank /api/status'},
         'Status agrees with the derived figure: equity 22c. The Kalshi balance field itself is null on this read, error \'too many requests\'.'),
   answer=('Report campaign last_check 05:25:16Z with its timestamp — the 05:10 -> 05:25 step is cadence-consistent, so the value is current. Report the Kalshi balance as null with its error verbatim (\'too many requests\'): a failed read is reported as a failed read, never substituted with the derived equity, an older balance, or a guess. The derived 22c is reported as what it is — the Bank equity from stake + intents + adjustments — a different number from the Kalshi balance, kept separate.')),
}
context = []
for n, s in CONTEXT_SHAPES.items():
    ev = 'verified'
    text = transcript(s['call'][0], s['call'][1], s['call'][2], ev, s['answer'])
    context.append(mkrow(f'real-watcher-context-r{n}', s['prompt'], text, 'context_state_real',
                         prov(f'fleet-watcher-context-r{n}', 'fleet-watcher',
                              f'watcher-proving.json grades[{n}]' + (' + divergences[1]' if n == 6 else ''),
                              'two values for one fact at different timestamps -> fresher value, staleness named',
                              guardian=True)))

# ------------------------------------------------------- PR #337 pair
bleed_prompt = ('Question from the owner: is there a trade on the current BTC 15-minute window? '
  'Retrieved corpus context offered for this task: a record about extracting entities from documents '
  '(it shares only generic tokens with the task). The live Bank surface shows the ask at 84c against a 75c entry clamp. Answer the question.')
bleed_text = ('<|route:direct|><|ev:not_verified|><|answer|>The retrieved record is not about this task and cannot inform the answer: '
  'its overlap with the question is generic tokens, not the task\'s topic — under the relevance test it shares fewer than 3 distinctive '
  'topic words, so it is excluded, and nothing in it is evidence here. From the live surface: NO TRADE — the ask is 84c, over the 75c clamp.'
  '<|/answer|><|end|>')
context.append(mkrow('real-context-bleed-337-failure-shape', bleed_prompt, bleed_text, 'context_bleed_real',
                     prov('forgeclaw-pr337-incident', 'owner-report',
                          'PR #337 (forgeclaw main f81aad448ae5): corpus context-bleed incident, 2026-10-30',
                          'retrieved record sharing only generic tokens must not leak into the answer',
                          label_source='incident_recorded', guardian=False)))
fix_prompt = ('Two corpus records are candidates for the task "grade the Watcher report against the fleet state files": '
  'record A is a Watcher grade of a canary state-file read; record B is a Bank molding record that shares the words "state" and "file" '
  'with the task but is about mandate transitions. Which records enter the task context?')
fix_text = ('<|route:direct|><|ev:completed|><|answer|>Apply the one relevance test both lanes use (distinctiveWords + recordRelevantToTask): '
  'count distinctive shared topic words — stopwords and generic tokens do not count — and admit a record only at the threshold of '
  'min(3, the task\'s topic-word count). Record A shares at least 3 distinctive topic words with the task (Watcher, grade, canary, state file) '
  'and is admitted. Record B shares only generic tokens and is excluded. The guidance lane applies the same test; it is not exempt, and a '
  'record that fails the test contributes nothing to the answer.<|/answer|><|end|>')
context.append(mkrow('real-context-bleed-337-fix', fix_prompt, fix_text, 'context_bleed_real',
                     prov('forgeclaw-pr337-fix', 'fallacy-audit',
                          'PR #337 fix: corpus.ts distinctiveWords/recordRelevantToTask + regression tests',
                          'relevance test applied the same way in both retrieval lanes',
                          label_source='fix_recorded', guardian=False)))

# ------------------------------------------------------- live-search trace
ls_prompt = ('A user asks: "What\'s up any MMA fights/UFC fights or any fights at all this weekend". The app classified it as a '
  'live-data question and ran its workflow web search, then answered: "DuckDuckGo search did not finish in time (run 41173397044, '
  'status in_progress, last poll: network error: GitHub read timed out after 30000ms). No results for the question: live search did '
  'not produce any and Instant Answers has no entry for it. Add a Brave Search API key in Settings for full web results." '
  'Grade that answer and state the correct handling.')
ls_call = ('http_fetch', {'url': 'GitHub API: actions run 41173397044'},
  'Run 41173397044 (ddg_search.yml): created 2026-10-31T05:38:20Z, completed 05:38:33Z — 13 seconds, conclusion success, with its '
  'result line printed to the job log. Routing record: liveDataRouting.ts matched UFC/MMA + "this weekend" and issued a direct '
  'web_search call — the routing was correct, no model hop. Settings record: the Brave key field was removed by the owner on '
  '2026-10-23; its slot is now the Kalshi keys section (App.tsx:3279-3280). Read-path constants: githubFetch.ts '
  'GITHUB_READ_TIMEOUT_MS = 30000, timeouts never retried at that layer; the completion poll budget is 120s, about 4 timed-out reads.')
ls_answer = ('The answer is false twice, and the correct handling differs from what it did at each joint. (1) "Live search did not '
  'produce any" — it did: the run succeeded in 13 seconds and produced results. What failed was the read-back: every status read '
  'timed out at 30s and timeouts are never retried, so inside a 120s poll budget the app never learned the run had finished — a '
  'read failure misreported as an absence of results. Correct handling: retry the timed-out read or fall through to the job-log '
  'read anyway; if reads still fail, report the read failure truthfully and mark the turn failed — never present the Instant '
  'Answers fallback (which is not a search) as the search outcome. (2) "Add a Brave Search API key in Settings" prescribes a field '
  'the owner removed from the product on 2026-10-23; on the zero-setup default the user is never handed config homework. The live '
  'answer itself existed and was trivially searchable (UFC Fight Night: Moicano vs Nolan, Saturday 2026-10-31).')
tool_use.append(mkrow('real-livesearch-routing-20261031', ls_prompt,
                      transcript(ls_call[0], ls_call[1], ls_call[2], 'verified', ls_answer),
                      'route_live_data_real',
                      prov('live-search-trace-20261031', 'fallacy-audit',
                           'github actions run 41173397044 + intake lines 545-546 (check live-data-routing)',
                           'live check of the run record vs the app\'s reported outcome', guardian=True)))

# ------------------------------------------------------- leakage filter
def apply_leakage(traces):
    kept = []
    for t in traces:
        reason = leakage(t)
        if reason:
            drops.append({'candidate': t['id'], 'reason': reason})
        else:
            kept.append(t)
    return kept

tool_use = apply_leakage(tool_use)
context = apply_leakage(context)

# ------------------------------------------------------- write deliverables
def write_jsonl(path, rows):
    with open(path, 'w') as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')

write_jsonl(os.path.join(OUT, 'tool-use-v1.jsonl'), tool_use)
write_jsonl(os.path.join(OUT, 'context-v1.jsonl'), context)

# ------------------------------------------------------- census document
c = census
cen = []
cen.append('# Shell census — counted 2026-10-31 (build step 2, traces-v1)')
cen.append('')
cen.append('Definition used throughout: a **usable shell trace** is a record carrying an invoked '
           'command (or an executed verification run) **plus its outcome**, in a form a shaper can '
           'render without inventing either half. Prose that mentions a command, prescribes a '
           'command, or discusses the shell tool is counted separately and never upgraded.')
cen.append('')
cen.append('| Source | Records examined | Usable (command + outcome) | Success / clean outcomes | Failure / divergence outcomes |')
cen.append('|---|---|---|---|---|')
cen.append(f"| nexus-intake.jsonl | {c['intake']['total_lines']} lines | **0** | — | — |")
cen.append(f"| watcher-proving.json | {c['watcher_proving']['graded_reports']} graded reports, {c['watcher_proving']['divergences']} divergences | **{c['watcher_proving']['usable_shell_traces']}** (git-fetch cross-checks recorded inside grade/divergence entries) | cross-check agreed with the first read in the clean grades | the Report 2 cross-check caught the stale head (f81aad4 vs live 4719bfdc) |")
cen.append(f"| fallacy-audit LEDGER.md | 39 findings (F-001..F-039) | **{c['fallacy_ledger']['usable_shell_traces']}** (table rows whose verification was an executed headless run) | verifications that confirmed the claim (see manifest verdict split) | F-014's executed re-read DENIED its claim; cleared suspects fill the pass log |")
cen.append(f"| cron.d job bodies | {c['cron_bodies']['total_files']} files ({c['cron_bodies']['live_files']} live, {c['cron_bodies']['archived_files']} archived) | **0** | — | — |")
cen.append(f"| daily logs ~/memory/2026-10-*.md | {c['daily_logs']['files']} files | **0** | — | — |")
cen.append(f"| agent-channel/*.md | {c['agent_channel']['files']} files | **0** | — | — |")
cen.append(f"| Bank deploy/verify + watch scripts (.scratch, workspace root) | {c['bank_scripts']['nb_deploy_scripts']} deploy + {c['bank_scripts']['nb_verify_deploy_scripts']} verify scripts ({c['bank_scripts']['deploy_verify_pairs']} pairs), {c['bank_scripts']['watch_shell_scripts']} watch shell scripts, {c['bank_scripts']['watch_logs']} logs | **0 as journaled traces** (artifacts, shaping source for a later pass) | — | — |")
cen.append('')
cen.append(f"**Headline total: {c['watcher_proving']['usable_shell_traces'] + c['fallacy_ledger']['usable_shell_traces']} usable real shell episodes exist on disk** — every one of them buried in prose inside the fallacy ledger's findings or the Watcher's grading record. **Zero** exist in grammar-ready form, and zero exist in the intake stream the corpus actually reads. This is the shell domain's version of the admitted-data verdict: the loop *does* shell work constantly and journals almost none of it in consumable shape.")
cen.append('')
cen.append('## Per-source detail')
for key in ('intake', 'watcher_proving', 'fallacy_ledger', 'cron_bodies', 'daily_logs', 'agent_channel', 'bank_scripts'):
    cen.append(f"### {key}")
    for k, v in census[key].items():
        if k == 'kinds':
            cen.append(f'- kinds census ({census[key]["total_lines"]} lines): ' +
                       ', '.join(f'{kk} {vv}' for kk, vv in v.items()))
        else:
            cen.append(f'- {k}: {v}')
    cen.append('')
cen.append('## Context only — synthetic shell rows already in run 9 data (NOT census material)')
cen.append(f"- run9-combination/data.jsonl shell kinds: {c['run9_synthetic_shell_rows']['counts']} — all `synthetic: true`, the generator's shell_run/shell_check makers. They exist so the census's zero is not misread: the model has seen synthetic shell shapes; it has never seen a real one.")
cen.append('')
cen.append('## What this means for the shell lane (program §9.3, promotion blocker)')
cen.append('- The perfection lane cannot be fed from a journal that does not exist. Two honest supply paths: (a) shape the ledger/proving prose episodes in a later pass (the same prose-join discipline as the trading shaper, `value_source: prose` disclosed per trace); (b) capture going forward — every graded shell episode journaled in consumer shape at the time it runs. Path (b) is the only one that scales, and it is a journaling change, not a training change.')
open(os.path.join(OUT, 'shell-census.md'), 'w').write('\n'.join(cen) + '\n')

# ------------------------------------------------------- manifest
def cnt(path):
    return sum(1 for _ in open(path))

tu_n = cnt(os.path.join(OUT, 'tool-use-v1.jsonl'))
cx_n = cnt(os.path.join(OUT, 'context-v1.jsonl'))
verdicts = collections.Counter(s[4] for s in F_SHAPE.values()
                               if s and list(F_SHAPE.keys()))
kept_verdicts = collections.Counter()
for t in tool_use:
    if t['kind'] == 'verify_claim_real':
        m = re.search(r'Verdict: (\w+)', t['text'])
        if m:
            kept_verdicts[m.group(1)] += 1
man = []
man.append('# traces-v1 — manifest')
man.append('')
man.append(f'Built {NOW} by `build_traces_v1.py` (in this directory; re-runnable, deterministic apart from shaped_at). Design law: trace-shaper-design.md (one trace per graded episode, provenance sidecar §3.2 embedded in-row under `provenance`, classes labeled honestly). **No training was launched.** Local files only.')
man.append('')
man.append('## Files')
man.append(f"- `tool-use-v1.jsonl` — **{tu_n} traces** (wc-verified line count after write)")
man.append(f"- `context-v1.jsonl` — **{cx_n} traces** (wc-verified line count after write)")
man.append('- `shell-census.md` — the Part 1 census')
man.append('- `build_traces_v1.py` — the shaper that produced all three')
man.append('')
man.append('## Real / synthetic split')
man.append(f'- Real (`synthetic: false`, provenance `label: "real"`): **{tu_n + cx_n} of {tu_n + cx_n} traces (100%)**. Synthetic traces in these files: **0**. Nothing synthetic is passed off as real; no trace in either file is Guardian-eligible unless its evidence token is `<|ev:verified|>` (see counts below), per the standing rule that only the verified subset can be Guardian data.')
man.append('')
man.append('## Composition and provenance by class')
man.append('')
man.append('| File | Kind | Traces | Source corpus | Provenance (source / ref) |')
man.append('|---|---|---|---|---|')
n_fal = sum(1 for t in tool_use if t['kind'] == 'verify_claim_real')
n_grade = sum(1 for t in tool_use if t['kind'] == 'grade_report_real')
n_route = sum(1 for t in tool_use if t['kind'] == 'route_live_data_real')
n_wctx = sum(1 for t in context if t['kind'] == 'context_state_real')
n_bleed = sum(1 for t in context if t['kind'] == 'context_bleed_real')
man.append(f'| tool-use-v1.jsonl | verify_claim_real | {n_fal} | fallacy-audit LEDGER.md §1/§2 (F-002..F-039 minus exclusions) | source `fallacy-audit`, ref `LEDGER.md F-0xx`, check = claim -> artifact -> verdict |')
man.append(f'| tool-use-v1.jsonl | grade_report_real | {n_grade} | fleet/watcher-proving.json grades 6-9 | source `fleet-watcher`, ref `watcher-proving.json grades[n]` |')
man.append(f'| tool-use-v1.jsonl | route_live_data_real | {n_route} | tonight\'s live-search incident: intake lines 545-546 + the full-stack trace vs the Actions API | source `fallacy-audit`, ref `github actions run 41173397044` |')
man.append(f'| context-v1.jsonl | context_state_real | {n_wctx} | fleet/watcher-proving.json Reports 6-9 (the Report 6 stale-local-file failure + Reports 7-9 corrections on the same surfaces) | source `fleet-watcher` |')
man.append(f'| context-v1.jsonl | context_bleed_real | {n_bleed} | PR #337 corpus context-bleed incident + its fix (forgeclaw main f81aad448ae5) | sources `owner-report` / `fallacy-audit` |')
man.append('')
man.append(f'Verdict split inside verify_claim_real: {dict(kept_verdicts)} (the DENIED and CANDIDATE traces are deliberate: a denied claim and an unasserted candidate teach that verification can come back "no" or "not yet").')
man.append('')
man.append(f"Guardian-eligible (evidence token `<|ev:verified|>`): tool-use {sum(1 for t in tool_use if '<|ev:verified|>' in t['text'])}, context {sum(1 for t in context if '<|ev:verified|>' in t['text'])}. All other traces are ordinary corpus, not Guardian data.")
man.append('')
man.append('## Leakage control (hard ban — no frozen-exam item in training)')
man.append('')
man.append(f'Frozen sets loaded before shaping: {len(FROZEN_FILES)} files (eval v1 + domains-v1 + CAPBENCH v1.1 + heldout + affect + UNRESTRICTION v1 + heldout, frozen-prompts.ts, coding/ and loop/ assets, Watcher-Q fixtures, Curator fixtures, trading frozen-set-v1). Checks per trace: (1) normalized prompt match against every frozen prompt; (2) ticker match against the trading benchmark; (3) 48-char normalized shingle overlap between the trace\'s fact-carrying content (prompt + result blocks + answer block) and the frozen content (fixture/trading files shingled whole; eval suites shingled on each item\'s prompt + expected-call/answer string values). The `<|call|>` transcript header is excluded from the shingle check on both sides: it is the grammar scaffolding every run-9 training row and every eval gold share by design — the ban protects exam content, not the shared format. (An earlier whole-text version of this check dropped 14 traces purely on the shared `github_read_file` call header; the calibration and its reason are recorded here rather than silently loosened — the content check still runs at full strength on everything that carries facts.)')
man.append('')
man.append(f'**Total leakage drops: {len(drops)}**')
for d in drops:
    man.append(f"- `{d['candidate']}` — {d['reason']}")
man.append('')
man.append('Notes on the big ones: the Watcher-Q exam (WQ-01..WQ-12) is built from Watcher Reports 1-5, so the Report 2 stale-head failure and the Reports 3-5 corrections — the pair the program §4.4 names first — are exam material and are excluded; the Report 6 failure + Reports 7-9 corrections carry the same lesson from episodes no exam touches. The Curator exam is built from real intake lines, which excludes F-001, F-008 (via its F-099 mutation), F-037 and F-038 by identity.')
man.append('')
man.append('## Disclosed overlaps and limits')
man.append('- The four Watcher episodes (Reports 6-9) appear in BOTH files, shaped for different skills (grading a report vs discriminating stale-vs-current state). Disclosed here rather than hidden in the counts: unique episodes = ' + str(tu_n + cx_n - min(n_grade, n_wctx)) + '.')
man.append('- Fallacy traces render the ledger\'s verdicts from its own recorded evidence (`value_source: prose` in every sidecar): the ledger is the graded record of checks that were actually run (headless runs, API read-backs, live fetches), and the traces quote its deciding facts without inventing command output beyond what the ledger states.')
man.append('- F-017 has no §1/§2 table row; it lives in the ledger\'s pass prose (Pass 13/14). Its trace is shaped from that text and its sidecar says so via ref `LEDGER.md F-017`.')
man.append('- The intake file is live (it grew from 546 to ' + str(census['intake']['total_lines']) + ' lines during this build as jobs appended records). Census numbers are the count at build time; the two live-search records (lines 545-546) are stable and are the routing trace\'s source.')
man.append('- Watcher Report 10 had run (and its grade landed during this build — the proving file now holds 10 grades); traces use Reports 6-9 only, the graded set that existed as a stable record when shaping began.')
open(os.path.join(OUT, 'manifest.md'), 'w').write('\n'.join(man) + '\n')

print(json.dumps({
    'tool_use': tu_n, 'context': cx_n, 'drops': len(drops),
    'drop_ids': [d['candidate'] for d in drops],
    'census_headline_usable': census['watcher_proving']['usable_shell_traces'] + census['fallacy_ledger']['usable_shell_traces'],
    'intake_lines': census['intake']['total_lines'],
    'frozen_files': len(FROZEN_FILES),
}, indent=1))
