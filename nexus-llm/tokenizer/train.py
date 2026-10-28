"""NEXUS Intelligence step 2: train the tokenizer on tokenizer/corpus.synthetic.txt (SYNTHETIC: schemas + synthetic traces).

Run (from repo root, with sentencepiece installed in a venv outside the repo):
    python nexus-llm/tokenizer/train.py
The grammar's special tokens are registered as user_defined_symbols, so each is one atomic piece that no merge can split.
v1: every tool name in the snapshot is also a user_defined_symbol, so choosing a tool is one token, not ~6. The list is
CUSTODY.json atomicToolNames (written by gen-synthetic-corpus.ts from the snapshot); a tool added later still encodes, as pieces,
and test_tokenizer.py fails until the tokenizer is retrained.
The output model inherits synthetic:true (see CUSTODY.json). It is a v0 and must be retrained once admitted data exists.
"""
import json
import pathlib
import sentencepiece as spm

HERE = pathlib.Path(__file__).resolve().parent
SPECIAL = json.loads((HERE.parent / "spec" / "special-tokens.json").read_text())
TOOL_NAMES = json.loads((HERE / "CUSTODY.json").read_text())["atomicToolNames"]
VOCAB_SIZE = 4000

spm.SentencePieceTrainer.train(
    input=str(HERE / "corpus.synthetic.txt"),
    model_prefix=str(HERE / "nexus"),
    model_type="bpe",
    vocab_size=VOCAB_SIZE,
    character_coverage=1.0,
    byte_fallback=True,
    user_defined_symbols=SPECIAL + TOOL_NAMES,
    hard_vocab_limit=False,
    split_digits=True,
    normalization_rule_name="identity",
    remove_extra_whitespaces=False,
    add_dummy_prefix=False,
    pad_id=0, unk_id=1, bos_id=2, eos_id=3,
    seed_sentencepiece_size=1000000,
    num_threads=4,
)
print("trained", HERE / "nexus.model")
