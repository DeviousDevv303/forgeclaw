"""Runs the REAL embedded script from deepseek-16b.yml against stub torch / transformers / llama_cpp
modules, to pin the engine-selection behaviour: the GGUF engine for the primary (Qwen/Qwen3-8B) when
available, honest metadata, and on every failure mode the small labelled fallback model (the primary's
float16 weights do not fit the runner, so there is no float16 primary path) - never a silent wrong answer.

Run with: python -B -m unittest discover -s .github/scripts -p 'test_*.py'
"""
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest

HERE = pathlib.Path(__file__).resolve().parent
WORKFLOW = HERE.parent / "workflows" / "deepseek-16b.yml"

STUBS = {
    "torch.py": """
import contextlib
float16 = 'float16'
def set_num_threads(n): pass
@contextlib.contextmanager
def no_grad(): yield
""",
    "transformers.py": """
class _Ids:
    shape = (1, 5)
class _Tok:
    eos_token_id = 0
    chat_template = 'x'
    def apply_chat_template(self, messages, **kw): return {'input_ids': _Ids()}
    def decode(self, ids, skip_special_tokens=True): return 'SLOW ANSWER'
class AutoTokenizer:
    @staticmethod
    def from_pretrained(model_id): return _Tok()
class _Model:
    def eval(self): pass
    def generate(self, **kw): return [list(range(10))]
class AutoModelForCausalLM:
    @staticmethod
    def from_pretrained(model_id, **kw): return _Model()
""",
    "huggingface_hub.py": """
def list_repo_files(repo): return ['m.Q2_K.gguf', 'm.Q4_K_M.gguf']
def hf_hub_download(repo_id, filename, local_dir): return local_dir + '/' + filename
""",
    "llama_cpp.py": """
import os
__version__ = '9.9.9-stub'
class Llama:
    def __init__(self, **kw): pass
    def tokenize(self, b, add_bos=True): return list(range(len(b) // 4))
    def create_completion(self, prompt, **kw):
        if os.environ.get('STUB_FAST_BOOM'):
            raise RuntimeError('boom mid-generation')
        if os.environ.get('STUB_EMPTY_PRIMARY'):
            return
        if os.environ.get('STUB_CODE'):
            yield {'choices': [{'text': os.environ['STUB_CODE']}]}
            return
        for word in ['FAST', ' ANSWER']:
            yield {'choices': [{'text': word}]}
""",
}


def embedded_script():
    text = WORKFLOW.read_text(encoding="utf-8")
    match = re.search(r"python - <<'PY'\n(.*?)\n\s+PY\n", text, re.S)
    assert match, "could not find the embedded python in deepseek-16b.yml"
    return textwrap.dedent(match.group(1))


def run(extra_env=None, drop_stubs=()):
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="ds-engine-"))
    try:
        stubs = tmp / "stubs"
        stubs.mkdir()
        for name, body in STUBS.items():
            if name not in drop_stubs:
                (stubs / name).write_text(body, encoding="utf-8")
        (tmp / ".github").mkdir()
        shutil.copytree(HERE, tmp / ".github" / "scripts", ignore=shutil.ignore_patterns("__pycache__"))
        (tmp / "run.py").write_text(embedded_script(), encoding="utf-8")
        env = {
            "PATH": os.environ.get("PATH", ""),
            "HOME": str(tmp / "home"),
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONPATH": str(stubs),
            "TASK": "What is two plus two?",
            "CONTEXT": "",
            "INVOCATION_ID": "deepseek-test-1",
        }
        env.update(extra_env or {})
        proc = subprocess.run([sys.executable, "-B", "run.py"], cwd=tmp, env=env, capture_output=True, text=True, timeout=120)
        result = (tmp / "result.txt").read_text(encoding="utf-8") if (tmp / "result.txt").exists() else None
        meta = (tmp / "result_meta.txt").read_text(encoding="utf-8") if (tmp / "result_meta.txt").exists() else None
        return proc, result, meta
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


class EngineSelection(unittest.TestCase):
    def test_fast_engine_answers_and_metadata_says_so(self):
        proc, result, meta = run()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(result, "FAST ANSWER")
        self.assertIn("engine=llama.cpp GGUF Q4_K_M", meta)
        self.assertIn("m.Q4_K_M.gguf", meta)
        self.assertIn("generated_tokens=2", meta)
        self.assertIn("stopped_by_time_budget=false", meta)
        self.assertIn("llama_cpp_python=9.9.9-stub", meta)
        self.assertIn("model=Qwen/Qwen3-8B", meta)
        self.assertIn("degraded=false", meta)

    def test_missing_fast_engine_uses_the_labelled_fallback_model_and_says_why(self):
        proc, result, meta = run(drop_stubs=("llama_cpp.py",))
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("SLOW ANSWER", result)
        self.assertIn("DEGRADED ANSWER", result)
        self.assertIn("model=deepseek-ai/deepseek-coder-1.3b-instruct", meta)
        self.assertIn("engine=transformers float16 (slow fallback: deepseek-ai/deepseek-coder-1.3b-instruct)", meta)
        self.assertIn("fast_engine_error=ModuleNotFoundError", meta)
        self.assertIn("needs the GGUF engine", proc.stdout)

    def test_fast_failure_mid_generation_falls_back_not_crashes(self):
        proc, result, meta = run({"STUB_FAST_BOOM": "1"})
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("SLOW ANSWER", result)
        self.assertIn("DEGRADED ANSWER", result)
        self.assertIn("slow fallback", meta)
        self.assertIn("boom mid-generation", meta)

    def test_empty_primary_falls_back_to_transformers(self):
        proc, result, meta = run({"STUB_EMPTY_PRIMARY": "1"})
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("SLOW ANSWER", result)
        self.assertIn("DEGRADED ANSWER", result)
        self.assertIn("empty response", meta)
        self.assertIn("model=deepseek-ai/deepseek-coder-1.3b-instruct", meta)

    def test_forced_slow_engine_uses_the_fallback_model_honestly(self):
        proc, result, meta = run({"DEEPSEEK_ENGINE": "hf"})
        self.assertIn("SLOW ANSWER", result)
        self.assertIn("degraded=true", meta)
        self.assertIn("fast_engine_error=not attempted", meta)

    def test_code_profile_keeps_indentation_verbatim(self):
        code = "```ts\nexport function f() {\n  if (x) {\n    return 1\n  }\n}\n```"
        proc, result, meta = run({"PROFILE": "code", "TASK": "edit", "STUB_CODE": code})
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(result, code)
        self.assertIn("output_cleanup_applied=false", meta)

    def test_site_profile_raises_the_output_budget_and_skips_the_tool_protocol(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("MAX_NEW_TOKENS = 3000 if LONG_OUTPUT else 768", workflow)
        self.assertIn("FAST_TIME_BUDGET_S = 900 if LONG_OUTPUT else 420", workflow)
        self.assertIn("LONG_OUTPUT = SITE or CODE", workflow)
        self.assertIn("repeat_penalty=1.1 if SITE else 1.0", workflow)
        proc, result, meta = run({"PROFILE": "site", "TASK": "Write a complete single-file website"})
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(result, "FAST ANSWER")

    def test_the_slow_engine_is_time_bounded(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("max_time=600", workflow)
        self.assertIn("temperature=0.6", workflow)
        self.assertIn("top_p=0.9", workflow)


if __name__ == "__main__":
    unittest.main()
