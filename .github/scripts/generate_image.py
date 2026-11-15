"""Repository-owned CPU image generation, called by .github/workflows/generate-image.yml.

Model-swappable through the MODELS allowlist below. The default stays Stable Diffusion 1.5
(OpenRAIL-M). The Turbo models are opt-in: see each entry's `license` note before relying on them.

Everything arrives through environment variables; nothing is interpolated into shell text.
Importing this module has no side effects, so validation can be tested without torch installed.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

DEFAULT_MODEL = "sd15"

# Per-model spec. `max_side` is the largest width/height we have evidence for: SD1.5 is unchanged
# from the previous workflow (up to 1024); the Turbo models were only benchmarked at 512x512, so
# larger sizes are refused rather than risking an out-of-memory runner.
MODELS = {
    "sd15": {
        "repo": "runwayml/stable-diffusion-v1-5",
        "steps": 30,
        "guidance": 7.5,
        "max_side": 1024,
        "staged": False,
        "negative": True,
        "license": "CreativeML OpenRAIL-M (commercial use permitted with use restrictions)",
    },
    "sdxl-turbo": {
        "repo": "stabilityai/sdxl-turbo",
        "steps": 1,
        "guidance": 0.0,
        "max_side": 512,
        "staged": True,
        "negative": False,
        "license": "Stability AI Community License (free below US$1M annual revenue; commercial use "
                   "requires registration). Verify before commercial use.",
    },
    "sd-turbo": {
        "repo": "stabilityai/sd-turbo",
        "steps": 4,
        "guidance": 0.0,
        "max_side": 512,
        "staged": False,
        "negative": False,
        "license": "Stability AI Community License (free below US$1M annual revenue; commercial use "
                   "requires registration). Verify before commercial use.",
    },
}

NEGATIVE_PROMPT = "blurry, low quality, distorted, deformed, ugly, watermark, signature"


class SpecError(ValueError):
    pass


def build_spec(env: dict) -> dict:
    """Validate the request and return the resolved generation spec. Raises SpecError."""
    prompt = (env.get("PROMPT") or "").strip()
    style = (env.get("STYLE") or "realistic").strip() or "realistic"
    model = (env.get("MODEL") or DEFAULT_MODEL).strip() or DEFAULT_MODEL
    try:
        width = int(env.get("WIDTH") or "512")
        height = int(env.get("HEIGHT") or "512")
    except ValueError as exc:
        raise SpecError("width and height must be integers") from exc
    if not prompt or len(prompt) > 4000:
        raise SpecError("prompt must contain 1-4000 characters")
    if model not in MODELS:
        raise SpecError(f"unknown model '{model}'; allowed: {', '.join(sorted(MODELS))}")
    cfg = MODELS[model]
    if not (256 <= width <= 1024 and 256 <= height <= 1024):
        raise SpecError("width and height must be between 256 and 1024")
    if width % 8 or height % 8:
        raise SpecError("width and height must be divisible by 8")
    if width > cfg["max_side"] or height > cfg["max_side"]:
        raise SpecError(f"model '{model}' is only verified up to {cfg['max_side']}x{cfg['max_side']}")
    return {
        "model": model,
        "repo": cfg["repo"],
        "prompt": prompt,
        "style": style,
        "width": width,
        "height": height,
        "steps": cfg["steps"],
        "guidance": cfg["guidance"],
        "staged": cfg["staged"],
        "negative": NEGATIVE_PROMPT if cfg["negative"] else None,
        "license": cfg["license"],
        "generation_prompt": f"{prompt}, {style} style, high quality, detailed",
    }


def _threads(torch) -> None:
    # Capped at 2: the benchmark showed 4 threads gave no speedup on the 4-vCPU runner.
    torch.set_num_threads(min(2, os.cpu_count() or 1))


def _generate_standard(spec: dict):
    import torch
    from diffusers import AutoPipelineForText2Image, DPMSolverMultistepScheduler, StableDiffusionPipeline

    _threads(torch)
    if spec["model"] == "sd15":
        pipe = StableDiffusionPipeline.from_pretrained(spec["repo"], torch_dtype=torch.float32, use_safetensors=True)
        pipe.scheduler = DPMSolverMultistepScheduler.from_config(pipe.scheduler.config)
    else:
        pipe = AutoPipelineForText2Image.from_pretrained(spec["repo"], torch_dtype=torch.float32)
    pipe.enable_attention_slicing()
    kwargs = {}
    if spec["negative"]:
        kwargs["negative_prompt"] = spec["negative"]
    with torch.inference_mode():
        return pipe(
            prompt=spec["generation_prompt"],
            width=spec["width"],
            height=spec["height"],
            num_inference_steps=spec["steps"],
            guidance_scale=spec["guidance"],
            **kwargs,
        ).images[0]


def _staged_encode(spec: dict, embeddings_path: str) -> None:
    import torch
    from diffusers import StableDiffusionXLPipeline

    _threads(torch)
    pipe = StableDiffusionXLPipeline.from_pretrained(spec["repo"], unet=None, vae=None, torch_dtype=torch.float32)
    with torch.inference_mode():
        encoded = pipe.encode_prompt(
            prompt=[spec["generation_prompt"]], device="cpu", num_images_per_prompt=1,
            do_classifier_free_guidance=False,
        )
    torch.save({"prompt_embeds": encoded[0].cpu(), "pooled_prompt_embeds": encoded[2].cpu()}, embeddings_path)


def _staged_generate(spec: dict, embeddings_path: str, image_path: str) -> None:
    import torch
    from diffusers import AutoencoderKL, StableDiffusionXLPipeline, UNet2DConditionModel

    _threads(torch)
    emb = torch.load(embeddings_path, map_location="cpu", weights_only=True)
    pipe = StableDiffusionXLPipeline.from_pretrained(
        spec["repo"], unet=None, vae=None, text_encoder=None, text_encoder_2=None, torch_dtype=torch.float32,
    )
    unet = UNet2DConditionModel.from_pretrained(spec["repo"], subfolder="unet", torch_dtype=torch.float32)
    vae = AutoencoderKL.from_pretrained(spec["repo"], subfolder="vae", torch_dtype=torch.float32)
    pipe.register_modules(unet=unet, vae=vae)
    pipe.enable_attention_slicing()
    pipe = pipe.to("cpu")
    dtypes = sorted({str(p.dtype) for p in pipe.unet.parameters()})
    if dtypes != [str(torch.float32)]:
        # bf16 was measured at ~927 s per denoise step on this CPU; refuse rather than silently crawl.
        raise SystemExit(f"UNet parameter dtype mismatch: expected float32, got {dtypes}")
    with torch.inference_mode():
        image = pipe(
            prompt_embeds=emb["prompt_embeds"],
            pooled_prompt_embeds=emb["pooled_prompt_embeds"],
            width=spec["width"],
            height=spec["height"],
            num_inference_steps=spec["steps"],
            guidance_scale=spec["guidance"],
        ).images[0]
    image.save(image_path, format="PNG")


def _generate_staged(spec: dict):
    """Encode prompts in one process, then load only the UNet and VAE in another, so the text
    encoders are freed first. Benchmarked: peak 11.7 GiB vs 14.1 GiB, pixel-identical (max diff 1/255)."""
    from PIL import Image

    with tempfile.TemporaryDirectory(prefix="sdxl-staged-") as tmp:
        emb = os.path.join(tmp, "embeddings.pt")
        out = os.path.join(tmp, "image.png")
        spec_json = os.path.join(tmp, "spec.json")
        Path(spec_json).write_text(json.dumps(spec), encoding="utf-8")
        for phase in ("encode", "generate"):
            subprocess.run(
                [sys.executable, __file__, "--phase", phase, "--spec", spec_json, "--embeddings", emb, "--image", out],
                check=True,
            )
        return Image.open(out).convert("RGB")


def write_metadata(spec: dict, invocation_id: str, seconds: float) -> None:
    negative = spec["negative"] or "(none; model runs without guidance)"
    Path("generation_metadata.txt").write_text(
        f"Prompt: {spec['prompt']}\nStyle: {spec['style']}\nSize: {spec['width']}x{spec['height']}\n"
        f"Model: {spec['repo']}\nModel key: {spec['model']}\nSteps: {spec['steps']}\n"
        f"Guidance Scale: {spec['guidance']}\nNegative prompt: {negative}\n"
        f"License: {spec['license']}\nInvocation: {invocation_id}\n",
        encoding="utf-8",
    )
    Path("generation_meta.json").write_text(
        json.dumps({
            "invocation_id": invocation_id,
            "model": spec["model"],
            "repo": spec["repo"],
            "prompt": spec["prompt"],
            "style": spec["style"],
            "width": spec["width"],
            "height": spec["height"],
            "steps": spec["steps"],
            "guidance": spec["guidance"],
            "staged": spec["staged"],
            "license": spec["license"],
            "generation_seconds": round(seconds, 1),
        }, indent=2),
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", choices=["encode", "generate"])
    parser.add_argument("--spec")
    parser.add_argument("--embeddings")
    parser.add_argument("--image")
    args = parser.parse_args()

    if args.phase:  # staged worker subprocess
        spec = json.loads(Path(args.spec).read_text(encoding="utf-8"))
        if args.phase == "encode":
            _staged_encode(spec, args.embeddings)
        else:
            _staged_generate(spec, args.embeddings, args.image)
        return

    try:
        spec = build_spec(dict(os.environ))
    except SpecError as exc:
        raise SystemExit(str(exc))
    invocation_id = os.environ["INVOCATION_ID"]
    print(f"Model: {spec['repo']} ({spec['model']}), {spec['width']}x{spec['height']}, steps={spec['steps']}", flush=True)
    print(f"License: {spec['license']}", flush=True)
    started = time.perf_counter()
    image = _generate_staged(spec) if spec["staged"] else _generate_standard(spec)
    seconds = time.perf_counter() - started
    output_path = Path(f"generated_{spec['width']}x{spec['height']}.png")
    image.save(output_path)
    write_metadata(spec, invocation_id, seconds)
    print(f"Saved {output_path} in {seconds:.1f}s", flush=True)


if __name__ == "__main__":
    main()
