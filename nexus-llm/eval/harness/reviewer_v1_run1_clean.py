#!/usr/bin/env python3
"""REVIEWER v1 run 1: per-dispatch cleanliness record (Amendment 2 item 4, A5). Reads payloads.json and, per fixture,
the mirrored <inv>.prompt.txt + <inv>.meta.txt from the deepseek-results branch. A dispatch is CLEAN iff ALL hold:
 1 meta context_sha256 == sha256(prompt.txt bytes), basis fitted_prompt, prompt_calls == 1
 2 prompt == pre + task + mid + context + post, with task == the pinned job text and context == the row's canonical
   input byte for byte (located at the workflow's own 'Task:' head), and sha256(pre/mid/post) == the meta segment hashes
 3 pre/mid/post hashes == the dry-run clean anchor (pin b9004ca; the workflow and scripts are unchanged since)
 4 context_check=clean, prompt_trimmed=false, sampling_seed_applied=true, degraded=false, workflow_commit == PIN
Any dispatch not CLEAN voids the whole run (A1); there is no per-row re-run."""
import hashlib, json, sys, pathlib
ANCHOR = {'pre': '60743ab5b41b18ace3a2419c0faa320e1d9475166d45b655d9fa375ecd1e7892',
          'mid': 'e5f0d8355b064c90af06231a11b0ea5bbd9b49e3070edeabe188e01ccfaa673f',
          'post': '391ff1d82cb528176b92470ae3a412f463f3f78d53516b9e1c77bf79dc6fd1e0'}  # dry-run clean run at pin b9004ca
sha = lambda s: hashlib.sha256(s.encode('utf-8')).hexdigest()
payloads, mirror, pin = json.load(open(sys.argv[1])), pathlib.Path(sys.argv[2]), sys.argv[3]
records, all_clean = [], True
for p in payloads['payloads']:
    inv, why = p['invocation_id'], []
    pf, mf = mirror / f'{inv}.prompt.txt', mirror / f'{inv}.meta.txt'
    if not pf.exists() or not mf.exists():
        records.append({'fixture': p['fixture'], 'clean': False, 'why': ['mirror files missing']}); all_clean = False; continue
    prompt = pf.read_bytes().decode('utf-8')
    meta = dict(l.split('=', 1) for l in mf.read_text(encoding='utf-8').splitlines() if '=' in l)
    if meta.get('context_sha256') != sha(prompt): why.append('context_sha256 != sha256(prompt.txt)')
    if meta.get('context_sha256_basis') != 'fitted_prompt': why.append('basis')
    if meta.get('prompt_calls') != '1': why.append(f"prompt_calls={meta.get('prompt_calls')}")
    head = 'Task:\n' + p['task'] + '\n\nVerified project, CORPUS, and tool context:\n'
    at = prompt.find(head)
    seg = {}
    if at < 0: why.append('task head / job text not found verbatim')
    else:
        ts = at + len('Task:\n'); te = ts + len(p['task']); cs = prompt.find(p['context'], te)
        if cs < 0: why.append('canonical context not found verbatim')
        else:
            seg = {'pre': prompt[:ts], 'mid': prompt[te:cs], 'post': prompt[cs + len(p['context']):]}
            assert seg['pre'] + p['task'] + seg['mid'] + p['context'] + seg['post'] == prompt
            for k in seg:
                h = sha(seg[k])
                if meta.get(f'segment_sha256_{k}') != h: why.append(f'segment {k} != meta')
                if h != ANCHOR[k]: why.append(f'segment {k} != dry-run anchor')
    for k, want in [('context_check', 'clean'), ('prompt_trimmed', 'false'), ('sampling_seed_applied', 'true'),
                    ('degraded', 'false'), ('workflow_commit', pin)]:
        if meta.get(k) != want: why.append(f'{k}={meta.get(k)}')
    clean = not why; all_clean &= clean
    records.append({'fixture': p['fixture'], 'invocation_id': inv, 'clean': clean, 'why': why,
                    'prompt_sha256': sha(prompt), 'context_sha256_row': p['context_sha256'], 'model': meta.get('model'),
                    'sampling_seed': meta.get('sampling_seed'), 'tokens': meta.get('tokens') or meta.get('generated_tokens')})
print(json.dumps({'run_valid': all_clean, 'records': records}, indent=1))
