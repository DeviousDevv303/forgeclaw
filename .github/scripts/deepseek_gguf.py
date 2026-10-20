"""CPU engine for the DeepSeek workflow (deepseek-16b.yml): llama.cpp running the official 4-bit GGUF
of the primary model, Qwen/Qwen3-8B (Apache-2.0).

2026-10-20 upgrade from deepseek-ai/deepseek-llm-7b-chat, measured on 4 CPU threads with the pinned
llama-cpp-python: the 7B chat model answered a two-step time question wrong (9:45 PM for 18:05) and
looped on one CSS selector until it ran out of tokens on a one-page site; Qwen3-8B answered 18:05 in
129 tokens and wrote the complete page in 628, at 3.3-4.1 tok/s against 4.9-5.5. Its float16 weights
(16 GB) do not fit the runner, so there is no float16 path for it: if this engine fails, the workflow
uses the small labelled fallback model instead.

Importing this module has no side effects and needs neither llama_cpp nor torch, so the pure logic
(file choice, prompt shape, fitting, time-capped generation) is unit-tested without them.
Any failure here must make the caller fall back to the transformers path; nothing in this module
should be treated as proof that the fast path worked.
"""
from __future__ import annotations

import time

GGUF_REPO = "Qwen/Qwen3-8B-GGUF"
QUANT = "q4_k_m"
# Qwen3-8B supports 32K; 8K keeps prefill time and the KV cache (~1.2 GB) reasonable on 4 CPUs while
# fitting deep-research evidence (about 5K tokens) plus the answer.
N_CTX = 8192
N_THREADS = 4         # the runner has 4 vCPUs
STOP = ["<|im_end|>", "<|im_start|>"]  # end of the assistant turn; stop a hallucinated next turn


def pick_gguf_file(files, quant=QUANT):
    """Choose the GGUF file for `quant` from a repo listing, or None. Shortest name wins on a tie."""
    wanted = quant.casefold()
    matches = [f for f in files if f.casefold().endswith(".gguf") and wanted in f.casefold()]
    return sorted(matches, key=lambda name: (len(name), name))[0] if matches else None


def build_prompt(system_text, user_text):
    """Qwen3 ChatML. The empty <think></think> block is Qwen's documented switch for non-thinking mode:
    on a CPU at ~4 tok/s a long hidden reasoning trace would cost minutes per answer."""
    system = f"<|im_start|>system\n{system_text}<|im_end|>\n" if system_text.strip() else ""
    return f"{system}<|im_start|>user\n{user_text}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"


def fit_text(text, count_tokens, budget):
    """Shrink `text` until count_tokens(text) <= budget by cutting the middle (keeps the opening
    instructions and the closing request). Returns (text, was_trimmed)."""
    if count_tokens(text) <= budget:
        return text, False
    marker = "\n[... context trimmed to fit the model window ...]\n"
    keep = len(text)
    while keep > 200:
        keep = int(keep * 0.85)
        head = text[: keep * 2 // 5]
        tail = text[len(text) - (keep - len(head)):]
        candidate = head + marker + tail
        if count_tokens(candidate) <= budget:
            return candidate, True
    return text[:200] + marker, True


def generate(stream, max_new_tokens, time_budget_s, clock=time.monotonic):
    """Consume a llama.cpp completion stream with a wall-clock cap.

    Returns (text, tokens, seconds, stopped_by_time). `stream` yields llama.cpp chunks; each chunk is
    treated as one token. On timeout the partial answer is returned and flagged, never passed off as complete.
    """
    start = clock()
    parts = []
    tokens = 0
    stopped_by_time = False
    for chunk in stream:
        parts.append(chunk["choices"][0].get("text", ""))
        tokens += 1
        if tokens >= max_new_tokens:
            break
        if clock() - start >= time_budget_s:
            stopped_by_time = True
            break
    return "".join(parts).strip(), tokens, round(clock() - start, 1), stopped_by_time


def load_model(local_dir, hf_list_files, hf_download, llama_cls, repo=GGUF_REPO, quant=QUANT):
    """Resolve the GGUF file at runtime (the exact file name is looked up, not assumed), download it
    into `local_dir` (which the workflow caches), and open it. Raises on any problem."""
    name = pick_gguf_file(hf_list_files(repo), quant)
    if name is None:
        raise RuntimeError(f"no {quant} .gguf file found in {repo}")
    path = hf_download(repo, name, local_dir)
    llm = llama_cls(model_path=path, n_ctx=N_CTX, n_threads=N_THREADS, n_batch=512, verbose=False)
    return llm, name
