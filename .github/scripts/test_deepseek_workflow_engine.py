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
        import json as _json
        with open('stub_calls.jsonl', 'a') as _f:
            _f.write(_json.dumps({'seed': kw.get('seed'), 'repeat_penalty': kw.get('repeat_penalty')}) + '\\n')
        if os.environ.get('STUB_FAST_BOOM'):
            raise RuntimeError('boom mid-generation')
        if os.environ.get('STUB_EMPTY_PRIMARY'):
            return
        if os.environ.get('STUB_CODE'):
            yield {'choices': [{'text': os.environ['STUB_CODE']}]}
            return
        if os.environ.get('STUB_REFUSE_FIRST') and not os.path.exists('.stub_refused'):
            open('.stub_refused', 'w').write('1')
            yield {'choices': [{'text': 'I am not equipped to engage in philosophical, spiritual, or creative discussions.'}]}
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
    proc, result, meta, _files = run_with_files(extra_env, drop_stubs)
    return proc, result, meta


def run_with_files(extra_env=None, drop_stubs=(), names=("prompt_final.txt",)):
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
        files = {n: (tmp / n).read_text(encoding="utf-8") if (tmp / n).exists() else None for n in names}
        return proc, result, meta, files
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
        self.assertIn("repeat_penalty=1.1,", workflow)
        self.assertNotIn("repeat_penalty=1.1 if SITE else 1.0", workflow)
        proc, result, meta = run({"PROFILE": "site", "TASK": "Write a complete single-file website"})
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(result, "FAST ANSWER")

    def test_the_slow_engine_is_time_bounded(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("max_time=600", workflow)
        self.assertIn("temperature=0.6", workflow)
        self.assertIn("top_p=0.9", workflow)
        self.assertIn("repetition_penalty=1.1", workflow)


import base64
import hashlib
import json


def meta_dict(meta):
    return dict(line.split("=", 1) for line in meta.splitlines() if "=" in line)


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def denylist(*strings):
    return base64.b64encode(json.dumps(list(strings)).encode("utf-8")).decode("ascii")


EXAM_TASK = "Who wins the fight?"
EXAM_CONTEXT = "Packet: fighter A, fighter B, pre-fight stats only."
EXAM_DENY = ("grading_key", "settled_outcome", "NEXUS GUIDANCE (", "[END NEXUS GUIDANCE]")


def exam_run(**extra):
    env = {"TASK": EXAM_TASK, "CONTEXT": EXAM_CONTEXT, "EXAM_FORBIDDEN": denylist(*EXAM_DENY)}
    env.update(extra)
    proc, result, meta, files = run_with_files(env)
    return proc, meta_dict(meta), files["prompt_final.txt"]


class ExamWiring(unittest.TestCase):
    """W1-W3 of nexus-llm/eval/swarm-wiring-design.md section 3.1, against the real embedded script."""

    def test_normal_traffic_is_untouched_by_the_exam_inputs(self):
        proc, result, meta, files = run_with_files()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        m = meta_dict(meta)
        self.assertRegex(m["context_sha256"], r"^[0-9a-f]{64}$")
        self.assertEqual(m["context_sha256_basis"], "fitted_prompt")
        self.assertEqual(m["prompt_calls"], "1")
        # no exam input: no scan result, no segments, and no prompt file to mirror (ordinary chat stays off the public branch)
        for key in ("context_check", "segment_sha256_pre", "segments"):
            self.assertNotIn(key, m)
        self.assertIsNone(files["prompt_final.txt"])

    def test_w1_hash_is_of_the_exact_mirrored_prompt(self):
        proc, m, prompt = exam_run()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIsNotNone(prompt)
        self.assertEqual(sha(prompt), m["context_sha256"])
        self.assertIn(f"Task:\n{EXAM_TASK}\n\n", prompt)
        self.assertIn(EXAM_CONTEXT, prompt)

    def test_w1_segments_are_exhaustive_and_hash_the_scaffold_only(self):
        _, m, prompt = exam_run()
        head = f"Task:\n{EXAM_TASK}\n\nVerified project, CORPUS, and tool context:\n"
        i = prompt.index(head)
        t0 = i + len("Task:\n")
        t1 = t0 + len(EXAM_TASK)
        c0 = prompt.index(EXAM_CONTEXT, i + len(head))
        c1 = c0 + len(EXAM_CONTEXT)
        pre, mid, post = prompt[:t0], prompt[t1:c0], prompt[c1:]
        self.assertEqual(pre + EXAM_TASK + mid + EXAM_CONTEXT + post, prompt)
        self.assertEqual((m["segment_sha256_pre"], m["segment_sha256_mid"], m["segment_sha256_post"]), (sha(pre), sha(mid), sha(post)))
        # the scaffold does not depend on the payload: a different task and context give the same three hashes
        _, other, _ = exam_run(TASK="A different question entirely.", CONTEXT="Totally different packet text.")
        for key in ("segment_sha256_pre", "segment_sha256_mid", "segment_sha256_post"):
            self.assertEqual(m[key], other[key], key)
        self.assertNotEqual(m["context_sha256"], other["context_sha256"])

    def test_w2_clean_prompt_scans_clean(self):
        _, m, _ = exam_run()
        self.assertEqual(m["context_check"], "clean")
        self.assertEqual(m["nexus_guidance"], "none")

    def test_w2_a_forbidden_string_fails_visibly_and_names_the_first_match(self):
        proc, m, _ = exam_run(CONTEXT="Packet text with a settled_outcome field left in.")
        self.assertEqual(proc.returncode, 0, proc.stderr)  # the run still publishes: the runner needs the evidence
        self.assertEqual(m["context_check"], "FAIL:settled_outcome")
        self.assertIn("::error title=Exam context check FAIL::", proc.stdout)

    def test_w2_an_unreadable_denylist_fails_closed(self):
        for bad in ("not base64!!", base64.b64encode(b"{}").decode(), base64.b64encode(b"[]").decode(), base64.b64encode(b'["ok", ""]').decode()):
            proc, m, _ = exam_run(EXAM_FORBIDDEN=bad)
            self.assertEqual(m["context_check"], "FAIL:exam_forbidden-unreadable", bad)
            self.assertIn("::error title=Exam denylist unreadable::", proc.stdout)

    def test_w3_the_planted_canary_trips_every_instrument(self):
        _, clean, clean_prompt = exam_run()
        proc, leak, leak_prompt = exam_run(EXAM_LEAK_CANARY="FC-CANARY-TEST-DO-NOT-SHIP")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        block = "NEXUS GUIDANCE (dry-run canary)\nFC-CANARY-TEST-DO-NOT-SHIP\n[END NEXUS GUIDANCE]"
        self.assertIn(block, leak_prompt)
        self.assertNotIn("NEXUS GUIDANCE (", clean_prompt)
        self.assertEqual(leak["nexus_guidance"], "kept")  # the workflow's own guidance protection recognises it
        self.assertTrue(leak["context_check"].startswith("FAIL:"), leak["context_check"])
        self.assertNotEqual(leak["context_sha256"], clean["context_sha256"])
        # the canary sits between the task and the context, so only the mid segment moves
        self.assertEqual(leak["segment_sha256_pre"], clean["segment_sha256_pre"])
        self.assertEqual(leak["segment_sha256_post"], clean["segment_sha256_post"])
        self.assertNotEqual(leak["segment_sha256_mid"], clean["segment_sha256_mid"])
        # and the sent context is still one contiguous substring, after the canary
        self.assertGreater(leak_prompt.index(EXAM_CONTEXT), leak_prompt.index(block))

    def test_w3_the_canary_with_no_context_keeps_the_placeholder_contiguous(self):
        _, m, prompt = exam_run(CONTEXT="", EXAM_LEAK_CANARY="FC-CANARY-X")
        self.assertIn("[END NEXUS GUIDANCE]\n\n(No additional context was supplied.)", prompt)
        self.assertIn("segment_sha256_mid", m)

    def test_canary_alone_without_a_denylist_still_mirrors_but_writes_no_scan_result(self):
        _, m, prompt = exam_run(EXAM_FORBIDDEN="", EXAM_LEAK_CANARY="FC-CANARY-Y")
        self.assertIsNotNone(prompt)
        self.assertNotIn("context_check", m)

    def test_a_creative_retry_is_visible_and_the_first_prompt_stays_the_mirrored_one(self):
        proc, result, meta, files = run_with_files({"TASK": "Write a short poem about light.", "CONTEXT": EXAM_CONTEXT,
                                                    "EXAM_FORBIDDEN": denylist(*EXAM_DENY), "STUB_REFUSE_FIRST": "1"})
        self.assertEqual(proc.returncode, 0, proc.stderr)
        m = meta_dict(meta)
        self.assertEqual(m["creative_retry_attempted"], "true")
        self.assertEqual(m["prompt_calls"], "2")
        hashes = m["prompt_sha256_all"].split(",")
        self.assertEqual(len(hashes), 2)
        self.assertNotEqual(hashes[0], hashes[1])
        self.assertEqual(m["context_sha256"], hashes[0])
        self.assertEqual(sha(files["prompt_final.txt"]), hashes[0])

    def test_the_meta_carries_the_commit_the_run_executed_at(self):
        sha40 = "ab" * 20
        _, m, _ = exam_run(GITHUB_SHA=sha40)
        self.assertEqual(m["workflow_commit"], sha40)
        _, other, _ = exam_run()
        self.assertEqual(other["workflow_commit"], "unknown")  # honest when the runner variable is absent

    def test_the_sampling_seed_comes_from_the_invocation_id(self):
        sys.path.insert(0, str(HERE))
        import deepseek_gguf as g
        def go(iid):
            proc, result, meta, files = run_with_files({"INVOCATION_ID": iid}, names=("stub_calls.jsonl",))
            calls = [json.loads(line) for line in files["stub_calls.jsonl"].splitlines()]
            return meta_dict(meta), calls, result
        m1, c1, r1 = go("deepseek-1793488693195-vhkzhi")
        m2, c2, r2 = go("deepseek-1793488693195-vhkzhi")
        m3, c3, _ = go("deepseek-1793488693196-aaaaaa")
        expected = g.sampling_seed("deepseek-1793488693195-vhkzhi")
        self.assertEqual(m1["sampling_seed"], str(expected))
        self.assertEqual([c["seed"] for c in c1], [expected])  # the engine is actually called with it, not just recorded
        self.assertEqual(m1["sampling_seed_applied"], "true")
        self.assertEqual((m1["sampling_seed"], r1), (m2["sampling_seed"], r2))  # same id, same seed
        self.assertNotEqual(m1["sampling_seed"], m3["sampling_seed"])  # different id, different seed
        self.assertEqual(c3[0]["seed"], g.sampling_seed("deepseek-1793488693196-aaaaaa"))

    def test_the_slow_fallback_says_its_answer_was_not_seeded(self):
        _, _, meta, _ = run_with_files({}, drop_stubs=("llama_cpp.py",))
        m = meta_dict(meta)
        self.assertRegex(m["sampling_seed"], r"^\d+$")
        self.assertEqual(m["sampling_seed_applied"], "false")

    def test_the_slow_fallback_labels_its_hash_basis_honestly(self):
        proc, result, meta, files = run_with_files({"EXAM_FORBIDDEN": denylist("grading_key")}, drop_stubs=("llama_cpp.py",))
        m = meta_dict(meta)
        self.assertEqual(m["context_sha256_basis"], "joined_messages")
        self.assertEqual(m["prompt_calls"], "0")
        self.assertIsNone(files["prompt_final.txt"])
        self.assertEqual(m["context_check"], "clean")


if __name__ == "__main__":
    unittest.main()
