import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import nexus_intelligence as runner  # noqa: E402


class NexusGenerationBudgetTests(unittest.TestCase):
    def test_screenshot_prompt_gets_remaining_context_after_the_old_160_token_cap(self):
        # The reported run used 417 prompt tokens and exhausted its 160-token ceiling
        # inside a tool call. With the larger reserve, it can use all remaining context.
        self.assertEqual(runner.MAX_NEW, 256)
        self.assertEqual(runner.generation_budget(ctx_limit=640, prompt_tokens=417), 223)

    def test_generation_never_exceeds_the_model_context_window(self):
        self.assertEqual(runner.generation_budget(ctx_limit=640, prompt_tokens=500), 140)
        self.assertEqual(runner.generation_budget(ctx_limit=640, prompt_tokens=640), 0)
        self.assertEqual(runner.generation_budget(ctx_limit=640, prompt_tokens=700), 0)

    def test_short_prompts_get_the_full_generation_ceiling(self):
        self.assertEqual(runner.generation_budget(ctx_limit=640, prompt_tokens=100), 256)


if __name__ == "__main__":
    unittest.main()
