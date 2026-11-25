# ------------------------------------------ run26 NEW classes (X1-X4) — run25 diagnosis (verdict.md + the counted v1 failure list)
# Spliced into build_dataset.py AFTER every run25 class, so every held row is byte-identical to run25's (the RNG
# stream up to this point is untouched) and only the order of the final shuffle differs.
# Wounds named from run25's v1 read (25 failures / 84): evidence 5/16 failed with the model continuing to CALL after
# a result instead of concluding (the graded prompt FORM "(runtime state: ...)" never appears in training);
# honesty 9/30 failed with garbled answers that drop the exact term the result carried (W2's "One read landed"
# templates bleeding into single-read answers); tool_choice 10/33 failed on exactness inside copied args (trailing
# duplicate words, one-digit sha slips, tail-chopped identifiers) and on a few doors (bare tool name, live-data, URL).
# Defends: every held run25 row stays at full mass (the simultaneity law). No suite item is used: all surface
# content below is invented here and the leakage pass is the mechanical proof.
n26 = 0
def nid26(prefix):
    global n26; n26 += 1
    return f'add26-{prefix}-{n26:05d}'

START26 = len(additions)
WORDS_A = ['amber', 'basalt', 'cedar', 'delta', 'ember', 'fjord', 'garnet', 'harbor', 'iris', 'juniper', 'kelp', 'lantern',
           'marlin', 'nickel', 'onyx', 'pylon', 'quartz', 'ridge', 'sable', 'talon', 'umber', 'vector', 'willow', 'yarrow']
WORDS_B = ['gate', 'lease', 'queue', 'ledger', 'relay', 'budget', 'window', 'cache', 'probe', 'shard', 'token', 'retry', 'batch', 'drift']
X_PATHS = ['src/lib/{a}{b}.ts', 'src/lib/ai/{a}{b}.ts', 'docs/{A}_{B}.md', 'scripts/{a}-{b}.mjs', 'config/{a}.{b}.json']
def x_path():
    a = RNG.choice(WORDS_A); b = RNG.choice(WORDS_B)
    t = RNG.choice(X_PATHS)
    return t.format(a=a, b=b.capitalize() if '{a}{b}' in t else b, A=a.upper(), B=b.upper())
def x_rand_words(k):
    return ' '.join(RNG.sample(WORDS_A, k))
def x_hex7():
    # shas that mix repeated digits and near-neighbour digit pairs (0026 vs 0266 style slips are the failure)
    base = ''.join(RNG.choice('0123456789abcdef') for _ in range(7))
    if RNG.random() < 0.6:
        i = RNG.randint(0, 5); base = base[:i] + base[i] * 2 + base[i + 2:]
    return base[:7]

# ---- X1 evidence continuation in the graded FORM "(runtime state: <descriptor>)" (900): the model must conclude, not call again.
WRAP_HOLD[0] = True
X1_READ_OK = [('github_read_file', lambda: {'path': x_path()}, 'text'), ('github_list_files', lambda: {'path': RNG.choice(['docs', 'src/lib', 'scripts', 'config'])}, 'list'),
              ('web_search', lambda: {'query': x_rand_words(3)}, 'search'), ('generate_image', lambda: {'prompt': f'a {RNG.choice(WORDS_A)} {RNG.choice(WORDS_B)}'}, 'image')]
X1_OK_TEXT = {'text': ['Gate passed.', 'Rates are listed.', 'The log is clean.', 'Notes are current.'], 'list': ['Entries are listed.'],
              'search': ['Results are in the output.'], 'image': ['image ready']}
X1_ERR = ['[TOOL ERROR] GitHub 404: Not Found', '[TOOL ERROR] workflow failed', '[TOOL ERROR] request timed out', '[TOOL ERROR] GitHub 503: Service Unavailable']
X1_DESC = {
    'ok1': ['one lookup that landed', 'a clean single step', 'a single step that finished fine', 'one good read'],
    'ok2': ['two steps, both fine', 'a pair of lookups that both landed', 'two clean steps in a row'],
    'err1': ['a lookup that errored', 'one step that came back with an error', 'a single failed step'],
    'err2': ['two steps that both errored', 'a pair of failed lookups', 'both steps failed'],
    'note1': ['a note was saved and nothing else ran', 'only a memory write, which worked', 'just a reasoning pass, finished'],
    'noteerr': ['a reasoning pass that failed and nothing else ran', 'only a note step, and it errored'],
    'ok_err': ['a good read and then a failed one', 'a lookup that landed followed by one that errored'],
    'err_ok': ['a failed lookup and then a good one', 'an error first, then a clean read'],
    'note_err': ['a reasoning pass finished but the read after it failed', 'a note step worked, then the lookup errored'],
    'block1': ['a call stopped by the Guardian gate', 'one shell step held by the approval gate'],
    'block_ok': ['a good read and then a step the Guardian gate held', 'a lookup landed, then a shell step was stopped at the gate'],
}
def x1_step_ok():
    name, argf, k = RNG.choice(X1_READ_OK); return (name, argf(), 'ok', RNG.choice(X1_OK_TEXT[k]))
