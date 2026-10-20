# Manus directive, round 2 — 2026-10-20

**Authority:** Cristian Nunez (owner). **Written by:** Claude, who built these features.
This replaces the task list in `manus-handoff-2026-10-20.md`; its rules (section 4) still apply and are repeated below.

**Your job:** verify, measure and report. Claude designs and changes code; you produce evidence.
- Every task below has exact steps, a PASS rule and the evidence to record.
- If a step doesn't match what you see, **stop that task and report**. Don't improvise a fix.

## 0. State at hand-over

| Item | State |
|---|---|
| `main` | `9e5713c` (#171 merged). Build Gate ✅ and Deploy to GitHub Pages ✅ on that commit. |
| On main now | Live web research for free-mode visitors (relay routes), pictures for Kimi/Claude, #169 fix, current-date awareness, search-proxy fix |
| **Not on main yet** | DeepSeek pictures (Qwen2-VL on Actions). On branch `claude/code-search-proxy-workflow-d37e2y`; needs a PR and Cristian's merge. |
| Relay | Not deployed (Cristian's Cloudflare account). The new `/v1/research` routes need a (re)deploy. |

**How the Qwen models update** (answering Cristian's question):
- Both Qwen models run inside GitHub workflows that the app dispatches with `ref: main`:
  - `deepseek-16b.yml` runs Qwen3-8B, with an opt-in GPU runner.
  - `image-analyze.yml` runs Qwen2-VL-2B, CPU only.
- So every merge to main is used by the very next run. Nothing has to be rebuilt.
- The site redeploys on every push to main (`deploy.yml`).
- The **model versions themselves are pinned on purpose.** Task M5 is how a newer Qwen gets in.

## 1. Rules (unchanged, non-negotiable)

1. **Protected paths:** anything in `.github/protected-paths.txt`, plus `src/lib/forgeTools.ts`, `src/lib/guardianGate.ts` and `relay/`. You don't edit them.
2. **Branches and merging:** use `manus/<name>` branches and draft PRs only. Never push to main, never merge, never delete a branch. Cristian merges.
3. **Evidence:** every claim needs a run URL, command output or commit SHA. "Dispatched" isn't "done".
4. **No secrets** in docs, issues, comments or chat. Never ask Cristian for a key or token.
5. **Self-sculpt** stays locked behind Cristian's key. Never ask for the key.
6. **Stuck means stop:** after 2 failed attempts, report what blocked you, with evidence.

**Report format:** one row per check: `task | step | PASS/FAIL | evidence (URL/SHA/output)`.

## M1. Verify #171 live on main (no code, ~20 min). Do this first.

1. **Code Search Proxy.** Actions → Code Search Proxy → Run workflow on `main` with `query=useState repo:evil/x` and `invocation_id=manus-search-2`.
   - **PASS:** the run succeeds, and every `repository` in the `search-manus-search-2` artifact's `result.json` is `DeviousDevv303/forgeclaw`.
   - **Why:** this is the first run since the parse fix. The runs on `4222e9e` and `0e4f438` failed on the old file.
2. **Deep Research.** Actions → Deep Research with `question=What happened in AI in October 2026?`, `invocation_id=manus-research-2` (leave `mirror` at the default).
   - **PASS:** the run succeeds, and `research-results/manus-research-2.json` on branch `research-results` has at least one source whose `date` is in 2026.
3. **Live site contains #171.**
   - Open `https://deviousdevv303.github.io/forgeclaw/` (or the Pages URL in Settings → Pages).
   - Find the main `assets/index-*.js` in the page source and download it.
   - **PASS:** it contains the text `Free mode can't read pictures yet`, and it does not contain `towerslutz`.

## M2. DeepSeek pictures, live (only after Cristian merges the DeepSeek-pictures PR)

**What changed:** `image-analyze.yml` now has two jobs.
- **`analyze`** is read-only. It runs Qwen2-VL-2B on a picture from a public https URL, or from a file on branch `vision-inputs` (`image_ref`).
- **`mirror`** has write access and runs no model code. It writes `vision-results/<id>.txt` and removes the picture from `vision-inputs`.

1. **URL path.** Run Analyze Image on `main` with:
   - `image_url` = any `https://upload.wikimedia.org/...jpg` under 10 MB (record which one)
   - `prompt=What is in this picture?`
   - `invocation_id=manus-vision-url-1`

   **PASS:** both jobs succeed, and branch `vision-results` has `vision-results/manus-vision-url-1.txt` describing the picture, plus `.meta.txt` with `model=Qwen/Qwen2-VL-2B-Instruct`. Also record the run duration.
2. **Failure path.** Run with `image_ref=vision-inputs/does-not-exist.jpg` and `invocation_id=manus-vision-fail-1`.
   - **PASS:** the `analyze` job fails, the `mirror` job succeeds, and `vision-results/manus-vision-fail-1.txt` starts with `ANALYSIS FAILED`.
   - **Why it matters:** this proves the app stops waiting and shows the reason instead of hanging for 20 minutes.
3. **Input validation.** Run with `image_ref=../../etc/passwd` and `invocation_id=manus-vision-bad-1`.
   - **PASS:** the `analyze` job fails at "Validate inputs" with `image_ref must be vision-inputs/<name>...`. Nothing is fetched.
4. **App path, with Cristian.** He sends a photo in the app with provider DeepSeek 16B. Record:
   - the Analyze Image run URL;
   - that `vision-inputs` at its tip no longer contains that run's file;
   - that the chat answer ends with `(Looked at by Qwen/Qwen2-VL-2B-Instruct · run …)`.

## M3. Relay redeploy and research routes (Cristian does the account steps)

1. Walk Cristian through `relay/README.md` → Deploy. If he deployed before, he only needs `npx wrangler@4 deploy` from `relay/`.
2. Check the routes. Use his relay URL and send the header `Origin: https://deviousdevv303.github.io`.
   - `curl -i -X POST <relay>/v1/research -H 'Content-Type: application/json' -H 'Origin: …' -d '{"question":"latest AI news this week"}'`
     **PASS:** `202` with an `invocation_id` that starts with `public-`.
   - Poll `GET <relay>/v1/research/<id>` (same Origin header) every 10 s.
     **PASS:** it ends with `status: done`, and `report.sources` is non-empty.
   - The same POST with `Origin: https://evil.example`. **PASS:** `403`.
   - `POST <relay>/v1/reason` with `{"task":"Summarize [1]","context":"[1] Example\nhttps://example.com\ntext"}`. **PASS:** `202`.
     Then `GET` it until `done`. A `context` over 16,000 characters must return `413`.
3. **Then acceptance step K** (`docs/live-acceptance-test-2026-10-20.md`) in a private window. Also ask "what's the latest in tech?" as a visitor.
   - **PASS:** the answer cites `[1]`… with 2026 sources.

## M4. Full acceptance test A–L

- **Steps that need the app UI and keys** (A–F, H–J, L1): Cristian runs them; you record the results.
  - Give him one step at a time with its PASS rule, and fill the table yourself.
  - **L1** (Kimi K2.6 with a picture) is the first live test of Kimi image input. If Kimi returns an error about images, record the exact error text. Don't retry with other models.
- **Steps you can run yourself:** G, and the Actions half of E and F.
- **Deliverable:** the filled Results table as a comment on PR #171.

## M5. Qwen model watch (research report, no code changes)

**Goal:** decide with evidence whether a newer Qwen beats what runs today.
- **Text:** Qwen3-8B Q4_K_M via llama-cpp-python **0.3.36**.
- **Vision:** Qwen2-VL-2B via transformers **5.20.1**.

**Why there's no automatic upgrade:** a silent model swap can break the chat template, need a newer llama.cpp than the pinned wheel, overflow the 16 GB runner, or answer worse. Each of these has bitten us before. Upgrades go through a benchmarked PR.

**Hard limits for a candidate (free runner: 4 vCPU, 16 GB RAM, ~14 GB free disk):**
- Official or widely used GGUF Q4_K_M of at most 6 GB (text).
- Weights of at most 5 GB in float32 at 2B scale, or a GGUF/llama.cpp vision path (vision).
- Apache-2.0 or an equally permissive license.

**For each candidate, record:**
- Hugging Face repo, release date, exact file name and size, license.
- Whether llama.cpp **0.3.36** supports the architecture (check the llama.cpp release notes for the arch name).

**Benchmark, only if you can run it on a 4-thread CPU:** the same three prompts Claude used on 2026-10-20.
1. `A train leaves at 14:35 and the trip takes 3 h 30 min. What time does it arrive? One line.` (correct: 18:05)
2. `Write a complete one-page HTML landing page for a bakery called Rise and Shine.` Check that it's complete, with no repeated selectors.
3. `What is 17 * 23? One line.` (391)

Record tokens/s and wall time. Today's baseline is Qwen3-8B: correct, complete, 3.3–4.1 tok/s.

**Deliverable:** `docs/agents/qwen-model-watch-2026-10-20.md` on branch `manus/qwen-model-watch`, as a draft PR. End it with a recommendation of **keep** or **candidate X**, with the numbers. Claude then implements and pins it if Cristian agrees.

## M6. Housekeeping (report only)

1. List the branches that are safe to delete, each with its reason, for Cristian to delete himself:
   - `sculpt/live-smoke-202610200305` and `forge/repair/repair-live-smoke-202610200305` (closed smoke PRs #166/#167);
   - anything else whose PR is merged or closed.
2. Muse's drafts #172/#173: report whether each is based on current main (`9e5713c` or later), whether CI is green, and any conflicts. Don't rebase them yourself; Muse owns them.

## Order and stop points

**Order:** M1 → M6 → M3 (when Cristian is available) → M2 (after the merge) → M4 → M5.
- **Report** after M1, and after each later task.
- **Stop and report at once** if:
  - M1.1 still fails;
  - any run writes to a branch other than its own mirror branch;
  - any output contains something token-shaped.
