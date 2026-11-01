"""Run with: python -B -m unittest discover -s .github/scripts -p 'test_*.py'"""
import unittest

import deepseek_gguf as g


class PickFile(unittest.TestCase):
    def test_picks_q4_k_m_case_insensitively(self):
        files = ["README.md", "deepseek-llm-7b-chat.Q2_K.gguf", "deepseek-llm-7b-chat.Q4_K_M.gguf", "deepseek-llm-7b-chat.Q8_0.gguf"]
        self.assertEqual(g.pick_gguf_file(files), "deepseek-llm-7b-chat.Q4_K_M.gguf")

    def test_none_when_the_quant_is_absent(self):
        self.assertIsNone(g.pick_gguf_file(["a.Q2_K.gguf", "b.Q8_0.gguf"]))

    def test_ignores_non_gguf_files_with_the_quant_in_the_name(self):
        self.assertIsNone(g.pick_gguf_file(["notes-q4_k_m.txt"]))

    def test_shortest_name_wins_a_tie(self):
        self.assertEqual(g.pick_gguf_file(["x-q4_k_m-extra.gguf", "x-q4_k_m.gguf"]), "x-q4_k_m.gguf")


class Prompt(unittest.TestCase):
    def test_qwen_chatml_with_thinking_switched_off(self):
        p = g.build_prompt("SYS", "Task: hi")
        self.assertTrue(p.startswith("<|im_start|>system\nSYS<|im_end|>\n<|im_start|>user\nTask: hi<|im_end|>\n"))
        self.assertTrue(p.endswith("<|im_start|>assistant\n<think>\n\n</think>\n\n"))

    def test_no_empty_system_turn(self):
        self.assertTrue(g.build_prompt("  ", "hi").startswith("<|im_start|>user\nhi"))

    def test_primary_is_the_official_qwen3_8b_gguf(self):
        self.assertEqual(g.GGUF_REPO, "Qwen/Qwen3-8B-GGUF")
        self.assertEqual(g.pick_gguf_file(["Qwen3-8B-Q4_K_M.gguf", "Qwen3-8B-Q8_0.gguf"]), "Qwen3-8B-Q4_K_M.gguf")
        self.assertIn("<|im_end|>", g.STOP)


class Fit(unittest.TestCase):
    count = staticmethod(lambda s: len(s) // 4)

    def test_short_text_is_untouched(self):
        self.assertEqual(g.fit_text("abc", self.count, 100), ("abc", False))

    def test_long_text_is_trimmed_in_the_middle_and_fits(self):
        text = "HEAD" + "x" * 40000 + "TAIL"
        out, trimmed = g.fit_text(text, self.count, 1000)
        self.assertTrue(trimmed)
        self.assertLessEqual(self.count(out), 1000)
        self.assertTrue(out.startswith("HEAD"))
        self.assertTrue(out.endswith("TAIL"))
        self.assertIn("context trimmed", out)


def stream_of(n):
    for i in range(n):
        yield {"choices": [{"text": f"t{i} "}]}


class Generate(unittest.TestCase):
    def test_runs_to_the_end_of_the_stream(self):
        text, tokens, _, timed_out = g.generate(stream_of(3), 100, 60)
        self.assertEqual((text, tokens, timed_out), ("t0 t1 t2", 3, False))

    def test_stops_at_max_new_tokens(self):
        _, tokens, _, timed_out = g.generate(stream_of(50), 5, 60)
        self.assertEqual((tokens, timed_out), (5, False))

    def test_stops_on_the_time_budget_and_says_so(self):
        ticks = iter(range(0, 1000, 10))  # every clock() call advances 10 s
        text, tokens, _, timed_out = g.generate(stream_of(50), 100, 25, clock=lambda: next(ticks))
        self.assertTrue(timed_out)
        self.assertLess(tokens, 50)
        self.assertTrue(text)


class Load(unittest.TestCase):
    def test_resolves_downloads_and_opens(self):
        calls = {}

        class FakeLlama:
            def __init__(self, **kw):
                calls["llama"] = kw

        llm, name = g.load_model(
            "/tmp/dir",
            lambda repo: ["m.Q4_K_M.gguf", "m.Q8_0.gguf"],
            lambda repo, fname, d: f"{d}/{fname}",
            FakeLlama,
        )
        self.assertEqual(name, "m.Q4_K_M.gguf")
        self.assertEqual(calls["llama"]["model_path"], "/tmp/dir/m.Q4_K_M.gguf")
        self.assertEqual(calls["llama"]["n_ctx"], 8192)
        self.assertEqual(calls["llama"]["n_gpu_layers"], 0)  # CPU unless the workflow configured a GPU runner

    def test_raises_when_no_matching_file_so_the_caller_falls_back(self):
        with self.assertRaises(RuntimeError):
            g.load_model("/tmp/d", lambda repo: ["only.Q8_0.gguf"], lambda *a: "x", object)



class SamplingSeed(unittest.TestCase):
    def test_same_id_same_seed_and_different_ids_differ(self):
        self.assertEqual(g.sampling_seed("deepseek-1-a"), g.sampling_seed("deepseek-1-a"))
        self.assertNotEqual(g.sampling_seed("deepseek-1-a"), g.sampling_seed("deepseek-1-b"))

    def test_the_seed_is_a_hash_of_the_id_not_the_id(self):
        import hashlib
        iid = "deepseek-1793488693195-vhkzhi"
        self.assertEqual(g.sampling_seed(iid), int.from_bytes(hashlib.sha256(iid.encode("utf-8")).digest()[:4], "big") % 0xFFFFFFFF)
        # sequential ids do not give sequential seeds
        self.assertNotEqual(abs(g.sampling_seed("swarm-1") - g.sampling_seed("swarm-2")), 1)

    def test_never_llama_cpps_random_sentinel(self):
        # 0xFFFFFFFF tells llama.cpp to pick a random seed, which would silently undo reproducibility.
        self.assertNotEqual(g.seed_from_digest(b"\xff\xff\xff\xff" + b"\x00" * 28), g.LLAMA_RANDOM_SEED)
        self.assertEqual(g.seed_from_digest(b"\xff\xff\xff\xff"), 0)
        self.assertEqual(g.seed_from_digest(b"\xff\xff\xff\xfe"), 0xFFFFFFFE)
        for iid in ("a", "b", "swarm-dryrun-clean-001", "x" * 500):
            self.assertTrue(0 <= g.sampling_seed(iid) < g.LLAMA_RANDOM_SEED)


if __name__ == "__main__":
    unittest.main()