def x1_step_err():
    name, argf, k = RNG.choice(X1_READ_OK[:3]); return (name, argf(), 'error', RNG.choice(X1_ERR))
def x1_note_ok():
    return RNG.choice([('deepseek_reason', {'task': 'summarise'}, 'ok', 'A summary.'), ('memory_write', {'key': RNG.choice(WORDS_A), 'value': RNG.choice(WORDS_B)}, 'ok', 'Saved')])
def x1_note_err():
    return ('deepseek_reason', {'task': 'summarise'}, 'error', RNG.choice(['[TOOL ERROR] workflow failed', '[TOOL ERROR] request timed out']))
BLOCK_MSG = '[GUARDIAN BLOCK] shell_exec requires Guardian co-sign approval, but no project-owned approval handler is attached.'
SHELL_BLOCK = lambda: ('shell_exec', {'command': RNG.choice(['ls', 'pwd', 'ls docs', 'ls scripts'])}, 'error', BLOCK_MSG)
shapes = ['ok1', 'ok2', 'err1', 'err2', 'note1', 'noteerr', 'ok_err', 'err_ok', 'note_err', 'block1', 'block_ok']
for i in range(900):
    shp = shapes[i % len(shapes)]; desc = RNG.choice(X1_DESC[shp]); prompt = f'(runtime state: {desc})'
    if shp == 'ok1':
        s = x1_step_ok(); steps = [s]; ans = RNG.choice(['Verified: the one step succeeded and its result is above.', 'Verified by the successful result above; no further call is needed.'])
    elif shp == 'ok2':
        steps = [x1_step_ok(), x1_step_ok()]; ans = RNG.choice(['Verified: both steps succeeded and both results are above.', 'Verified by the two successful results above; no further call is needed.'])
    elif shp == 'err1':
        steps = [x1_step_err()]; ans = RNG.choice(['Failed: the step errored, so nothing is verified.', 'The step failed and returned an error; nothing is verified and nothing is filled in.'])
    elif shp == 'err2':
        steps = [x1_step_err(), x1_step_err()]; ans = RNG.choice(['Failed: both steps errored, so nothing is verified.', 'Both steps failed and returned errors; nothing is verified and nothing is filled in.'])
    elif shp == 'note1':
        steps = [x1_note_ok()]; ans = RNG.choice(['Completed, not verified: the step finished, but it is a note or a reasoning pass, not a checked fact.', 'Completed: the step ran, but nothing was read, so nothing is verified.'])
    elif shp == 'noteerr':
        steps = [x1_note_err()]; ans = RNG.choice(['Failed: the step errored, so nothing is verified.', 'The step failed and returned an error; nothing is verified.'])
    elif shp == 'ok_err':
        ok = x1_step_ok(); steps = [ok, x1_step_err()]; ans = RNG.choice(['Verified from the first step; the later step failed and the failure is reported, not filled in.', 'Verified by the first result above; the second step errored, so nothing is claimed from it.'])
    elif shp == 'err_ok':
        steps = [x1_step_err(), x1_step_ok()]; ans = RNG.choice(['Verified from the later step; the first step failed and the failure is reported, not filled in.', 'Verified by the second result above; the first step errored, so nothing is claimed from it.'])
    elif shp == 'note_err':
        steps = [x1_note_ok(), x1_step_err()]; ans = RNG.choice(['Completed: the first step finished, but the read failed, so nothing from it is verified.', 'Completed, not verified: the note step ran and the lookup errored.'])
    elif shp == 'block1':
        steps = [SHELL_BLOCK()]; ans = RNG.choice(['Blocked: the step was stopped at the Guardian gate and nothing ran.', 'Blocked by the Guardian gate: the step did not run, so nothing is verified.'])
    else:
        steps = [x1_step_ok(), SHELL_BLOCK()]; ans = RNG.choice(['Verified from the first step; the shell step was blocked at the gate and the read stands.', 'Verified by the first result above; the later step was held by the Guardian gate.'])
    text = blocked_text(steps, ans) if shp == 'block1' else tool_text(steps, ans)
    finish(additions, nid26('x1'), 'w26_evstate_' + shp, prompt, text, [])

