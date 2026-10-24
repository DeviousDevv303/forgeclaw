"""Run with: python -B -m unittest discover -s .github/scripts -p 'test_*.py'

claude.yml structure checks (text only: no YAML dependency, and no run of the action, which needs a live key).

2026-10-23: every @claude mention failed after 0 s with "API Error: 400 This API key is not scoped to a workspace".
The credential-check step sent the workspace header, the interactive action step did not, and the other two action
steps (claude-automation, claude-fix) did. A step that calls the action must carry the header too."""
import re
import unittest
from pathlib import Path

CLAUDE_YML = Path(__file__).resolve().parents[1] / "workflows" / "claude.yml"
HEADER = re.compile(r"ANTHROPIC_CUSTOM_HEADERS:\s*\|\s*\n\s*anthropic-workspace-id:\s*\$\{\{\s*secrets\.ANTHROPICWORKSPACEID\s*\}\}")


def steps():
    """claude.yml's steps as (name, text), split at each `- name:` line."""
    text = CLAUDE_YML.read_text()
    parts = re.split(r"^      - name: ", text, flags=re.MULTILINE)[1:]
    return [(part.split("\n", 1)[0].strip(), part) for part in parts]


class EveryActionStepSendsTheWorkspaceHeader(unittest.TestCase):
    def test_there_are_three_action_steps(self):
        calls = [name for name, text in steps() if "uses: anthropics/claude-code-action" in text]
        self.assertEqual(calls, ["Run Claude Code", "Run Claude Code automation", calls[2]])

    def test_each_one_sets_the_header_from_the_workspace_secret(self):
        for name, text in steps():
            if "uses: anthropics/claude-code-action" in text:
                self.assertRegex(text, HEADER, f"step '{name}' calls the action without the workspace header")

    def test_the_interactive_job_is_the_one_that_was_missing_it(self):
        interactive = dict(steps())["Run Claude Code"]
        self.assertRegex(interactive, HEADER)


if __name__ == "__main__":
    unittest.main()
