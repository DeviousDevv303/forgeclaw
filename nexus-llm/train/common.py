"""Shared by train.py and predict.py: the text frame, tokenization and the loss mask. The frame is ordinary text (no new special token)."""
import json
import pathlib

import sentencepiece as spm

HERE = pathlib.Path(__file__).resolve().parent
SP = spm.SentencePieceProcessor(model_file=str(HERE.parent / "tokenizer" / "nexus.model"))
BOS, EOS = 2, 3
RESULT_OPEN = {SP.piece_to_id("<|result:ok|>"), SP.piece_to_id("<|result:error|>")}
RESULT_CLOSE = SP.piece_to_id("<|/result|>")
END = SP.piece_to_id("<|end|>")
CALL_CLOSE = SP.piece_to_id("<|/call|>")


def frame(prompt: str) -> str:
    return f"User: {prompt}\n"


def encode_row(prompt: str, text: str):
    """ids = BOS + frame + transcript. mask[i] = 1 where the MODEL emits token i. Masked: BOS, the frame, and every
    runtime-injected result span (opener through closer), because the runtime, not the model, writes those."""
    f_ids, t_ids = SP.encode(frame(prompt)), SP.encode(text)
    ids = [BOS] + f_ids + t_ids
    mask = [0] * (1 + len(f_ids))
    inside = False
    for tid in t_ids:
        if tid in RESULT_OPEN:
            inside = True
        mask.append(0 if inside else 1)
        if tid == RESULT_CLOSE:
            inside = False
    return ids, mask


def read_jsonl(path):
    return [json.loads(l) for l in pathlib.Path(path).read_text().splitlines() if l.strip()]
