# NEXUS continuity: handoff note (2026-10-26)

**Law (owner, Cristian Nunez):** NEXUS walks with the providers all the way to the chat response. It rides every
provider end to end, from dispatch through generation to the answer on screen, and no stage strips it silently.
Boundary: influence means guidance present in the prompt, steering the work. NEXUS does not rewrite or approve final replies.

## Owner authorization used

- First round: a reply of "Authorized" to the proposed `src/lib/forgeTools.ts` overlap fix, read as covering that one
  protected-path edit and nothing else.
- Second round (2026-10-25 23:30 CDT, as relayed in session): both gap fixes ("deepseek-16b.yml: the middle-trim must not
  cut the guidance; surface prompt_trimmed in chat when a trim fires" and "executeTool attaches guidance so hand-typed
  deepseek_reason calls carry it"), and splitting this fix onto its own branch from main. One builder (Claude), one
  verifier (Muse), the owner merges. Coordination record: #235; spec: PR #320.

Protected files touched in this change: `src/lib/forgeTools.ts` and `.github/workflows/deepseek-16b.yml`. Nothing else
protected (not `deepseek_gguf.py`, not the Python tests, not `package.json`, Guardian, `engine/`, `foundation/`, `LICENSE`).

## Where NEXUS travels, and what each stage does

| Stage | File | Behaviour |
|---|---|---|
| Build the 16B context | `src/lib/ai/deepseekContext.ts` | Guidance block is the first section, so the 22K budget cuts the envelope, architecture facts and old records before it. |
| Fixed chains (website, self-sculpt) | `src/lib/ai/providerRouter.ts` (`chainGuidance`) | Build their own task, so they carry a block capped at 600 chars (8K window; the sculpt task holds a whole file). |
| Dispatch | `src/lib/forgeTools.ts` (`deepseek_reason`) | Guidance is set aside before the "no shared words with the task" rule and put back after. The rule still drops the other context. |
| Dispatch, calls that skipped the router | `src/lib/forgeTools.ts` | If the call carries no block (hand-typed, saved agent, future path), the dispatch attaches the owner's guidance itself; long-output profiles get the 600-char block. |
| Workflow prompt fit | `.github/workflows/deepseek-16b.yml` (`fit_keeping_guidance`) | The old middle-trim cut the context, and the guidance with it. The block is now set aside, the rest is fitted into the remaining budget, and the block is restored. Result metadata records `nexus_guidance=none/kept/cut`. |
| Chat | `src/lib/deepseekArtifact.ts`, `forgeTools.ts`, `providerRouter.ts` | `prompt_trimmed` / `nexus_guidance` are read from the result metadata, appear on the Stages line, and the chat answer ends with a note when a trim fired, saying what happened to the guidance. |
| Block format | `src/lib/nexusGuidance.ts` | Block ends with `[END NEXUS GUIDANCE]`; `splitNexusGuidance` / `joinNexusGuidance` carry it as a unit; the cap keeps the end marker. |
| Hosted providers already on main (Kimi, Claude, Muse) | `src/App.tsx` | Heuristics and tool lessons are in the shared system prompt. |
| Tool-less chat turns | `src/App.tsx` (`conversationalPrompt`) | Now include the owner's heuristics (they were dropped before). |
| After the answer | `src/App.tsx` (`logToCorpus`, `recordLearning`) | Outcome recorded for every provider. Unchanged. |

Tests: `src/lib/nexusContinuity.test.ts` (block format, dispatch, chains, size budget, calls that skipped the router,
trim surfacing), `src/scripts/deepseekGuidanceTrim.test.ts` (runs the REAL helper from the workflow against the real
`fit_text`; shows the old trim cuts the guidance and the new one keeps it), `src/appNexusPlainChat.test.tsx`.

## Remaining limits

1. The trim fix covers the llama.cpp (GGUF) path, the primary engine. The transformers fallback path uses its own
   tokenizer truncation and does not report `prompt_trimmed`; the guidance there is not specially protected.
2. If a trim fires and the guidance block alone cannot fit (it is capped at 1800 chars, about 450 tokens), the metadata
   says `cut` and the chat note says so.
3. Public visitors' browsers hold no NEXUS data by design; the relay path is unchanged.

## For the next agent

- Do not widen the overlap exemption to other context: stale corpus records poisoning the 16B is what the rule is for.
- Keep `NEXUS_GUIDANCE_END` and the `GUIDANCE_START`/`GUIDANCE_END` constants in the workflow in step with `nexusGuidance.ts`;
  the split depends on them, and `deepseekGuidanceTrim.test.ts` fails if the workflow's copy drifts.
