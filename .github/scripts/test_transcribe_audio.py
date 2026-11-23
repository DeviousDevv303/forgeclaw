"""Run with: python -B -m unittest discover -s .github/scripts -p 'test_transcribe_audio.py'"""
import os
import tempfile
import unittest

import transcribe_audio as a


class ValidateLanguage(unittest.TestCase):
    def test_empty_means_auto_detect(self):
        self.assertIsNone(a.validate_language(""))
        self.assertIsNone(a.validate_language("  "))

    def test_accepts_two_and_three_letter_codes_case_insensitively(self):
        self.assertEqual(a.validate_language("en"), "en")
        self.assertEqual(a.validate_language("ES"), "es")
        self.assertEqual(a.validate_language("fil"), "fil")

    def test_rejects_anything_else(self):
        for bad in ["english", "e", "e1", "en-US", "../en", "en;rm -rf", "*"]:
            with self.assertRaises(a.SpecError, msg=bad):
                a.validate_language(bad)


class ReadLocalAudio(unittest.TestCase):
    def write(self, data: bytes) -> str:
        fd, path = tempfile.mkstemp()
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
        self.addCleanup(os.unlink, path)
        return path

    def test_returns_the_bytes(self):
        self.assertEqual(a.read_local_audio(self.write(b"voice")), b"voice")

    def test_rejects_an_empty_clip(self):
        with self.assertRaises(a.SpecError):
            a.read_local_audio(self.write(b""))

    def test_rejects_an_oversized_clip(self):
        with self.assertRaises(a.SpecError):
            a.read_local_audio(self.write(b"x" * (a.MAX_AUDIO_BYTES + 1)))


class FakeInfo:
    language = "es"
    duration = 11.04


class FakeModel:
    def __init__(self, texts):
        self.texts = texts
        self.calls = []

    def transcribe(self, path, language=None, beam_size=None):
        self.calls.append((path, language, beam_size))
        return [type("Seg", (), {"text": t}) for t in self.texts], FakeInfo()


class Transcribe(unittest.TestCase):
    def test_joins_segments_and_reports_the_detected_language(self):
        model = FakeModel([" hola", " mundo "])
        text, meta = a.transcribe("clip.mp4", None, lambda: model)
        self.assertEqual(text, "hola mundo")
        self.assertEqual(meta, {"language": "es", "duration_seconds": 11.0})
        self.assertEqual(model.calls, [("clip.mp4", None, 5)])

    def test_passes_an_explicit_language_through(self):
        model = FakeModel(["hello"])
        a.transcribe("clip.webm", "en", lambda: model)
        self.assertEqual(model.calls[0][1], "en")

    def test_silence_transcribes_to_empty_text(self):
        text, _ = a.transcribe("clip.wav", None, lambda: FakeModel([]))
        self.assertEqual(text, "")


class Run(unittest.TestCase):
    def test_no_attached_audio_is_a_spec_error(self):
        self.assertEqual(a.run({}), 2)
        self.assertEqual(a.run({"AUDIO_FILE": " "}), 2)

    def test_a_bad_language_is_a_spec_error_before_any_model_work(self):
        self.assertEqual(a.run({"AUDIO_FILE": __file__, "LANGUAGE": "en-US"}), 2)

    def test_a_missing_file_is_a_spec_error(self):
        self.assertEqual(a.run({"AUDIO_FILE": "/nonexistent/clip.mp4"}), 2)


if __name__ == "__main__":
    unittest.main()
