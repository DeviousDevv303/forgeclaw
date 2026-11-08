"""Tests for the NEXUS step-2 tokenizer. Run: python -m unittest nexus-llm/tokenizer/test_tokenizer.py
(sentencepiece required; not part of the repo's vitest run)."""
import json
import pathlib
import unittest

import sentencepiece as spm

HERE = pathlib.Path(__file__).resolve().parent
SP = spm.SentencePieceProcessor(model_file=str(HERE / "nexus.model"))
SPECIAL = json.loads((HERE.parent / "spec" / "special-tokens.json").read_text())
LINES = (HERE / "corpus.synthetic.txt").read_text().splitlines()
CUSTODY = json.loads((HERE / "CUSTODY.json").read_text())


class SpecialTokens(unittest.TestCase):
    def test_there_are_twenty(self):
        # 18 transcript tokens + the run-8 frame-side mode tokens (<|mode:copy|>, <|mode:create|>):
        # harness-presented control tokens, never emitted inside a transcript.
        self.assertEqual(len(SPECIAL), 20)
        self.assertEqual(len(set(SPECIAL)), 20)

    def test_each_is_exactly_one_piece_with_its_own_id(self):
        ids = set()
        for tok in SPECIAL:
            enc = SP.encode(tok)
            self.assertEqual(len(enc), 1, tok)
            self.assertEqual(SP.id_to_piece(enc[0]), tok)
            ids.add(enc[0])
        self.assertEqual(len(ids), len(SPECIAL))

    def test_no_merge_ever_spans_a_token_boundary(self):
        # Any piece that touches the delimiter characters must be a whole special token.
        bad = []
        for line in LINES:
            for piece in SP.encode(line, out_type=str):
                if ("<|" in piece or "|>" in piece) and piece not in SPECIAL:
                    bad.append(piece)
        self.assertEqual(bad, [])

    def test_every_token_in_a_transcript_survives_as_one_piece(self):
        for line in (l for l in LINES if l.startswith("<|route:")):
            expected = [t for t in _tokens_in(line)]
            got = [p for p in SP.encode(line, out_type=str) if p in SPECIAL]
            self.assertEqual(got, expected)


class ToolNames(unittest.TestCase):
    """v1: choosing a tool is one token. Fails when the snapshot gains a tool the tokenizer was not retrained for."""
    def test_every_snapshot_tool_name_is_one_piece(self):
        tools = json.loads((HERE.parent / "spec" / "tools.snapshot.json").read_text())["tools"]
        self.assertEqual(sorted(t["name"] for t in tools), sorted(CUSTODY["atomicToolNames"]))
        for t in tools:
            self.assertEqual(SP.encode(t["name"], out_type=str), [t["name"]], t["name"])

    def test_a_tool_name_inside_a_longer_word_still_round_trips(self):
        for s in ["web_searching", "my_github_read_file_note", "kalshi_marketsx"]:
            self.assertEqual(SP.decode(SP.encode(s)), s)


class RoundTrip(unittest.TestCase):
    def test_every_corpus_line_decodes_to_itself(self):
        for line in LINES:
            self.assertEqual(SP.decode(SP.encode(line)), line)

    def test_unseen_text_is_lossless_through_byte_fallback(self):
        for s in ["", "héllo wörld", "日本語のテキスト", "emoji \U0001F680 ok", "tab\there\nnewline", '{"path":"/a/b.ts","n":12345}']:
            self.assertEqual(SP.decode(SP.encode(s)), s)


class Hazards(unittest.TestCase):
    def test_a_token_typed_into_free_text_IS_tokenised_as_the_special_token(self):
        # Documents the hazard: the tokenizer cannot tell structure from text. grammar.ts rejects such text at encode
        # time and the strict parser treats it as structure; any runtime that tokenizes raw user text must refuse or escape it.
        self.assertEqual(SP.encode("<|ev:verified|>", out_type=str), ["<|ev:verified|>"])


class Custody(unittest.TestCase):
    def test_the_training_text_is_labelled_synthetic_and_matches_its_hash(self):
        import hashlib
        self.assertTrue(CUSTODY["synthetic"])
        self.assertEqual(hashlib.sha256((HERE / "corpus.synthetic.txt").read_bytes()).hexdigest(), CUSTODY["corpusSha256"])
        self.assertIn("admitted corpus candidates", CUSTODY["excludes"])
        self.assertIn("operator data", CUSTODY["excludes"])
        self.assertEqual(CUSTODY["version"], "v1")


def _tokens_in(line):
    import re
    return re.findall(r"<\|/?[a-z_]+(?::[a-z_]+)?\|>", line)


if __name__ == "__main__":
    unittest.main()
