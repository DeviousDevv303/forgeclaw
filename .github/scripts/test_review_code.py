"""Run with: python -B -m unittest discover -s .github/scripts -p 'test_*.py'"""
import unittest

import review_code as r


class Validate(unittest.TestCase):
    def test_defaults_the_language(self):
        self.assertEqual(r.validate("x = 1", ""), ("x = 1", "typescript"))

    def test_rejects_empty_and_oversized_code(self):
        for bad in ["", "   \n"]:
            with self.assertRaises(r.SpecError):
                r.validate(bad, "python")
        with self.assertRaises(r.SpecError):
            r.validate("x" * (r.MAX_CODE_CHARS + 1), "python")

    def test_rejects_a_language_that_could_inject_into_the_prompt_or_shell(self):
        for bad in ["python; rm -rf /", "py thon", "a" * 31, "```", "$(id)"]:
            with self.assertRaises(r.SpecError, msg=bad):
                r.validate("x", bad)

    def test_accepts_common_language_names(self):
        for ok in ["typescript", "c++", "c#", "objective-c", "python3.11", "f#"]:
            self.assertEqual(r.validate("x", ok)[1], ok)


class Prompt(unittest.TestCase):
    def test_uses_the_deepseek_coder_instruct_shape_and_fences_the_code(self):
        p = r.build_prompt("def f(): pass", "python")
        self.assertIn("### Instruction:\nReview this python code.", p)
        self.assertIn("```python\ndef f(): pass\n```", p)
        self.assertTrue(p.endswith("### Response:\n"))


class Run(unittest.TestCase):
    def test_bad_input_exits_2_without_loading_a_model(self):
        self.assertEqual(r.run({"CODE": "", "REVIEW_LANGUAGE": "python"}), 2)

    def test_missing_engine_exits_1_with_an_annotation_not_a_crash(self):
        self.assertEqual(r.run({"CODE": "x=1", "REVIEW_LANGUAGE": "python"}), 1)


class Constants(unittest.TestCase):
    def test_the_context_budget_leaves_room_for_the_answer(self):
        self.assertLess(r.MAX_NEW_TOKENS + 16, 4096)
        self.assertEqual(r.QUANT, "q4_k_m")


if __name__ == "__main__":
    unittest.main()
