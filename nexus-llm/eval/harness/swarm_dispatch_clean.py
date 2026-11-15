#!/usr/bin/env python3
"""Swarm dispatch cleanliness check (read-only): the same conditions as reviewer_v1_run1_clean.py, for ONE fire-queue file.
    python3 swarm_dispatch_clean.py <queue.json> <mirror_dir> <workflow_commit>
<mirror_dir> holds <invocation_id>.prompt.txt and .meta.txt read from the mirror branch (qwen-results for artifacts written by qwen3-8b.yml; deepseek-results for those banked before the 2026-11-04 rename). CLEAN iff ALL hold:
  1 meta context_sha256 == sha256(prompt bytes), basis fitted_prompt, prompt_calls == 1
  2 prompt == pre + task + mid + context + post, where task and context are the queue file's inputs.task and inputs.context
    byte for byte (task located at the workflow's own 'Task:' head), and sha256(pre/mid/post) == the meta segment hashes
  3 pre/mid/post == the dry-run clean anchors (the swarm and REVIEWER dispatches share them; confirmed on a banked swarm meta)
  4 context_check=clean, prompt_trimmed=false, sampling_seed_applied=true, degraded=false, workflow_commit == the given commit
Prints a JSON record and exits 0 only if CLEAN. It never dispatches, writes nothing, and judges only transport, not the model's output."""
import hashlib, json, pathlib, sys
ANCHOR = {'pre': '60743ab5b41b18ace3a2419c0faa320e1d9475166d45b655d9fa375ecd1e7892',
          'mid': 'e5f0d8355b064c90af06231a11b0ea5bbd9b49e3070edeabe188e01ccfaa673f',
          'post': '391ff1d82cb528176b92470ae3a412f463f3f78d53516b9e1c77bf79dc6fd1e0'}
sha = lambda s: hashlib.sha256(s.encode('utf-8')).hexdigest()
q = json.load(open(sys.argv[1])); mirror = pathlib.Path(sys.argv[2]); pin = sys.argv[3]
inv, task, context = q['invocation_id'], q['inputs']['task'], q['inputs']['context']
why = []
pf, mf = mirror / f'{inv}.prompt.txt', mirror / f'{inv}.meta.txt'
if not (pf.exists() and mf.exists()):
    print(json.dumps({'invocation_id': inv, 'clean': False, 'why': ['mirror files missing']})); sys.exit(1)
prompt = pf.read_bytes().decode('utf-8')
meta = dict(l.split('=', 1) for l in mf.read_text(encoding='utf-8').splitlines() if '=' in l)
if meta.get('context_sha256') != sha(prompt): why.append('context_sha256 != sha256(prompt)')
if meta.get('context_sha256_basis') != 'fitted_prompt': why.append(f"basis={meta.get('context_sha256_basis')}")
if meta.get('prompt_calls') != '1': why.append(f"prompt_calls={meta.get('prompt_calls')}")
head = 'Task:\n' + task + '\n\nVerified project, CORPUS, and tool context:\n'
at, first_divergence = prompt.find(head), None
seg = {}
if at < 0:
    why.append('task head / task text not found verbatim')
    ts = prompt.find('Task:\n')
    if ts >= 0:  # report where the sent task first differs from what the render carries
        r = prompt[ts + 6:]
        first_divergence = next((i for i, (a, b) in enumerate(zip(task, r)) if a != b), min(len(task), len(r)))
else:
    ts = at + len('Task:\n'); te = ts + len(task); cs = prompt.find(context, te)
    if cs < 0: why.append('context not found verbatim after the task')
    else:
        seg = {'pre': prompt[:ts], 'mid': prompt[te:cs], 'post': prompt[cs + len(context):]}
        assert seg['pre'] + task + seg['mid'] + context + seg['post'] == prompt
        for k in seg:
            h = sha(seg[k])
            if meta.get(f'segment_sha256_{k}') != h: why.append(f'segment {k} != meta')
            if h != ANCHOR[k]: why.append(f'segment {k} != dry-run anchor')
for k, want in [('context_check', 'clean'), ('prompt_trimmed', 'false'), ('sampling_seed_applied', 'true'), ('degraded', 'false'), ('workflow_commit', pin)]:
    if meta.get(k) != want: why.append(f'{k}={meta.get(k)}')
rec = {'invocation_id': inv, 'clean': not why, 'why': why, 'task_chars': len(task), 'context_chars': len(context),
       'task_sha256': sha(task), 'context_sha256': sha(context), 'prompt_sha256': sha(prompt), 'first_task_divergence_offset': first_divergence,
       'sampling_seed': meta.get('sampling_seed'), 'generated_tokens': meta.get('generated_tokens'), 'stopped_by_time_budget': meta.get('stopped_by_time_budget')}
print(json.dumps(rec, indent=1)); sys.exit(0 if rec['clean'] else 1)
