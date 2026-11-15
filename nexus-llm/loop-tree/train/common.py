"""Shared by train.py and predict.py: the text frame, tokenization and the loss mask.
The frame is ordinary text plus, since run 8, one harness-presented mode token: <|mode:copy|> when the task's
work is carrying prompt material verbatim into a call, <|mode:create|> when it is composing. The mode token is
part of the frame, so it is context the model conditions on, never a token it is trained to emit."""
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
MODE_TOKEN = {"copy": "<|mode:copy|>", "create": "<|mode:create|>"}
# Run 8's one free parameter: tokens inside a copied span of a COPY row count this much in the loss.
COPY_LOSS_WEIGHT = 2.0


def frame(prompt: str, mode: str | None = None) -> str:
    if mode is None:
        return f"User: {prompt}\n"
    return f"User: {prompt}\n{MODE_TOKEN[mode]}"


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


_SURFACE: dict[int, str] = {}


def _surface(tid: int) -> str:
    s = _SURFACE.get(tid)
    if s is None:
        s = _SURFACE[tid] = SP.decode([tid])
    return s


def encode_row_w(prompt: str, text: str, mode: str | None = None, copy_spans=(), copy_weight: float = COPY_LOSS_WEIGHT):
    """encode_row plus a per-token loss weight: mask where masked, 1.0 where trained, copy_weight on trained tokens
    whose characters fall inside one of copy_spans. A span is an argument value the generator verified appears
    verbatim in the prompt; it is located in the transcript at its first occurrence at or after <|call|> (the call
    region — a value quoted again in the answer is not re-weighted). Character offsets come from the piece
    surfaces; if they do not reconstruct the text exactly, the row falls back to unweighted rather than guess."""
    f_ids, t_ids = SP.encode(frame(prompt, mode)), SP.encode(text)
    ids = [BOS] + f_ids + t_ids
    mask = [0] * (1 + len(f_ids))
    inside = False
    for tid in t_ids:
        if tid in RESULT_OPEN:
            inside = True
        mask.append(0 if inside else 1)
        if tid == RESULT_CLOSE:
            inside = False
    weights = [float(m) for m in mask]
    if copy_spans:
        # Character span of each text token, from its decoded surface (exact for subwords, specials and byte
        # pieces alike; cached per token id — the vocab is only a few thousand).
        spans, pos = [], 0
        for tid in t_ids:
            surface = _surface(tid)
            spans.append((pos, pos + len(surface)))
            pos += len(surface)
        if pos == len(text):
            call_at = text.find("<|call|>")
            base = 1 + len(f_ids)
            for span in copy_spans:
                start = text.find(span, call_at if call_at >= 0 else 0)
                if start < 0:
                    continue
                end = start + len(span)
                for k, (a, b) in enumerate(spans):
                    if mask[base + k] and a < end and start < b:
                        weights[base + k] = copy_weight
    return ids, mask, weights


def read_jsonl(path):
    return [json.loads(l) for l in pathlib.Path(path).read_text().splitlines() if l.strip()]
