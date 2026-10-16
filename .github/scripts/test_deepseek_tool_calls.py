"""Run with: python -m unittest discover -s .github/scripts -p 'test_*.py'"""
import unittest

from deepseek_tool_calls import normalize_tool_call_output as norm


class NormalizeToolCallOutput(unittest.TestCase):
    def test_plain_text_is_unchanged(self):
        self.assertEqual(norm('Just an answer.'), ('Just an answer.', False))

    def test_fenced_call_with_fabricated_aftermath_is_cut(self):
        text = ('To find the weather I will read a page.\n```tool_call\n'
                '{"name": "github_read_file", "arguments": {"path": "a.md"}}\n```\n'
                'After executing the structured tool call, I found it will be 68F.')
        out, dropped = norm(text)
        self.assertTrue(dropped)
        self.assertNotIn('68F', out)
        self.assertTrue(out.endswith('```'))
        self.assertIn('"name": "github_read_file"', out)

    def test_observed_bare_tool_call_in_plain_fence(self):
        text = ('Structured tool call:\n```\ntool_call{\n "name": "aerospace_engineering_search_tool",\n'
                ' "arguments": {"search_query": "leading edge erosion"}\n}\n```\n'
                '(output: leading edge erosion in aerospace engineering)')
        out, dropped = norm(text)
        self.assertTrue(dropped)
        self.assertNotIn('(output:', out)
        self.assertIn('```tool_call\n{"name": "aerospace_engineering_search_tool"', out)
        self.assertEqual(out.count('```'), 2)

    def test_call_with_nothing_after_it_is_not_flagged(self):
        out, dropped = norm('```tool_call\n{"name":"shell_exec","arguments":{"command":"ls -la"}}\n```')
        self.assertFalse(dropped)
        self.assertIn('"command": "ls -la"', out)

    def test_input_key_is_accepted_and_non_dict_arguments_become_empty(self):
        self.assertIn('"path": "x"', norm('tool_call{"name":"a","input":{"path":"x"}}')[0])
        self.assertIn('"arguments": {}', norm('tool_call{"name":"a","arguments":"oops"}')[0])

    def test_malformed_or_nameless_json_is_left_alone(self):
        for text in ('tool_call{not json', 'tool_call{"arguments":{}}', 'tool_call{"name":""}'):
            self.assertEqual(norm(text), (text, False))


if __name__ == '__main__':
    unittest.main()
