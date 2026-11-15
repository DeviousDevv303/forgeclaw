#!/usr/bin/env python3
"""REVIEWER v1 round-3 diagnostic payloads (not an exam run). Built from the frozen git objects at c8d6cc5 and the merged REVIEWER checks.
Arm (i)  one check per call : 9 rows x 6 checks = 54 payloads. task = one fixed check question, context = the row's canonical input (run 1's form).
Arm (ii) checks as input    : 9 payloads. task = run 1's job text, context = the canonical input + a block holding the deterministic check results.
Usage: build_payloads_r3.py CHECKS.json RUN1_PAYLOADS.json OUT.json"""
import hashlib, json, subprocess, sys
FROZEN = 'c8d6cc53bf18c94e85966b20e76f2c3e68568cb8'
REPO = '/home/user/forgeclaw'
sha = lambda b: hashlib.sha256(b if isinstance(b, bytes) else b.encode('utf-8')).hexdigest()
fx = subprocess.run(['git', '-C', REPO, 'show', f'{FROZEN}:nexus-llm/eval/reviewer-v1/reviewer-fixtures.jsonl'], capture_output=True, check=True).stdout
assert sha(fx) == '5fb658b9b3077f6aa183b82a177dcd0d5c191291eb014eb94183b85280039ceb'
rows = {r['fixture']: r for r in map(json.loads, fx.decode('utf-8').splitlines()) if r}
checks = json.load(open(sys.argv[1]))
run1 = json.load(open(sys.argv[2]))
assert sha(open(sys.argv[2], 'rb').read()) == '2416cc9a10dd9718b1c9caa55651852e3e7ea0619653bfeba7b49ba9e0aff3da'
job_text = run1['payloads'][0]['task']
assert sha(job_text) == '547f9fb1120bb2165566790c58152448e7aa7c0883c415dabe8695d38b23025a'
forbidden = {p['fixture']: p['exam_forbidden'] for p in run1['payloads']}
canon = lambda r: json.dumps(r['input'], sort_keys=True, separators=(',', ':'), ensure_ascii=False)

PREFIX = ('You are checking ONE thing about a pull-request review packet. Answer only the question below, from the packet in the context, '
          'and quote the exact text or file:line your answer rests on. Do not review anything else.\n\nQUESTION: ')
SUFFIX = ('\n\nReply with exactly one JSON object and nothing else: {"finding": "flag" or "pass", "kind": %s, "evidence": "<quoted text or file:line from the packet, or none>"}')
KIND_FIXED, KIND_TC = 'null', '"inflated-count" or "stale-count" if you flag, otherwise null'
QUESTIONS = [
 ('refs', 'The claims cite comment IDs (10-digit numbers). For each cited ID, does the packet show that it resolves (for example "exists" in a resolver table) or that it does not (for example HTTP 404)? Flag if any cited ID does not resolve. Pass if every cited ID resolves, or if no comment IDs are cited.', KIND_FIXED),
 ('lost-lines', 'Does the diff (if there is one) delete code that no claim says is being deleted? Flag if some hunk removes substantial lines (functions, imports or comment blocks) that the claims never mention removing. Pass if the claims account for every removal, or if there is no diff.', KIND_FIXED),
 ('test-count', 'If a claim states a number of tests, does it match the enumeration or CI output in the packet, counted on the tree the change merges into (the base) when both are given? Flag if the stated count is larger than the enumeration ("inflated-count"), or true for an older tree but not for the base ("stale-count"). Pass if the counts agree or no test count is stated.', KIND_TC),
 ('diff-stat', 'If a claim states a line count such as "+N/-M", does it match the number of added and removed lines in the diff? Flag if they differ. Pass if they match, or if no such count or no diff is given.', KIND_FIXED),
 ('self-contradiction', 'Does any rendered sentence or verdict text in the packet list the same item as both successfully read and failed or not read? Flag if so. Pass if not, or if the packet has no rendered text.', KIND_FIXED),
 ('unread-reply', 'Does the code excerpt (if there is one) return a success status after swallowing or ignoring a failed or unparsed response, for example a catch that turns a parse failure into an empty object, followed by a success return? Flag if so. Pass if not, or if no code is given.', KIND_FIXED),
]
HEAD = ('REALITY-CHECK RESULTS (computed by code from the packet above, not a model opinion). Status is flag, pass, skip (nothing to check), '
        'or unverified (could not be settled):')
def block(rid):
    lines = []
    for c in checks[rid]:
        s = f"- {c['check']}: {c['status']}"
        if c['status'] == 'flag': s += f" ({c['kind']}); evidence: {', '.join(c['evidence'])}"
        elif c['status'] == 'unverified': s += f"; unresolved: {', '.join(c['evidence'])}"
        lines.append(s)
    return HEAD + '\n' + '\n'.join(lines)
items = []
for rid in sorted(rows):
    for name, q, kind in QUESTIONS:
        task = PREFIX + q + SUFFIX % kind
        items.append({'arm': 'i', 'fixture': rid, 'check': name, 'invocation_id': f'reviewer-v1-r3-i-{rid}-{name}',
                      'task': task, 'context': canon(rows[rid]), 'exam_forbidden': forbidden[rid]})
for rid in sorted(rows):
    ctx = canon(rows[rid]) + '\n\n' + block(rid)
    items.append({'arm': 'ii', 'fixture': rid, 'check': None, 'invocation_id': f'reviewer-v1-r3-ii-{rid}',
                  'task': job_text, 'context': ctx, 'exam_forbidden': forbidden[rid]})
for it in items: it['task_sha256'], it['context_sha256'] = sha(it['task']), sha(it['context'])
out = {'frozen_at': FROZEN, 'fixtures_sha256': sha(fx), 'run1_manifest_sha256': sha(open(sys.argv[2], 'rb').read()),
       'checks_sha256': sha(open(sys.argv[1], 'rb').read()), 'items': items}
json.dump(out, open(sys.argv[3], 'w'), indent=1, ensure_ascii=False)
print(len(items), 'items;', sum(i['arm'] == 'i' for i in items), 'arm i,', sum(i['arm'] == 'ii' for i in items), 'arm ii')
print('check-question hashes:'); [print(' ', n, sha(PREFIX + q + SUFFIX % k)[:16]) for n, q, k in QUESTIONS]
