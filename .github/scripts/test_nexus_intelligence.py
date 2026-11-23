import sys
import re
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import nexus_intelligence as runner  # noqa: E402


class NexusGenerationBudgetTests(unittest.TestCase):
    @staticmethod
    def encode(text):
        return re.findall(r"\S+", text)

    @staticmethod
    def decode(tokens):
        return " ".join(tokens)

    def test_actual_417_token_prompt_is_not_trimmed_to_reserve_256_output_tokens(self):
        # BOS + frame + 414 prompt tokens = 417. The decoder should receive the remaining 223.
        task = " ".join(["topic"] * 414)
        kept_task, kept_prefix, ids, trimmed = runner.prepare_generation_context(
            task, "", "create", 640, self.encode, self.decode
        )
        self.assertEqual(runner.MAX_NEW, 256)
        self.assertEqual(kept_task, task)
        self.assertEqual(kept_prefix, "")
        self.assertEqual(len(ids), 417)
        self.assertFalse(trimmed)
        self.assertEqual(runner.generation_budget(ctx_limit=640, prompt_tokens=len(ids)), 223)

    def test_only_input_that_exceeds_context_is_trimmed(self):
        task = "first line\n" + " ".join(["latest"] * 700)
        kept_task, _, ids, trimmed = runner.prepare_generation_context(
            task, "", "create", 640, self.encode, self.decode
        )
        self.assertTrue(trimmed)
        self.assertNotIn("first line", kept_task)
        self.assertLessEqual(len(ids), 640)
        self.assertGreaterEqual(runner.generation_budget(640, len(ids)), 0)

    def test_generation_never_exceeds_the_model_context_window(self):
        self.assertEqual(runner.generation_budget(ctx_limit=640, prompt_tokens=500), 140)
        self.assertEqual(runner.generation_budget(ctx_limit=640, prompt_tokens=640), 0)
        self.assertEqual(runner.generation_budget(ctx_limit=640, prompt_tokens=700), 0)

    def test_short_prompts_get_the_full_generation_ceiling(self):
        self.assertEqual(runner.generation_budget(ctx_limit=640, prompt_tokens=100), 256)


if __name__ == "__main__":
    unittest.main()
