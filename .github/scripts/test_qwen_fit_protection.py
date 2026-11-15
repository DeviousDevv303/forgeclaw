"""Run with: python -B -m unittest discover -s .github/scripts -p 'test_*.py'

The prompt-fit protection (set the NEXUS guidance and conversation blocks aside before
qwen_gguf.fit_text middle-cuts an over-long prompt, then restore them) lives inline in
qwen3-8b.yml's embedded python — it is not importable. These tests extract that exact block
from the workflow (the same heredoc extraction scripts/checkQwenWorkflow.mjs validates) and
run it against the real qwen_gguf.fit_text, so the shipped text is what is tested.
"""
import unittest
from pathlib import Path

import qwen_gguf

WORKFLOW = Path(__file__).resolve().parent.parent / 'workflows' / 'qwen3-8b.yml'
BEGIN = 'NEXUS guidance protection (begin)'
END = 'NEXUS guidance protection (end)'


def load_protection():
    workflow = WORKFLOW.read_text(encoding='utf-8')
    start_marker = "          python - <<'PY'\n"
    end_marker = '\n          PY\n'
    start = workflow.index(start_marker) + len(start_marker)
    end = workflow.index(end_marker, start)
    embedded = '\n'.join(
        line[10:] if line.startswith('          ') else line
        for line in workflow[start:end].split('\n')
    )
    begin = embedded.rindex('\n', 0, embedded.index(BEGIN)) + 1
    block = embedded[begin:embedded.index(END)]
    namespace = {'qwen_gguf': qwen_gguf}
    exec(block, namespace)
    return namespace


FIT = load_protection()
fit_keeping_guidance = FIT['fit_keeping_guidance']
count = staticmethod(lambda s: len(s))

GUIDANCE = 'NEXUS GUIDANCE (owner)\n' + 'g' * 200 + '\n[END NEXUS GUIDANCE]'
CONVERSATION = '[CONVERSATION_SO_FAR]\n' + 'c' * 800 + '\n[/CONVERSATION_SO_FAR]'


def long_prompt():
    # Both protected blocks sit in the middle, where fit_text's cut lands.
    return 'Task intro. ' + 'x' * 4000 + GUIDANCE + 'y' * 4000 + CONVERSATION + 'z' * 4000 + ' Answer now.'


class FitKeepingGuidance(unittest.TestCase):
    def test_prompt_that_fits_is_untouched_and_both_blocks_kept(self):
        prompt = 'Task intro. ' + GUIDANCE + '\n\n' + CONVERSATION + ' Answer now.'
        fitted, trimmed, guidance, conversation = fit_keeping_guidance(prompt, count, 100_000)
        self.assertEqual(fitted, prompt)
        self.assertFalse(trimmed)
        self.assertEqual(guidance, 'kept')
        self.assertEqual(conversation, 'kept')

    def test_middle_cut_cannot_shred_either_block(self):
        fitted, trimmed, guidance, conversation = fit_keeping_guidance(long_prompt(), count, 3000)
        self.assertTrue(trimmed)
        self.assertIn(GUIDANCE, fitted)
        self.assertIn(CONVERSATION, fitted)
        self.assertEqual(guidance, 'kept')
        self.assertEqual(conversation, 'kept')
        self.assertLessEqual(count(fitted), 3000)

    def test_conversation_alone_is_protected_too(self):
        prompt = 'Task intro. ' + 'x' * 6000 + CONVERSATION + 'z' * 6000 + ' Answer now.'
        fitted, trimmed, guidance, conversation = fit_keeping_guidance(prompt, count, 3000)
        self.assertTrue(trimmed)
        self.assertIn(CONVERSATION, fitted)
        self.assertEqual(guidance, 'none')
        self.assertEqual(conversation, 'kept')

    def test_no_blocks_is_a_plain_fit(self):
        prompt = 'x' * 9000
        fitted, trimmed, guidance, conversation = fit_keeping_guidance(prompt, count, 3000)
        self.assertTrue(trimmed)
        self.assertEqual(guidance, 'none')
        self.assertEqual(conversation, 'none')
        self.assertLessEqual(count(fitted), 3000)


if __name__ == '__main__':
    unittest.main()
