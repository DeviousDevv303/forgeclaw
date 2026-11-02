#!/usr/bin/env python3
"""REVIEWER v1 round-3 diagnostic runner (not an exam run). Runs the REAL embedded script of deepseek-16b.yml @ 4382e09 (workflow scaffold,
non-thinking: exactly as production and as run 1) against the Qwen3-8B Q4_K_M GGUF given as argument 2, locally on CPU. The only patches, each asserted
to apply exactly once: MAX_NEW_TOKENS -> 3000 and FAST_TIME_BUDGET_S -> 1800 (as in the 2x2 and Q8 diagnostics). Each payload item is one call with its
own TASK, CONTEXT and invocation id, so it has its own sampling seed. Resumable: items already in OUT are skipped.
Usage: run_r3.py PAYLOADS.json GGUF VENV_PYTHON OUT.jsonl [ARM]   (ARM: i or ii; default both)"""
import hashlib, json, os, pathlib, shutil, subprocess, sys, tempfile, time
REPO = pathlib.Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / '.github/scripts'))
import test_deepseek_workflow_engine as T  # reuses its torch/transformers stubs only
sha = lambda s: hashlib.sha256(s.encode('utf-8')).hexdigest()
def once(text, old, new):
    assert text.count(old) == 1, old
    return text.replace(old, new)
def main():
    payloads, gguf, py, out = sys.argv[1], sys.argv[2], sys.argv[3], pathlib.Path(sys.argv[4])
    arm = sys.argv[5] if len(sys.argv) > 5 else None
    items = [i for i in json.load(open(payloads))['items'] if arm in (None, i['arm'])]
    done = {r['invocation_id'] for r in map(json.loads, out.read_text().splitlines())} if out.exists() else set()
    for p in items:
        if p['invocation_id'] in done: continue
        tmp = pathlib.Path(tempfile.mkdtemp(prefix='r3-'))
        stubs = tmp / 'stubs'; stubs.mkdir()
        (stubs / 'torch.py').write_text(T.STUBS['torch.py']); (stubs / 'transformers.py').write_text(T.STUBS['transformers.py'])
        (stubs / 'huggingface_hub.py').write_text(f"def list_repo_files(repo): return ['Qwen3-8B-Q4_K_M.gguf']\ndef hf_hub_download(repo_id, filename, local_dir): return {gguf!r}\n")
        (tmp / '.github').mkdir(); shutil.copytree(REPO / '.github/scripts', tmp / '.github/scripts', ignore=shutil.ignore_patterns('__pycache__'))
        script = T.embedded_script()
        script = once(script, 'MAX_NEW_TOKENS = 3000 if LONG_OUTPUT else 768', 'MAX_NEW_TOKENS = 3000')
        script = once(script, 'FAST_TIME_BUDGET_S = 900 if LONG_OUTPUT else 420', 'FAST_TIME_BUDGET_S = 1800')
        (tmp / 'run.py').write_text(script)
        env = {'PATH': os.environ['PATH'], 'HOME': str(tmp / 'home'), 'PYTHONDONTWRITEBYTECODE': '1', 'PYTHONPATH': str(stubs),
               'TASK': p['task'], 'CONTEXT': p['context'], 'INVOCATION_ID': p['invocation_id'], 'EXAM_FORBIDDEN': p['exam_forbidden']}
        t0 = time.time()
        r = subprocess.run([py, '-B', 'run.py'], cwd=tmp, env=env, capture_output=True, text=True, timeout=2400)
        rd = lambda n: (tmp / n).read_text(encoding='utf-8') if (tmp / n).exists() else None
        meta = dict(l.split('=', 1) for l in (rd('result_meta.txt') or '').splitlines() if '=' in l)
        prompt_final = rd('prompt_final.txt') or ''
        result = rd('result.txt') or ''
        rec = {'invocation_id': p['invocation_id'], 'arm': p['arm'], 'fixture': p['fixture'], 'check': p['check'], 'rc': r.returncode,
               'wall_s': round(time.time() - t0, 1), 'task_sha256': p['task_sha256'], 'context_sha256': p['context_sha256'],
               'prompt_sha256': sha(prompt_final), 'task_in_prompt': p['task'] in prompt_final, 'context_in_prompt': p['context'] in prompt_final,
               'result': result, 'result_sha256': sha(result),
               'meta': {k: meta.get(k) for k in ('generation_seconds', 'generated_tokens', 'stopped_by_time_budget', 'prompt_trimmed', 'context_check', 'sampling_seed', 'sampling_seed_applied', 'degraded', 'model')},
               'gguf': pathlib.Path(gguf).name, 'stderr_tail': r.stderr[-400:] if r.returncode else ''}
        with out.open('a') as f: f.write(json.dumps(rec, ensure_ascii=False) + '\n')
        print(p['arm'], p['fixture'], p['check'], meta.get('generated_tokens'), rec['wall_s'], flush=True)
        shutil.rmtree(tmp, ignore_errors=True)
main()
