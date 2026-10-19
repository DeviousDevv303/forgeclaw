"""Code review for .github/workflows/code-review.yml.

The workflow used to load CodeLlama-7B as float32 on the CPU runner: ~28 GB of weights on a 16 GB
machine, so the runner was killed (live run 39311383660 was cancelled after 2m12s). This runs a 4-bit
GGUF of DeepSeek-Coder-6.7B-Instruct with llama.cpp instead (about 4 GB, same engine as deepseek-16b.yml).
The model therefore changes from CodeLlama to DeepSeek-Coder; review_meta.txt records exactly what ran.

Importing this module needs no llama_cpp, so validation and prompt building are unit-tested without it.
The code under review is untrusted data: it is placed in the prompt as text and never executed.
"""
from __future__ import annotations

import os
import re
import sys
import time

import deepseek_gguf as g

REPO = "TheBloke/deepseek-coder-6.7B-instruct-GGUF"
QUANT = "q4_k_m"
MAX_CODE_CHARS = 12000
MAX_NEW_TOKENS = 700
TIME_BUDGET_S = 420
LANGUAGE_RE = re.compile(r"^[A-Za-z0-9+#._-]{1,30}$")
SYSTEM = ("You are an AI programming assistant. You review code for bugs and quality and answer concisely.")
STOP = ["<|EOT|>", "### Instruction:"]


class SpecError(ValueError):
    pass


def validate(code: str, language: str) -> tuple[str, str]:
    code = code or ""
    if not code.strip():
        raise SpecError("code_content is empty")
    if len(code) > MAX_CODE_CHARS:
        raise SpecError(f"code_content is longer than {MAX_CODE_CHARS} characters")
    language = (language or "typescript").strip()
    if not LANGUAGE_RE.match(language):
        raise SpecError("language must be 1-30 letters, digits or + # . _ -")
    return code, language


def build_prompt(code: str, language: str) -> str:
    instruction = (f"Review this {language} code. Identify bugs, suggest improvements, and rate the quality from 1 to 10.\n\n"
                   f"```{language}\n{code}\n```")
    return f"{SYSTEM}\n### Instruction:\n{instruction}\n### Response:\n"


def annotate_error(message: str) -> None:
    print(f"::error title=review_code::{message.splitlines()[0][:300]}", flush=True)


def run(env: dict) -> int:
    try:
        code, language = validate(env.get("CODE", ""), env.get("REVIEW_LANGUAGE", ""))
    except SpecError as exc:
        annotate_error(str(exc))
        return 2
    try:
        import llama_cpp
        from huggingface_hub import hf_hub_download, list_repo_files

        local_dir = os.path.expanduser("~/.cache/forgeclaw-review-gguf")
        started = time.time()
        llm, file_name = g.load_model(
            local_dir, list_repo_files,
            lambda repo, name, d: hf_hub_download(repo_id=repo, filename=name, local_dir=d),
            llama_cpp.Llama, repo=REPO, quant=QUANT,
        )
        load_s = round(time.time() - started, 1)
        prompt = build_prompt(code, language)
        budget = g.N_CTX - MAX_NEW_TOKENS - 16
        prompt, trimmed = g.fit_text(prompt, lambda t: len(llm.tokenize(t.encode("utf-8"), add_bos=False)), budget)
        stream = llm.create_completion(prompt, max_tokens=MAX_NEW_TOKENS, temperature=0.0, stop=STOP, stream=True)
        text, tokens, seconds, timed_out = g.generate(stream, MAX_NEW_TOKENS, TIME_BUDGET_S)
        if not text:
            raise RuntimeError("the model returned an empty review")
        if timed_out:
            text += "\n\n[review stopped at the time limit; it may be incomplete]"
        with open("review.txt", "w", encoding="utf-8") as handle:
            handle.write(text)
        with open("review_meta.txt", "w", encoding="utf-8") as handle:
            handle.write(f"model={REPO}/{file_name}\nengine=llama.cpp GGUF {QUANT.upper()}\nengine_load_seconds={load_s}\n"
                         f"generated_tokens={tokens}\ngeneration_seconds={seconds}\nstopped_by_time_budget={str(timed_out).lower()}\n"
                         f"prompt_trimmed={str(trimmed).lower()}\nllama_cpp_python={getattr(llama_cpp, '__version__', 'unknown')}\n")
        print(f"Review: {tokens} tokens in {seconds}s (load {load_s}s)", flush=True)
        return 0
    except Exception as exc:  # noqa: BLE001 - every failure becomes a readable annotation, then a failed job
        annotate_error(f"{type(exc).__name__}: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(run(dict(os.environ)))