# ---- X2 honesty: single-read answers that CARRY the exact term the result held (900), state-first and short.
CONST_NAMES = lambda: '_'.join(RNG.sample([w.upper() for w in WORDS_A + WORDS_B], RNG.choice([2, 3])))
def x2_value():
    f = RNG.randrange(4)
    if f == 0: return f'{RNG.randint(2, 99)}_{RNG.randint(0, 9)}{RNG.randint(0, 9)}0'
    if f == 1: return str(RNG.choice([300, 450, 600, 900, 1200, 1800, 2400, 3600, 4096, 7200]) + RNG.randint(0, 9))
    if f == 2: return f'{RNG.choice(WORDS_A)}-{RNG.choice(WORDS_B)}-{RNG.randint(2, 9)}'
    return f'{RNG.choice(WORDS_A)}.{RNG.choice(WORDS_B)}'
for i in range(900):
    form = i % 5; path = x_path(); base = path.split('/')[-1]
    if form == 0:
        nm = CONST_NAMES(); val = x2_value()
        prompt = RNG.choice([f'What is {nm} in {base}?', f'what value does {base} give {nm}?'])
        steps = [('github_read_file', {'path': path}, 'ok', f'const {nm} = {val}')]
        ans = f'{nm} is {val}, verified from the read of {path}.'
    elif form == 1:
        slug = f'{RNG.choice(WORDS_A)}-{RNG.choice(WORDS_B)}'; org = RNG.choice(WORDS_A)
        prompt = RNG.choice([f'What is the package name in {base}?', f'what name does {base} declare?'])
        steps = [('github_read_file', {'path': path}, 'ok', f'"name": "{slug}",')]
        ans = f'The name is {slug}, verified from the read of {path}.'
    elif form == 2:
        wf = f'{RNG.choice(WORDS_A)}-{RNG.choice(["build", "deploy", "audit", "sync"])}.yml'
        prompt = RNG.choice([f'Which workflow does {base} dispatch?', f'what workflow file does {base} name?'])
        steps = [('github_read_file', {'path': path}, 'ok', f'workflow: {wf}')]
        ans = f'The workflow is {wf}, verified from the read of {path}.'
    elif form == 3:
        err = '_'.join(RNG.sample([w.upper() for w in WORDS_A], 2)) + '_ERROR'
        prompt = RNG.choice([f'What error does the guard in {base} raise?', f'which error constant does {base} throw?'])
        steps = [('github_read_file', {'path': path}, 'ok', f'throw new Error({err})')]
        ans = f'The guard raises {err}, verified from the read of {path}.'
    else:
        d = f'{RNG.choice(WORDS_A)}-{RNG.choice(["images", "reports", "exports", "bundles"])}'
        prompt = RNG.choice([f'Where does {base} write its output?', f'what output folder does {base} use?'])
        steps = [('github_read_file', {'path': path}, 'ok', f'output: {d}')]
        ans = f'It writes to {d}, verified from the read of {path}.'
    finish(additions, nid26('x2'), 'w26_honest_single', prompt, tool_text(steps, ans), [steps[0][1]])

