"""Run with: python -B -m unittest discover -s .github/scripts -p 'test_*.py'"""
import unittest

import channel_watch as w


def env(**over):
    base = {"SENDER_TYPE": "User", "COMMENT_ASSOCIATION": "OWNER"}
    base.update(over)
    return base


class Mentions(unittest.TestCase):
    def test_finds_each_handle_in_any_case_once_in_order(self):
        self.assertEqual(w.mentions("@Kimi and @MUSE, then @kimi again"), ["kimi", "muse"])

    def test_code_inline_code_and_quotes_do_not_count(self):
        text = "```\n@kimi\n```\nsee `@muse`\n> @chatgpt said so\nplain prose"
        self.assertEqual(w.mentions(text), [])

    def test_an_unclosed_fence_hides_the_rest(self):
        self.assertEqual(w.mentions("```\n@kimi never closed"), [])

    def test_emails_paths_and_longer_handles_do_not_count(self):
        for text in ["mail me@kimi.com", "path/@muse/x", "@claudette", "@kimi_bot", "@@kimi"]:
            self.assertEqual(w.mentions(text), [], text)

    def test_punctuation_after_a_handle_still_counts(self):
        self.assertEqual(w.mentions("thanks @Muse."), ["muse"])
        self.assertEqual(w.mentions("(@chatgpt)"), ["chatgpt"])


class Notice(unittest.TestCase):
    def test_owner_mention_gets_one_line_per_handle_and_the_marker(self):
        body = w.notice("issue_comment", env(COMMENT_BODY="@kimi and @claude, please"))
        self.assertIn("`@kimi`, `@claude` are mentions, not delivered requests.", body)
        single = w.notice("issue_comment", env(COMMENT_BODY="@muse?"))
        self.assertIn("Channel Watch: `@muse` is a mention, not a delivered request.", single)
        self.assertIn("- `@kimi` is not connected to this repository.", body)
        self.assertIn("- `@claude` starts the Claude Code workflow", body)
        self.assertNotIn("@muse", body)
        self.assertTrue(body.endswith(w.ACK_MARKER))

    def test_the_notice_itself_mentions_no_one(self):
        # claude, muse and Kimi are real GitHub accounts: a bare @handle in the notice would notify them.
        body = w.notice("issue_comment", env(COMMENT_BODY="@claude @kimi @chatgpt @muse"))
        self.assertEqual(w.mentions(body), [])

    def test_no_mention_no_notice(self):
        self.assertIsNone(w.notice("issue_comment", env(COMMENT_BODY="no handles here")))

    def test_strangers_and_bots_get_nothing(self):
        self.assertIsNone(w.notice("issue_comment", env(COMMENT_BODY="@kimi", COMMENT_ASSOCIATION="NONE")))
        self.assertIsNone(w.notice("issue_comment", env(COMMENT_BODY="@kimi", COMMENT_ASSOCIATION="CONTRIBUTOR")))
        self.assertIsNone(w.notice("issue_comment", env(COMMENT_BODY="@kimi", SENDER_TYPE="Bot")))

    def test_its_own_notice_never_triggers_another(self):
        own = w.notice("issue_comment", env(COMMENT_BODY="@kimi"))
        self.assertIsNone(w.notice("issue_comment", env(COMMENT_BODY=own)))

    def test_each_event_reads_only_its_own_text(self):
        # An empty review must not fall back to the PR description's mentions.
        self.assertIsNone(w.notice("pull_request_review", env(REVIEW_BODY="", REVIEW_ASSOCIATION="OWNER", PR_BODY="@kimi")))
        self.assertIsNotNone(w.notice("pull_request_review", env(REVIEW_BODY="@kimi", REVIEW_ASSOCIATION="OWNER")))
        self.assertIsNotNone(w.notice("issues", env(ISSUE_TEXT="title\n@muse", ISSUE_ASSOCIATION="COLLABORATOR")))
        self.assertIsNotNone(w.notice("pull_request", env(PR_BODY="@chatgpt", PR_ASSOCIATION="MEMBER")))
        self.assertIsNone(w.notice("discussion", env(COMMENT_BODY="@kimi")))


if __name__ == "__main__":
    unittest.main()
