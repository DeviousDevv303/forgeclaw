"""Repository-owned CPU image generation, called by .github/workflows/generate-image.yml.

Model-swappable through the MODELS allowlist below. When MODEL is unset, the default is
resolved by size (see resolve_default_model): FLUX.2 klein 4B — the pipeline that won the
2026-11-21 ForgeClaw image bakeoff (5 of 6 prompts against SDXL Turbo, including the
lighthouse and the cube regression; Apache-2.0) — at its verified 512x512, and Stable
Diffusion 1.5 (OpenRAIL-M) above that, as the only model verified at larger sizes. An explicit
MODEL is never overridden. See each entry's `license` note before relying on them.

Caller settings arrive as optional env vars — STEPS, GUIDANCE, SEED, NEGATIVE_PROMPT — and are
resolved against the model's verified regime in build_spec: a seed is honored by every model;
steps and guidance are honored where the model's regime allows (the distilled, CFG-free Turbo
models clamp steps to their 1-4 regime and ignore guidance, saying so in `settings_notes`);
a negative prompt replaces the built-in one only on models that support negatives and is
ignored-with-note elsewhere. Every clamp or ignore is recorded in the spec's `settings_notes`
and in the run metadata — a setting is never silently dropped. There is deliberately no VAE
setting: see the VAE note above the loaders below.

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

def resolve_default_model(width: int, height: int) -> str:
    """The model a request with no explicit MODEL renders with, by size.

    Mirrors defaultImageModel in src/lib/forgeTools.ts (a test keeps the two in step):
    FLUX.2 klein 4B at or below its verified 512x512; SD1.5 above, as the only model
    verified at larger sizes.
    """
    return "flux2-klein-4b" if width <= 512 and height <= 512 else "sd15"

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
    # Bakeoff candidates (phase 1, 2026-11-20): Apache-2.0 weights. flux2-klein-4b won the
    # 2026-11-21 bakeoff and is now the size-resolved default at or below 512 (see
    # resolve_default_model above); z-image-turbo is still never returned by it. The
    # steps/guidance below are the vendors'
    # published starting points for the bakeoff, NOT verified settings.
    #
    # flux2-klein-4b (phase 2): loader wired — the staged split below (_klein_encode /
    # _klein_generate), exercised locally against the pinned diffusers 0.41.0 with an
    # import-and-construct smoke (tiny random-init components, no downloaded weights);
    # the first real render happens on the runner, as the bakeoff's first recorded run
    # (see BAKEOFF.md). Its repo config ships is_distilled=true, hence `distilled` here:
    # like the CFG-free models it ignores guidance and negative prompts (with notes) and
    # callers' steps clamp to the 1-4 band; its table guidance 1.0 is what the spec
    # records and passes.
    #
    # z-image-turbo stays `runnable: False`, and not for lack of a pipeline class —
    # diffusers 0.41.0 has ZImagePipeline. The model's diffusers download is 32.9 GB
    # (the transformer alone is 24.6 GB of float32 shards) against the standard
    # runner's 14 GB SSD, and the float32 transformer alone (24.6 GB) exceeds its
    # 16 GB RAM even staged; bf16 loading cannot shrink the download. The runner-shaped
    # route for this model is the quantized GGUF benchmark in
    # .github/workflows/cpu-image-benchmark.yml, not this script. See BAKEOFF.md.
    "z-image-turbo": {
        "repo": "Tongyi-MAI/Z-Image-Turbo",
        "steps": 8,
        "guidance": 0.0,
        "max_side": 512,
        "staged": False,
        "negative": False,
        "runnable": False,
        "license": "Apache License 2.0 (commercial use permitted)",
    },
    "flux2-klein-4b": {
        "repo": "black-forest-labs/FLUX.2-klein-4B",
        "steps": 4,
        "guidance": 1.0,
        "max_side": 512,
        "staged": True,
        "negative": False,
        "distilled": True,
        "license": "Apache License 2.0 (commercial use permitted)",
    },
}

# The distilled models (table guidance 0.0: they run without classifier-free guidance) have a
# verified multi-step band of 1-4 — the band the generate_image tool schema advertises. A
# caller's steps above it are clamped to it, with a settings note.
DISTILLED_STEP_CAP = 4

NEGATIVE_PROMPT = "blurry, low quality, distorted, deformed, ugly, watermark, signature"


class SpecError(ValueError):
    pass


def build_spec(env: dict) -> dict:
    """Validate the request and return the resolved generation spec. Raises SpecError."""
    prompt = (env.get("PROMPT") or "").strip()
    style = (env.get("STYLE") or "realistic").strip() or "realistic"
    try:
        width = int(env.get("WIDTH") or "512")
        height = int(env.get("HEIGHT") or "512")
    except ValueError as exc:
        raise SpecError("width and height must be integers") from exc
    model = (env.get("MODEL") or "").strip() or resolve_default_model(width, height)
    if not prompt or len(prompt) > 4000:
        raise SpecError("prompt must contain 1-4000 characters")
    if model not in MODELS:
        raise SpecError(f"unknown model '{model}'; allowed: {', '.join(sorted(MODELS))}")
    cfg = MODELS[model]
    if not cfg.get("runnable", True):
        raise SpecError(
            f"model '{model}' is a bakeoff candidate whose loader is not verified yet; "
            "it cannot be run (see BAKEOFF.md)"
        )
    if not (256 <= width <= 1024 and 256 <= height <= 1024):
        raise SpecError("width and height must be between 256 and 1024")
    if width % 8 or height % 8:
        raise SpecError("width and height must be divisible by 8")
    if width > cfg["max_side"] or height > cfg["max_side"]:
        raise SpecError(f"model '{model}' is only verified up to {cfg['max_side']}x{cfg['max_side']}")

    # Caller settings, resolved against the model's verified regime. A model whose table
    # guidance is 0.0 is distilled: it runs without classifier-free guidance (the staged
    # encoder literally encodes with do_classifier_free_guidance=False), so guidance and
    # negative prompts cannot take effect on it and steps are capped at its 1-4 band.
    # A model flagged `distilled` in the table (FLUX.2 klein, whose repo config ships
    # is_distilled=true) is in the same regime at its own table guidance: the pipeline
    # ignores whatever guidance it is handed, so a differing caller value is noted and
    # the table value stands.
    distilled = cfg["guidance"] == 0.0 or bool(cfg.get("distilled"))
    notes: list[str] = []

    steps = cfg["steps"]
    user_steps = _optional_int(env, "STEPS", "steps")
    if user_steps is not None:
        if not 1 <= user_steps <= 150:
            raise SpecError("steps must be between 1 and 150")
        if distilled and user_steps > DISTILLED_STEP_CAP:
            notes.append(
                f"steps {user_steps} clamped to {DISTILLED_STEP_CAP}: '{model}' is a distilled "
                f"model whose verified regime is 1-{DISTILLED_STEP_CAP} steps"
            )
            steps = DISTILLED_STEP_CAP
        else:
            steps = user_steps

    guidance = cfg["guidance"]
    raw_guidance = (env.get("GUIDANCE") or "").strip()
    if raw_guidance:
        try:
            user_guidance = float(raw_guidance)
        except ValueError as exc:
            raise SpecError("guidance must be a number") from exc
        if not 0 <= user_guidance <= 30:
            raise SpecError("guidance must be between 0 and 30")
        if distilled:
            if user_guidance != cfg["guidance"]:
                notes.append(
                    f"guidance {user_guidance} ignored: '{model}' is a distilled model that "
                    f"runs without classifier-free guidance (guidance {cfg['guidance']:g})"
                )
        else:
            guidance = user_guidance

    seed = _optional_int(env, "SEED", "seed")
    if seed is not None and not 0 <= seed <= 2147483647:
        raise SpecError("seed must be between 0 and 2147483647")

    negative = NEGATIVE_PROMPT if cfg["negative"] else None
    raw_negative = env.get("NEGATIVE_PROMPT") or ""
    if len(raw_negative) > 1000:
        raise SpecError("negative prompt must be at most 1000 characters")
    if raw_negative.strip():
        if cfg["negative"]:
            negative = raw_negative.strip()
        else:
            notes.append(
                f"negative prompt ignored: '{model}' does not support negative prompts "
                "(it runs without classifier-free guidance)"
            )

    return {
        "model": model,
        "repo": cfg["repo"],
        "prompt": prompt,
        "style": style,
        "width": width,
        "height": height,
        "steps": steps,
        "guidance": guidance,
        "seed": seed,
        "staged": cfg["staged"],
        "negative": negative,
        "settings_notes": notes,
        "license": cfg["license"],
        "generation_prompt": f"{prompt}, {style} style, high quality, detailed",
    }


def _optional_int(env: dict, key: str, label: str):
    """An optional integer env setting: None when unset or empty, SpecError when malformed."""
    raw = (env.get(key) or "").strip()
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError as exc:
        raise SpecError(f"{label} must be an integer") from exc


def _threads(torch) -> None:
    # Capped at 2: the benchmark showed 4 threads gave no speedup on the 4-vCPU runner.
    torch.set_num_threads(min(2, os.cpu_count() or 1))


# VAE note (phase-1 audit, 2026-11-20): there is deliberately no VAE setting anywhere in
# this pipeline. Every loader uses each model's own VAE — _generate_standard through the full
# pipeline load, _staged_generate through AutoencoderKL.from_pretrained(repo, subfolder="vae"),
# and the klein phases below through the pipeline's own component load.
# A caller-selectable VAE belongs in the MODELS table as a per-model `vae_repo` allowlist
# entry consumed at exactly those two load sites. It is not wired in this phase: no VAE
# allowlist exists, the tool schema has no VAE property to wire from, and an unvetted VAE
# repo is a supply-chain and dtype risk on this CPU runner (the staged path already refuses
# a non-float32 UNet for the same reason). See BAKEOFF.md, phase 2.


def _seeded_generator(torch, spec: dict):
    """A CPU generator for the caller's seed, or None (random) when no seed was set."""
    if spec.get("seed") is None:
        return None
    return torch.Generator(device="cpu").manual_seed(spec["seed"])


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
    generator = _seeded_generator(torch, spec)
    if generator is not None:
        kwargs["generator"] = generator
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
    kwargs = {}
    generator = _seeded_generator(torch, spec)
    if generator is not None:
        kwargs["generator"] = generator
    with torch.inference_mode():
        image = pipe(
            prompt_embeds=emb["prompt_embeds"],
            pooled_prompt_embeds=emb["pooled_prompt_embeds"],
            width=spec["width"],
            height=spec["height"],
            num_inference_steps=spec["steps"],
            guidance_scale=spec["guidance"],
            **kwargs,
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


def _klein_encode(spec: dict, embeddings_path: str) -> None:
    import torch
    from diffusers import Flux2KleinPipeline

    _threads(torch)
    # Only the text encoder and tokenizer load in this phase (8.1 GB of the repo); the
    # transformer and VAE stay unloaded and undownloaded until the generate phase.
    pipe = Flux2KleinPipeline.from_pretrained(spec["repo"], transformer=None, vae=None, torch_dtype=torch.bfloat16)
    with torch.inference_mode():
        prompt_embeds, _ = pipe.encode_prompt(
            prompt=[spec["generation_prompt"]], device="cpu", num_images_per_prompt=1,
        )
        # The pipeline's CFG path encodes the empty prompt; encode it now, while the text
        # encoder exists, so the generate phase never needs it. With this model's
        # distilled config the negative embeds go unused (guidance is ignored there).
        negative_prompt_embeds, _ = pipe.encode_prompt(
            prompt=[""], device="cpu", num_images_per_prompt=1,
        )
    torch.save(
        {"prompt_embeds": prompt_embeds.cpu(), "negative_prompt_embeds": negative_prompt_embeds.cpu()},
        embeddings_path,
    )


def _klein_generate(spec: dict, embeddings_path: str, image_path: str) -> None:
    import torch
    from diffusers import Flux2KleinPipeline

    _threads(torch)
    emb = torch.load(embeddings_path, map_location="cpu", weights_only=True)
    pipe = Flux2KleinPipeline.from_pretrained(
        spec["repo"], text_encoder=None, tokenizer=None, torch_dtype=torch.bfloat16,
    )
    pipe.enable_attention_slicing()
    dtypes = sorted({str(p.dtype) for p in pipe.transformer.parameters()})
    if dtypes != [str(torch.bfloat16)]:
        # The weights are stored bf16; anything else means a silent upcast — an fp32 copy
        # of the 4B transformer would not fit beside the VAE in the runner's 16 GB.
        raise SystemExit(f"Transformer parameter dtype mismatch: expected bfloat16, got {dtypes}")
    kwargs = {}
    generator = _seeded_generator(torch, spec)
    if generator is not None:
        kwargs["generator"] = generator
    with torch.inference_mode():
        image = pipe(
            prompt_embeds=emb["prompt_embeds"],
            negative_prompt_embeds=emb["negative_prompt_embeds"],
            width=spec["width"],
            height=spec["height"],
            num_inference_steps=spec["steps"],
            guidance_scale=spec["guidance"],
            **kwargs,
        ).images[0]
    image.save(image_path, format="PNG")


def _generate_klein_staged(spec: dict):
    """Encode prompts in one process, then load only the transformer and VAE in another —
    the staged split, for the same reason as SDXL's: FLUX.2 klein's Qwen3 text encoder
    (8.1 GB) and its transformer (7.8 GB) never share the runner's 16 GB RAM. Each phase
    also gets its own HF_HOME inside the temp dir, and the encode phase's downloads are
    deleted before the generate phase starts: together the components are 16.0 GB against
    the runner's 14 GB SSD, so neither the full repo nor a shared cache fits, while each
    phase's own downloads (8.1 GB, then 7.9 GB) do. A side effect the bakeoff accepts:
    the workflow's HF cache is bypassed for this model, so every run downloads fresh."""
    import shutil

    from PIL import Image

    with tempfile.TemporaryDirectory(prefix="flux2-klein-staged-") as tmp:
        emb = os.path.join(tmp, "embeddings.pt")
        out = os.path.join(tmp, "image.png")
        spec_json = os.path.join(tmp, "spec.json")
        Path(spec_json).write_text(json.dumps(spec), encoding="utf-8")
        for phase in ("encode", "generate"):
            hf_home = os.path.join(tmp, f"hf-{phase}")
            subprocess.run(
                [sys.executable, __file__, "--phase", phase, "--spec", spec_json, "--embeddings", emb, "--image", out],
                check=True,
                env={**os.environ, "HF_HOME": hf_home},
            )
            if phase == "encode":
                shutil.rmtree(hf_home, ignore_errors=True)
        return Image.open(out).convert("RGB")


def write_metadata(spec: dict, invocation_id: str, seconds: float) -> None:
    negative = spec["negative"] or "(none; model runs without guidance)"
    seed = spec["seed"] if spec["seed"] is not None else "(random)"
    notes = "".join(f"Settings note: {note}\n" for note in spec["settings_notes"])
    Path("generation_metadata.txt").write_text(
        f"Prompt: {spec['prompt']}\nStyle: {spec['style']}\nSize: {spec['width']}x{spec['height']}\n"
        f"Model: {spec['repo']}\nModel key: {spec['model']}\nSteps: {spec['steps']}\n"
        f"Guidance Scale: {spec['guidance']}\nSeed: {seed}\nNegative prompt: {negative}\n"
        f"{notes}"
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
            "seed": spec["seed"],
            "settings_notes": spec["settings_notes"],
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
        klein = spec["model"] == "flux2-klein-4b"
        if args.phase == "encode":
            if klein:
                _klein_encode(spec, args.embeddings)
            else:
                _staged_encode(spec, args.embeddings)
        else:
            if klein:
                _klein_generate(spec, args.embeddings, args.image)
            else:
                _staged_generate(spec, args.embeddings, args.image)
        return

    try:
        spec = build_spec(dict(os.environ))
    except SpecError as exc:
        raise SystemExit(str(exc))
    invocation_id = os.environ["INVOCATION_ID"]
    print(f"Model: {spec['repo']} ({spec['model']}), {spec['width']}x{spec['height']}, steps={spec['steps']}, guidance={spec['guidance']}, seed={spec['seed']}", flush=True)
    for note in spec["settings_notes"]:
        print(f"Settings note: {note}", flush=True)
    print(f"License: {spec['license']}", flush=True)
    started = time.perf_counter()
    if spec["model"] == "flux2-klein-4b":
        image = _generate_klein_staged(spec)
    elif spec["staged"]:
        image = _generate_staged(spec)
    else:
        image = _generate_standard(spec)
    seconds = time.perf_counter() - started
    output_path = Path(f"generated_{spec['width']}x{spec['height']}.png")
    image.save(output_path)
    write_metadata(spec, invocation_id, seconds)
    print(f"Saved {output_path} in {seconds:.1f}s", flush=True)


if __name__ == "__main__":
    main()
