#!/usr/bin/env python3
"""REVIEWER v1 exam, run 1: build the 9 dispatch payloads from the frozen git objects at c8d6cc5 only.
Job text = frozen doc lines 13-21 (sec. 1 job + output schema) and 25-35 (sec. 2 vocabulary), verbatim; line 23
(harness note about grader keys) excluded. Context = canonical JSON of the row's `input`:
json.dumps(input, sort_keys=True, separators=(',', ':'), ensure_ascii=False). Nothing else rides the payload."""
import base64, hashlib, json, subprocess, sys
FROZEN = 'c8d6cc53bf18c94e85966b20e76f2c3e68568cb8'
REPO = '/home/user/forgeclaw'
show = lambda p: subprocess.run(['git', '-C', REPO, 'show', f'{FROZEN}:{p}'], capture_output=True, check=True).stdout
sha = lambda b: hashlib.sha256(b if isinstance(b, bytes) else b.encode('utf-8')).hexdigest()
fx_bytes = show('nexus-llm/eval/reviewer-v1/reviewer-fixtures.jsonl')
assert sha(fx_bytes) == '5fb658b9b3077f6aa183b82a177dcd0d5c191291eb014eb94183b85280039ceb'
doc = show('nexus-llm/eval/reviewer-v1/reviewer-benchmark-v1.md').decode('utf-8')
assert sha(doc) == '64aeeb356d956dd84f05cfb25b0ebbbd028992a2af40cfbd100b84cbc7cfd064'
lines = doc.split('\n')
job = ('\n'.join(lines[12:21]) + '\n\n' + '\n'.join(lines[24:35])).strip()
assert job.startswith("REVIEWER's one job") and job.endswith('| `reject:phantom-ref` | A cited reference does not resolve |')
GRADER = ['expected_verdict', 'rule', 'must_cite', 'must_not_state', 'trap', 'provenance_label', 'source_citation']
GUIDANCE_MARKERS = ['NEXUS GUIDANCE', 'NEXUS APPROVED KNOWLEDGE', 'NEXUS LEARNED KNOWLEDGE', '[END NEXUS GUIDANCE]']
out = []
for line in fx_bytes.decode('utf-8').splitlines():
    if not line.strip():
        continue
    row = json.loads(line)
    ctx = json.dumps(row['input'], sort_keys=True, separators=(',', ':'), ensure_ascii=False)
    sent = job + '\n' + ctx
    # Denylist: guidance markers, plus every grader-only string of this row that is not already in what is legitimately
    # sent (a grader string the input itself contains cannot be a leak). Strings under 12 chars are skipped (too generic).
    vals = []
    for k in ['trap', 'provenance_label', 'source_citation', 'rule']:
        v = row.get(k)
        vals += v if isinstance(v, list) else ([v] if isinstance(v, str) else [])
    forbidden = GUIDANCE_MARKERS + sorted({v for v in vals if len(v) >= 12 and v not in sent})
    fb64 = base64.b64encode(json.dumps(forbidden, ensure_ascii=False).encode('utf-8')).decode('ascii')
    rid = row['fixture']
    inv = f'reviewer-v1-run1-{rid}'
    out.append({'fixture': rid, 'invocation_id': inv, 'task': job, 'context': ctx,
                'task_sha256': sha(job), 'context_sha256': sha(ctx), 'exam_forbidden': fb64,
                'exam_forbidden_sha256': sha(fb64), 'forbidden_count': len(forbidden),
                'grader_key_names_absent_as_keys': all(f'"{g}":' not in ctx for g in GRADER)})
assert len(out) == 9 and all(p['grader_key_names_absent_as_keys'] for p in out)
json.dump({'frozen_at': FROZEN, 'job_text_sha256': sha(job), 'payloads': out}, open(sys.argv[1], 'w'), indent=1, ensure_ascii=False)
print('job_text_sha256', sha(job), 'chars', len(job))
for p in out: print(p['fixture'], p['invocation_id'], p['context_sha256'][:16], len(p['context']), 'forbidden', p['forbidden_count'])
