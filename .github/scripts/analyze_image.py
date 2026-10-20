"""Image analysis for .github/workflows/image-analyze.yml (Qwen2-VL-2B-Instruct, CPU, float32).

Why a script: the workflow used to inline this as `python3 -c "..."` with an unpinned transformers.
The current transformers (5.x) no longer has AutoModelForVision2Seq, so every run died on import after
~36 s; it also returned the prompt echoed back and fetched any URL with no timeout.

Importing this module needs neither torch nor transformers, so validation is unit-tested without them.
Failures are printed as GitHub annotations (::error::) so they are readable through the API.
"""
from __future__ import annotations

import io
import os
import sys
import time
import urllib.parse

MODEL = "Qwen/Qwen2-VL-2B-Instruct"
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_PROMPT_CHARS = 2000
MAX_NEW_TOKENS = 300
# Bound the work per image: Qwen2-VL tokenizes by pixel area, and CPU time grows with it.
MIN_PIXELS = 128 * 28 * 28
MAX_PIXELS = 512 * 28 * 28
FETCH_TIMEOUT_S = 30


class SpecError(ValueError):
    pass


def validate(image_url: str, prompt: str) -> tuple[str, str]:
    """Return (url, prompt) or raise SpecError. https only; no credentials in the URL; no local hosts."""
    url = (image_url or "").strip()
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise SpecError("image_url must be an https URL")
    if parsed.username or parsed.password:
        raise SpecError("image_url must not contain credentials")
    host = parsed.hostname.casefold()
    if host == "localhost" or host.endswith(".local") or host.endswith(".internal") or host.replace(".", "").isdigit():
        raise SpecError("image_url must point to a public host name")
    text = (prompt or "").strip() or "Describe this image in detail."
    if len(text) > MAX_PROMPT_CHARS:
        raise SpecError(f"prompt must be at most {MAX_PROMPT_CHARS} characters")
    return url, text


def fetch_image_bytes(url: str, get) -> bytes:
    """Download with a timeout and a hard size cap. `get` is requests.get (injected for tests)."""
    response = get(url, stream=True, timeout=FETCH_TIMEOUT_S, headers={"User-Agent": "ForgeClaw-image-analyze/1.0"})
    response.raise_for_status()
    chunks, total = [], 0
    for chunk in response.iter_content(65536):
        total += len(chunk)
        if total > MAX_IMAGE_BYTES:
            raise SpecError(f"image is larger than {MAX_IMAGE_BYTES // (1024 * 1024)} MB")
        chunks.append(chunk)
    return b"".join(chunks)


def read_local_image(path: str) -> bytes:
    """An attached picture the app uploaded to the vision-inputs branch; the workflow wrote it to `path`."""
    with open(path, "rb") as handle:
        data = handle.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise SpecError(f"image is larger than {MAX_IMAGE_BYTES // (1024 * 1024)} MB")
    if not data:
        raise SpecError("the attached image is empty")
    return data


def strip_prompt_echo(decoded: str) -> str:
    """Keep only the assistant turn if a decoder returned the whole chat transcript."""
    marker = "assistant\n"
    return decoded.rsplit(marker, 1)[-1].strip() if marker in decoded else decoded.strip()


def annotate_error(message: str) -> None:
    print(f"::error title=analyze_image::{message.splitlines()[0][:300]}", flush=True)


def run(env: dict) -> int:
    local = env.get("IMAGE_FILE", "").strip()
    try:
        if local:
            # The picture came from the app, not from a URL: only the prompt needs checking.
            url, prompt = "", validate("https://attached.invalid/", env.get("PROMPT", ""))[1]
        else:
            url, prompt = validate(env.get("IMAGE_URL", ""), env.get("PROMPT", ""))
    except SpecError as exc:
        annotate_error(str(exc))
        return 2
    try:
        import requests
        import torch
        from PIL import Image
        from transformers import AutoModelForImageTextToText, AutoProcessor

        torch.set_num_threads(min(4, os.cpu_count() or 1))
        started = time.time()
        raw = read_local_image(local) if local else fetch_image_bytes(url, requests.get)
        image = Image.open(io.BytesIO(raw)).convert("RGB")
        processor = AutoProcessor.from_pretrained(MODEL, min_pixels=MIN_PIXELS, max_pixels=MAX_PIXELS)
        model = AutoModelForImageTextToText.from_pretrained(MODEL, torch_dtype=torch.float32)
        model.eval()
        messages = [{"role": "user", "content": [{"type": "image"}, {"type": "text", "text": prompt}]}]
        text = processor.apply_chat_template(messages, add_generation_prompt=True)
        inputs = processor(images=[image], text=[text], return_tensors="pt")
        with torch.inference_mode():
            out = model.generate(**inputs, max_new_tokens=MAX_NEW_TOKENS, do_sample=False)
        generated = out[:, inputs["input_ids"].shape[1]:]  # new tokens only, never the prompt
        result = strip_prompt_echo(processor.batch_decode(generated, skip_special_tokens=True)[0])
        if not result:
            raise RuntimeError("the model returned an empty analysis")
        with open("result.txt", "w", encoding="utf-8") as handle:
            handle.write(result)
        with open("result_meta.txt", "w", encoding="utf-8") as handle:
            handle.write(f"model={MODEL}\nelapsed_seconds={round(time.time() - started, 1)}\nimage_bytes_limit={MAX_IMAGE_BYTES}\n")
        print(f"Analysis ({len(result)} chars) in {round(time.time() - started, 1)}s: {result[:200]}", flush=True)
        return 0
    except Exception as exc:  # noqa: BLE001 - report every failure as an annotation, then fail the job
        annotate_error(f"{type(exc).__name__}: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(run(dict(os.environ)))
