#!/usr/bin/env python3
"""REVIEWER v1 diagnostic 2x2 (not an exam run): {workflow scaffold, neutral prompt} x {non-thinking, thinking}.
Runs the REAL embedded script of deepseek-16b.yml @ 4382e09 against the REAL Qwen3-8B Q4_K_M GGUF locally (CPU),
with only these patches, each asserted to apply exactly once:
  all cells : MAX_NEW_TOKENS -> 3000, FAST_TIME_BUDGET_S -> 1800 (equal budget in every cell; run 1 hit neither cap)
  thinking  : build_prompt drops the empty <think></think> block (Qwen3's documented non-thinking switch)
  neutral   : build_prompt ignores the scaffold and returns NEUTRAL_TEMPLATE (no system turn) filled with TASK/CONTEXT
Payloads are run 1's (manifest 2416cc9a...), same invocation ids, so the sampling seed is held constant across cells.
Usage: run_2x2.py PAYLOADS.json GGUF VENV_PYTHON OUT.jsonl  (resumable: rows already in OUT are skipped)"""
import hashlib, json, os, pathlib, re, shutil, subprocess, sys, tempfile, time
REPO = pathlib.Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / '.github/scripts'))
import test_deepseek_workflow_engine as T  # reuses its torch/transformers stubs only
NEUTRAL_TEMPLATE = '<|im_start|>user\nTask:\n{task}\n\nContext:\n{context}<|im_end|>\n<|im_start|>assistant\n{think}'
NONTHINK, THINK_OPEN = '<think>\n\n</think>\n\n', ''
CELLS = [('A', 'scaffold', False), ('C', 'neutral', False), ('B', 'scaffold', True), ('D', 'neutral', True)]
ORDER = ['RV-01', 'RV-02', 'RV-03', 'RV-04', 'RV-05', 'RV-06', 'RV-07', 'RV-08', 'RV-09']
sha = lambda s: hashlib.sha256(s.encode('utf-8')).hexdigest()
def once(text, old, new):
    assert text.count(old) == 1, old
    return text.replace(old, new)
def main():
    payloads, gguf, py, out = sys.argv[1], sys.argv[2], sys.argv[3], pathlib.Path(sys.argv[4])
    rows = {p['fixture']: p for p in json.load(open(payloads))['payloads']}
    done = {(r['cell'], r['fixture']) for r in map(json.loads, out.read_text().splitlines())} if out.exists() else set()
    for cell, prompt, think in CELLS:
        for fid in ORDER:
            if (cell, fid) in done: continue
            p = rows[fid]
            tmp = pathlib.Path(tempfile.mkdtemp(prefix='2x2-'))
            stubs = tmp / 'stubs'; stubs.mkdir()
            (stubs / 'torch.py').write_text(T.STUBS['torch.py']); (stubs / 'transformers.py').write_text(T.STUBS['transformers.py'])
            (stubs / 'huggingface_hub.py').write_text(f"def list_repo_files(repo): return ['Qwen3-8B-Q4_K_M.gguf']\ndef hf_hub_download(repo_id, filename, local_dir): return {gguf!r}\n")
            (tmp / '.github').mkdir(); shutil.copytree(REPO / '.github/scripts', tmp / '.github/scripts', ignore=shutil.ignore_patterns('__pycache__'))
            script = T.embedded_script()
            script = once(script, 'MAX_NEW_TOKENS = 3000 if LONG_OUTPUT else 768', 'MAX_NEW_TOKENS = 3000')
            script = once(script, 'FAST_TIME_BUDGET_S = 900 if LONG_OUTPUT else 420', 'FAST_TIME_BUDGET_S = 1800')
            (tmp / 'run.py').write_text(script)
            g = tmp / '.github/scripts/deepseek_gguf.py'; gs = g.read_text()
            old_ret = '    return f"{system}<|im_start|>user\\n{user_text}<|im_end|>\\n<|im_start|>assistant\\n<think>\\n\\n</think>\\n\\n"'
            if prompt == 'neutral':
                new_ret = ('    import os as _os\n    return ' + repr(NEUTRAL_TEMPLATE) + ".format(task=_os.environ['TASK'].strip(), context=_os.environ['CONTEXT'].strip(), think="
                           + repr(THINK_OPEN if think else NONTHINK) + ')')
            else:
                new_ret = old_ret.replace('<think>\\n\\n</think>\\n\\n', '') if think else old_ret
            g.write_text(once(gs, old_ret, new_ret) if new_ret != old_ret else gs)
            env = {'PATH': os.environ['PATH'], 'HOME': str(tmp / 'home'), 'PYTHONDONTWRITEBYTECODE': '1', 'PYTHONPATH': str(stubs),
                   'TASK': p['task'], 'CONTEXT': p['context'], 'INVOCATION_ID': p['invocation_id'], 'EXAM_FORBIDDEN': p['exam_forbidden']}
            t0 = time.time()
            r = subprocess.run([py, '-B', 'run.py'], cwd=tmp, env=env, capture_output=True, text=True, timeout=2400)
            rd = lambda n: (tmp / n).read_text(encoding='utf-8') if (tmp / n).exists() else None
            meta = dict(l.split('=', 1) for l in (rd('result_meta.txt') or '').splitlines() if '=' in l)
            prompt_final = rd('prompt_final.txt') or ''
            result = rd('result.txt') or ''
            answer = result.split('</think>', 1)[1] if '</think>' in result else result
            m = re.search(r'"verdict"\s*:\s*"([^"]*)"', answer)
            rec = {'cell': cell, 'prompt': prompt, 'thinking': think, 'fixture': fid, 'rc': r.returncode, 'wall_s': round(time.time() - t0, 1),
                   'prompt_sha256': sha(prompt_final), 'context_in_prompt': p['context'] in prompt_final, 'task_in_prompt': p['task'] in prompt_final,
                   'verdict': m.group(1) if m else None, 'result_sha256': sha(result), 'result': result,
                   'meta': {k: meta.get(k) for k in ('generated_tokens', 'stopped_by_time_budget', 'prompt_trimmed', 'context_check', 'sampling_seed', 'sampling_seed_applied', 'degraded', 'model')},
                   'stderr_tail': r.stderr[-400:] if r.returncode else ''}
            with out.open('a') as f: f.write(json.dumps(rec, ensure_ascii=False) + '\n')
            print(cell, fid, rec['verdict'], rec['meta']['generated_tokens'], rec['wall_s'], flush=True)
            shutil.rmtree(tmp, ignore_errors=True)
main()
