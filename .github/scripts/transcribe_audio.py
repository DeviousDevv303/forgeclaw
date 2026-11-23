"""Audio transcription for .github/workflows/audio-transcribe.yml (faster-whisper "small", CPU, int8).

Why a script: the vision workflow's history (an inline, unpinned python one-liner that died on an
import) is the standing lesson — model code lives in a file, pinned, and unit-tested.

Decoding is done by faster-whisper itself through PyAV (which bundles the FFmpeg libraries), so the
audio/mp4 + AAC that iOS Safari's MediaRecorder produces — and WebM/Opus, MP3, WAV, OGG, FLAC —
decodes with no separate ffmpeg step. Verified locally 2026-11-22: an 11 s clip transcribed in ~7 s
on a 1.5-CPU VM, and its MP4/AAC re-encode transcribed identically.

Importing this module needs neither faster-whisper nor PyAV, so validation is unit-tested without them.
Failures are printed as GitHub annotations (::error::) so they are readable through the API.
"""
from __future__ import annotations

import os
import re
import sys
import time

MODEL = "small"
MODEL_ID = "Systran/faster-whisper-small"
MAX_AUDIO_BYTES = 10 * 1024 * 1024
LANGUAGE_RE = re.compile(r"^[a-z]{2,3}$")


class SpecError(ValueError):
    pass


def validate_language(raw: str) -> str | None:
    """Return a language code ('en', 'es', …) or None for auto-detect; anything else is a spec error."""
    code = (raw or "").strip().lower()
    if not code:
        return None
    if not LANGUAGE_RE.match(code):
        raise SpecError("language must be empty (auto-detect) or a 2-3 letter code like 'en' or 'es'")
    return code


def read_local_audio(path: str) -> bytes:
    """An attached clip the app uploaded to the audio-inputs branch; the workflow wrote it to `path`."""
    with open(path, "rb") as handle:
        data = handle.read(MAX_AUDIO_BYTES + 1)
    if len(data) > MAX_AUDIO_BYTES:
        raise SpecError(f"audio is larger than {MAX_AUDIO_BYTES // (1024 * 1024)} MB")
    if not data:
        raise SpecError("the attached audio is empty")
    return data


def transcribe(path: str, language: str | None, load_model) -> tuple[str, dict]:
    """Transcribe with an injected model loader (tests pass a fake). Returns (text, meta)."""
    model = load_model()
    segments, info = model.transcribe(path, language=language, beam_size=5)
    text = "".join(segment.text for segment in segments).strip()
    meta = {
        "language": getattr(info, "language", "") or (language or ""),
        "duration_seconds": round(float(getattr(info, "duration", 0.0) or 0.0), 1),
    }
    return text, meta


def annotate_error(message: str) -> None:
    print(f"::error title=transcribe_audio::{message.splitlines()[0][:300]}", flush=True)


def run(env: dict) -> int:
    local = env.get("AUDIO_FILE", "").strip()
    if not local:
        annotate_error("no attached audio was provided (AUDIO_FILE is empty)")
        return 2
    try:
        language = validate_language(env.get("LANGUAGE", ""))
        read_local_audio(local)  # size/emptiness gate before the model is even downloaded
    except (SpecError, OSError) as exc:
        annotate_error(str(exc))
        return 2
    try:
        from faster_whisper import WhisperModel

        started = time.time()
        text, meta = transcribe(local, language, lambda: WhisperModel(MODEL, device="cpu", compute_type="int8"))
        if not text:
            raise RuntimeError("the model heard no speech in this audio")
        with open("result.txt", "w", encoding="utf-8") as handle:
            handle.write(text)
        with open("result_meta.txt", "w", encoding="utf-8") as handle:
            handle.write(
                f"model={MODEL_ID}\n"
                f"language={meta['language']}\n"
                f"duration_seconds={meta['duration_seconds']}\n"
                f"elapsed_seconds={round(time.time() - started, 1)}\n"
            )
        print(f"Transcript ({len(text)} chars, {meta['duration_seconds']}s of audio) in {round(time.time() - started, 1)}s: {text[:200]}", flush=True)
        return 0
    except Exception as exc:  # noqa: BLE001 - report every failure as an annotation, then fail the job
        annotate_error(f"{type(exc).__name__}: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(run(dict(os.environ)))
