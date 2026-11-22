# Image Model Bakeoff — protocol and record sheet

Phase 1 (2026-11-20) prepared this spec and the candidate table entries. **No benchmark is
run in phase 1, and no default changes in this phase.** A candidate becomes default-eligible
only by winning this bakeoff under the judging rule below, and any later default change
rolls out canary-style per the owner's standing implementation law (small staged exposure,
measured against the incumbent, rollback named).

## Candidates and incumbents

| Key | Model | License | Status |
|---|---|---|---|
| `sdxl-turbo` | stabilityai/sdxl-turbo | Stability AI Community License | Incumbent default ≤512×512 |
| `sd15` | runwayml/stable-diffusion-v1-5 | CreativeML OpenRAIL-M | Incumbent default >512×512 |
| `sd-turbo` | stabilityai/sd-turbo | Stability AI Community License | Existing alternate, reference row |
| `z-image-turbo` | Tongyi-MAI/Z-Image-Turbo | Apache-2.0 | **Candidate — blocked on the diffusers route (runner disk)** |
| `flux2-klein-4b` | black-forest-labs/FLUX.2-klein-4B | Apache-2.0 | **Candidate — loader wired (phase 2); runner render is the first recorded run** |

**Loader gate (per candidate, before any timing run):** neither candidate loads through the
script's original patterns — Z-Image uses diffusers' `ZImagePipeline`, FLUX.2 klein uses
`Flux2KleinPipeline`; the script's standard path is `AutoPipelineForText2Image` and its staged
path was an SDXL-specific split. Phase 2 (2026-11-20) closed the gate per candidate:

- **`flux2-klein-4b` — wired.** A staged klein split in `.github/scripts/generate_image.py`
  (`_klein_encode` / `_klein_generate`, on the pinned diffusers 0.41.0 — no dependency
  change): the encode phase loads only the Qwen3 text encoder (8.1 GB download), the
  generate phase only the transformer + VAE (7.9 GB), each in its own HF_HOME with the
  encode downloads deleted in between, because the components together (16.0 GB) exceed
  both the runner's 16 GB RAM (if loaded together) and its 14 GB SSD (if cached
  together). The wiring was exercised locally with an import-and-construct smoke (tiny
  random-init components, no downloaded weights): encode → prompt_embeds → a
  text-encoder-less generate-phase call with a seeded generator produced an image.
  `runnable` is raised and the app dispatch accepts the model explicitly. Still to be
  proven on the runner, by the first recorded run below: the real-weight render itself,
  wall seconds per step for a 4B bf16 transformer on CPU (the 45-minute job budget is
  the risk), and peak memory. `max_side` stays 512 until a 768 render is runner-verified.
- **`z-image-turbo` — still refused, on arithmetic, not wiring.** diffusers 0.41.0 has
  `ZImagePipeline`, but the model's diffusers download is 32.9 GB — the transformer
  alone is 24.6 GB of float32 shards — against the standard runner's 14 GB SSD, and the
  float32 transformer alone exceeds its 16 GB RAM even staged; loading bf16 cannot
  shrink the download. `build_spec` and the app dispatch keep refusing it. The
  runner-shaped route for this model already exists in the repo: the quantized GGUF
  benchmark in `.github/workflows/cpu-image-benchmark.yml` (~5.6 GB of Q3_K/Q4_K_M
  files via stable-diffusion.cpp). Benchmarking Z-Image against this record sheet means
  running that route, or moving this candidate to a larger runner — either is a
  separate reviewed change, as is any future `runnable` flip here.

The steps/guidance in the candidate table entries are the vendors' published starting
points, not verified settings; the bakeoff confirms or corrects them. One correction is
already recorded: FLUX.2 klein's repo config ships `is_distilled: true`, so the script
treats it as a distilled model — caller guidance and negative prompts are ignored with a
settings note (the pipeline itself discards them), and caller steps clamp to the 1–4 band.

## Prompt set (identical for every model, in this order)

1. **Lighthouse** — Nexus's canonical first image (2026-11-11), the standing reference prompt:
   `a lighthouse on a rocky shore at dusk, waves crashing, warm light in the tower`
2. **Cube regression** — the plainly-specified subject a previous render visibly missed
   (Manus's audit, 2026-11-20); a subject miss here is unambiguous:
   `a single red cube on a plain white background, studio product photo`
3. **Forge fox** — the dispatch tests' canonical ForgeClaw prompt:
   `a red fox in a forge, artistic`
4. **The forge itself**:
   `an anvil and a glowing hammer in a medieval forge, sparks in the air, cinematic light`
5. **Mechanical owl**:
   `a mechanical owl with brass gears and copper feathers, portrait, intricate detail`
6. **Isles vista** — Nexus Isles tie-in, tests scene composition:
   `an isometric island with a small harbor town, bridges to two smaller islets, game art`

Style is `realistic` for prompts 1, 2, 6 and `artistic` for 3, 4, 5 (the style each prompt
was born with). Every run uses **seed 42** (the phase-1 seed wiring exists so candidates are
compared on identical noise) and each model's own resolved steps/guidance — the settings a
default would actually ship with, recorded from `generation_meta.json`.

## Sizes

- **512×512** — every model, every prompt.
- **768×768** — every model whose verified `max_side` allows it. Today that is only `sd15`;
  a candidate runs the 768 leg only after its loader gate above has raised its `max_side`
  on runner evidence. A candidate that cannot do 768 can still win the ≤512 default; the
  >512 default is judged separately, as today.

## Recorded per run

From the workflow run and its `generation_meta.json` artifact:

- Actions run ID and run URL
- Model key and repo; resolved steps, guidance, seed, and any `settings_notes`
- **Wall seconds** (`generation_seconds`, plus the job's total duration)
- **Peak memory** where available: run the generator under `/usr/bin/time -v` and record
  Maximum resident set size (the staged SDXL path's historical figures — 11.7 GiB vs
  14.1 GiB — were recorded this way)
- Output PNG path: the run artifact and the `generated-images` mirror URL
- Failure mode verbatim if the run fails (OOM, dtype refusal, loader error) — a failure is
  a result; record it, do not retry it into a pass

## Judging rule

Refereed comparison on identical prompts, the pattern of the bakeoff SDXL Turbo won:
outputs are compared blind, side by side, per prompt, against the incumbent for that size
class. A candidate is default-eligible only if it **wins its size class** — visibly better
on the prompt set without a regression on the cube regression prompt, at a wall time and
peak memory the 45-minute CPU job can afford. Ties keep the incumbent. Quality claims cite
the recorded runs above; no run, no claim.

## After the bakeoff

- **VAE:** a caller-selectable VAE, if still wanted, enters as a per-model `vae_repo`
  allowlist in the Python MODELS table, consumed at the two load sites named in the VAE
  note in `.github/scripts/generate_image.py`. Not before an allowlist exists.
- **Default change:** a winning candidate still ships canary-style — staged exposure,
  measured against the incumbent, rollback named — never straight to full default.
