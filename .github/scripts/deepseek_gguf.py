"""Fast CPU engine for the DeepSeek workflow (deepseek-16b.yml): llama.cpp running a 4-bit GGUF
quantization of the SAME model the workflow already uses (deepseek-ai/deepseek-llm-7b-chat).

Why: the transformers path loads the 7B model as float16 on a CPU, which has no fast half-precision
math, and measured about 1-2 tokens per second (349-704 s per answer on recent runs). A 4-bit GGUF in
llama.cpp is built for CPUs.

Importing this module has no side effects and needs neither llama_cpp nor torch, so the pure logic
(file choice, prompt shape, fitting, time-capped generation) is unit-tested without them.
Any failure here must make the caller fall back to the transformers path; nothing in this module
should be treated as proof that the fast path worked.
"""
from __future__ import annotations

import time

GGUF_REPO = "TheBloke/deepseek-llm-7B-chat-GGUF"
QUANT = "q4_k_m"
N_CTX = 4096          # DeepSeek-LLM 7B context window
N_THREADS = 4         # the runner has 4 vCPUs
STOP = ["\n\nUser:"]  # stop a hallucinated next turn; EOS already ends a normal answer


def pick_gguf_file(files, quant=QUANT):
    """Choose the GGUF file for `quant` from a repo listing, or None. Shortest name wins on a tie."""
    wanted = quant.casefold()
    matches = [f for f in files if f.casefold().endswith(".gguf") and wanted in f.casefold()]
    return sorted(matches, key=lambda name: (len(name), name))[0] if matches else None


def build_prompt(system_text, user_text):
    """DeepSeek-LLM chat shape. The model card warns system-role messages are incompatible, so the
    system text rides inside one user turn, exactly as the transformers path does. llama.cpp adds BOS."""
    body = f"ForgeClaw instructions and context:\n{system_text}\n\n{user_text}"
    return f"User: {body}\n\nAssistant:"


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


def load_model(local_dir, hf_list_files, hf_download, llama_cls):
    """Resolve the GGUF file at runtime (the exact file name is looked up, not assumed), download it
    into `local_dir` (which the workflow caches), and open it. Raises on any problem."""
    name = pick_gguf_file(hf_list_files(GGUF_REPO))
    if name is None:
        raise RuntimeError(f"no {QUANT} .gguf file found in {GGUF_REPO}")
    path = hf_download(GGUF_REPO, name, local_dir)
    llm = llama_cls(model_path=path, n_ctx=N_CTX, n_threads=N_THREADS, n_batch=512, verbose=False)
    return llm, name
