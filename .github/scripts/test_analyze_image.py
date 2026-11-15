"""Run with: python -B -m unittest discover -s .github/scripts -p 'test_*.py'"""
import unittest

import analyze_image as a


class Validate(unittest.TestCase):
    def test_accepts_a_public_https_image_and_defaults_the_prompt(self):
        self.assertEqual(a.validate("https://raw.githubusercontent.com/x/y/z.png", ""), ("https://raw.githubusercontent.com/x/y/z.png", "Describe this image in detail."))

    def test_rejects_non_https_and_non_urls(self):
        for bad in ["http://example.com/a.png", "file:///etc/passwd", "ftp://x/y", "not a url", "", "javascript:alert(1)"]:
            with self.assertRaises(a.SpecError, msg=bad):
                a.validate(bad, "x")

    def test_rejects_credentials_and_local_or_numeric_hosts(self):
        for bad in ["https://user:pw@example.com/a.png", "https://localhost/a.png", "https://printer.local/a.png",
                    "https://metadata.internal/x", "https://169.254.169.254/latest/meta-data", "https://127.0.0.1/a.png"]:
            with self.assertRaises(a.SpecError, msg=bad):
                a.validate(bad, "x")

    def test_rejects_an_oversized_prompt(self):
        with self.assertRaises(a.SpecError):
            a.validate("https://example.com/a.png", "x" * (a.MAX_PROMPT_CHARS + 1))


class Fetch(unittest.TestCase):
    class Resp:
        def __init__(self, chunks):
            self.chunks = chunks

        def raise_for_status(self):
            pass

        def iter_content(self, n):
            yield from self.chunks

    def test_returns_the_bytes(self):
        self.assertEqual(a.fetch_image_bytes("https://x/y", lambda *k, **kw: self.Resp([b"ab", b"cd"])), b"abcd")

    def test_enforces_the_size_cap_and_passes_a_timeout(self):
        seen = {}

        def get(url, **kw):
            seen.update(kw)
            return self.Resp([b"x" * (a.MAX_IMAGE_BYTES // 2 + 1)] * 2)

        with self.assertRaises(a.SpecError):
            a.fetch_image_bytes("https://x/y", get)
        self.assertEqual(seen["timeout"], a.FETCH_TIMEOUT_S)


class Echo(unittest.TestCase):
    def test_strips_a_transcript_down_to_the_assistant_turn(self):
        self.assertEqual(a.strip_prompt_echo("system\nYou are..\nuser\nDescribe\nassistant\nA red fox."), "A red fox.")

    def test_leaves_a_clean_answer_alone(self):
        self.assertEqual(a.strip_prompt_echo("  A red fox.  "), "A red fox.")


class LocalImage(unittest.TestCase):
    def test_reads_an_attached_file_and_enforces_the_cap(self):
        import os
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "img")
            with open(path, "wb") as handle:
                handle.write(b"\xff\xd8jpeg")
            self.assertEqual(a.read_local_image(path), b"\xff\xd8jpeg")
            with open(path, "wb") as handle:
                handle.write(b"")
            with self.assertRaises(a.SpecError):
                a.read_local_image(path)
            with open(path, "wb") as handle:
                handle.write(b"x" * (a.MAX_IMAGE_BYTES + 1))
            with self.assertRaises(a.SpecError):
                a.read_local_image(path)


class Run(unittest.TestCase):
    def test_a_bad_request_exits_2_without_importing_torch(self):
        self.assertEqual(a.run({"IMAGE_URL": "http://insecure/x.png", "PROMPT": "p"}), 2)

    def test_missing_ml_libraries_exit_1_not_a_crash(self):
        # torch / transformers are not installed in the test environment: the failure must be reported, not raised.
        self.assertEqual(a.run({"IMAGE_URL": "https://example.com/a.png", "PROMPT": "p"}), 1)

    def test_an_attached_file_needs_no_url_but_still_bounds_the_prompt(self):
        self.assertEqual(a.run({"IMAGE_FILE": "/nonexistent", "PROMPT": "x" * (a.MAX_PROMPT_CHARS + 1)}), 2)
        self.assertEqual(a.run({"IMAGE_FILE": "/nonexistent", "PROMPT": "what is this?"}), 1)


if __name__ == "__main__":
    unittest.main()