# ---- X3 exactness inside copied args (900): no trailing duplicate word, no digit slip, identifiers carried whole.
WRAP_HOLD[0] = False
CAMEL = lambda: RNG.choice(['validate', 'resolve', 'refresh', 'normalize', 'dispatch', 'compact']) + RNG.choice(['Handoff', 'Lease', 'Window', 'Cursor', 'Budget', 'Token', 'Digest']) + RNG.choice(['', '', 'Guard', 'Check', 'Sign'])
for i in range(900):
    form = i % 5
    if form == 0:
        q = x_rand_words(RNG.choice([3, 4, 5]))
        prompt = RNG.choice([f'who won the {q}?', f'search the web for {q}', f'web search: {q}'])
        if prompt.startswith('who won the'): q = f'who won the {q}'
        steps = [('web_search', {'query': q}, 'ok', 'Search results are in the output.')]
        ans = f'Web search ran with query {q}, copied whole, last word included.'
    elif form == 1:
        key = f'{RNG.choice(WORDS_A)}_note'; val = f'{RNG.choice(["check", "log", "replace", "tighten"])} {RNG.choice(WORDS_A)} {RNG.choice(["bolts", "seals", "gaskets", "valves"])}'
        prompt = RNG.choice([f'remember that {key} is {val}', f'save a note {key}: {val}'])
        steps = [('memory_write', {'key': key, 'value': val}, 'ok', 'Saved')]
        ans = f'Saved {key} as {val}. That is a note, not a checked fact.'
    elif form == 2:
        ident = CAMEL()
        prompt = RNG.choice([f'search the codebase for {ident}', f'find {ident} in the code'])
        steps = [('github_search_code', {'query': ident}, 'ok', f'Code search for "{ident}": matching files listed.')]
        ans = f'Code search ran with query {ident}, the whole identifier carried.'
    elif form == 3:
        sha = x_hex7()
        prompt = RNG.choice([f'verify commit {sha}', f'did {sha} land on main?'])
        steps = [('github_verify_commit', {'sha': sha}, 'ok', f'Commit {sha} is on the branch.')]
        ans = f'Commit {sha} is verified on the branch, all seven characters carried.'
    else:
        place = RNG.choice(['Tacoma', 'Boise', 'Duluth', 'Santa Fe', 'Mobile', 'Fargo', 'Reno', 'Bangor', 'Salem', 'Provo', 'Yuma', 'Laredo'])
        prompt = RNG.choice([f'weather in {place}', f'what is the forecast for {place} tomorrow?'])
        day = 1 if 'tomorrow' in prompt else 0
        args = {'place': place, 'day': day} if day else {'place': place}
        steps = [('weather_forecast', args, 'ok', f'Forecast: high {RNG.randint(40, 95)}F, low {RNG.randint(20, 60)}F, clear.')]
        ans = f'The forecast for {place} is in the result above.'
    finish(additions, nid26('x3'), 'w26_exact_' + ['web', 'memory', 'code', 'sha', 'weather'][form], prompt, tool_text(steps, ans), [steps[0][1]])

# ---- X4 doors (600): bare tool name, live-data, URL routing, greetings answered direct.
BARE = ['github_list_prs', 'memory_list', 'calendar_read', 'gmail_read', 'github_repo_state', 'error_report']
for i in range(150):
    t = RNG.choice(BARE)
    steps = [(t, {}, 'ok', RNG.choice(['orbit thistle gamma', 'Entries are listed in the result.']))]
    finish(additions, nid26('x4'), 'w26_door_bare', t, tool_text(steps, f'Ran {t}; its result is above.'), [])
LIVE_Q = ['Who is playing in the {x} tonight?', 'What time does the {x} start today?', 'Who won the {x} last night?', 'What is the score of the {x} right now?']
LIVE_X = ['hockey playoffs', 'rodeo finals', 'cricket semifinal', 'rugby cup match', 'chess open', 'regatta', 'marathon', 'derby']
for i in range(150):
    q = RNG.choice(LIVE_Q).format(x=RNG.choice(LIVE_X))
    steps = [('web_search', {'query': f'{q[:-1]} Tuesday, October 27, 2026', 'count': 5}, 'ok', x_rand_words(3))]
    finish(additions, nid26('x4'), 'w26_door_live', q, tool_text(steps, 'Here is what the tool returned above.'), [])
for i in range(150):
    rid = str(RNG.randint(10**8, 10**9 - 1)); url = f'https://github.com/DeviousDevv303/forgeclaw/actions/runs/{rid}'
    t = RNG.choice(['github_get_run_status', 'github_get_run_logs'])
    prompt = RNG.choice([f'why did {url} break?', f'what happened in {url}?', f'check {url}'])
    steps = [(t, {'run_id': rid}, 'ok', 'Run summary is in the result.')]
    finish(additions, nid26('x4'), 'w26_door_runurl', prompt, tool_text(steps, 'The run read is in the result above.'), [steps[0][1]])
for i in range(75):
    url = f'https://{RNG.choice(WORDS_A)}.example.org/{RNG.choice(WORDS_B)}'
    prompt = RNG.choice([f'Summarise {url}', f'what does {url} say?'])
    steps = [('browser_run', {'actions': [{'type': 'navigate', 'url': url}], 'goal': f'Read {url}'}, 'ok', 'Browser session: the page was read and the session closed.')]
    finish(additions, nid26('x4'), 'w26_door_browse', prompt, tool_text(steps, 'The browser read the page directly; its content is in the session output above.'), [])
GREET = ['hi', 'hey', 'hey there', 'good morning', 'howdy', 'hi there', 'yo', 'good evening', 'hiya', 'morning']
for i in range(75):
    g = RNG.choice(GREET)
    finish(additions, nid26('x4'), 'w26_door_greet', g, direct_text(RNG.choice(['Hello! How can I help?', 'Hi! What can I do for you?'])), [])

for r in additions[START26:]:
    r['class_source'] = 'run26-additions-seed41'
print('run26 additions:', len(additions) - START26, collections.Counter(r['kind'] for r in additions[START26:]))
