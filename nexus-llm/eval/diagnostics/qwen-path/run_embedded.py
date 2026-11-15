#!/usr/bin/env python3
"""Runs the REAL embedded script of .github/workflows/qwen3-8b.yml (the renamed workflow) against the real Qwen3-8B Q4_K_M GGUF, locally on CPU, once
(chat profile, default budgets: no patches). Only torch/transformers/huggingface_hub are stubbed (as in the workflow engine tests); llama.cpp is real.
Writes result.txt and result_meta.txt into OUT_DIR. Diagnostic, grades nothing.
Usage: run_embedded.py GGUF VENV_PYTHON OUT_DIR INVOCATION_ID TASK"""
import os, pathlib, shutil, subprocess, sys, tempfile
REPO = pathlib.Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / '.github/scripts'))
import test_qwen_workflow_engine as T  # reuses its torch/transformers stubs and the embedded-script extractor
gguf, py, out, inv, task = sys.argv[1:6]
out = pathlib.Path(out); out.mkdir(parents=True, exist_ok=True)
tmp = pathlib.Path(tempfile.mkdtemp(prefix='qwenpath-'))
stubs = tmp / 'stubs'; stubs.mkdir()
(stubs / 'torch.py').write_text(T.STUBS['torch.py']); (stubs / 'transformers.py').write_text(T.STUBS['transformers.py'])
(stubs / 'huggingface_hub.py').write_text(f"def list_repo_files(repo): return ['Qwen3-8B-Q4_K_M.gguf']\ndef hf_hub_download(repo_id, filename, local_dir): return {gguf!r}\n")
(tmp / '.github').mkdir(); shutil.copytree(REPO / '.github/scripts', tmp / '.github/scripts', ignore=shutil.ignore_patterns('__pycache__'))
(tmp / 'run.py').write_text(T.embedded_script())
env = {'PATH': os.environ['PATH'], 'HOME': str(tmp / 'home'), 'PYTHONDONTWRITEBYTECODE': '1', 'PYTHONPATH': str(stubs), 'TASK': task, 'CONTEXT': '', 'INVOCATION_ID': inv}
r = subprocess.run([py, '-B', 'run.py'], cwd=tmp, env=env, capture_output=True, text=True, timeout=2400)
for n in ('result.txt', 'result_meta.txt'):
    if (tmp / n).exists(): shutil.copy(tmp / n, out / n)
print('rc', r.returncode); print(r.stdout[-600:]); print(r.stderr[-600:])
