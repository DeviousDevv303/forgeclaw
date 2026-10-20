# Manus coding tasks — 2026-10-20 (spec by Claude, relayed by Cristian)

**How this works:**
- Claude designs; you implement **exactly** what is written here.
- Cristian relaying this file is his written OK for the protected paths named in each task, and **only** those.
- If the code you find doesn't match what a task describes (a line moved, a name differs), **stop and report**. Don't adapt the design yourself.

**Rules for every task:**
1. **Branching:** one `manus/<task>` branch per task, from current `main`, with one PR per task.
   - Open the PR as a **draft**. Mark it ready only after the gate passes.
   - Never merge, rebase or force-push; Cristian merges.
2. **Gate** (all must pass; paste the output tails in the PR):
   ```
   npx vitest run          # expect 0 failed
   npm run lint            # 0 errors (2 pre-existing warnings are fine)
   npm run build
   git diff --check
   python3 -B -m unittest discover -s .github/scripts -p 'test_*.py'   # if .github/scripts changed
   ```
3. **Mutation check** (where a task asks for one): undo the production change, run the new test, paste the failure, and restore the change. A test that still passes without the change is not a test.
4. **Commits:** say WHY, WHAT, FILES, VALIDATION, UNVERIFIED. No secrets anywhere.
5. **Scope:** change only the files listed in the task. Something else looks wrong? Report it; don't fix it.

**Order:** C1 → C2 → (Cristian merges C2) → C3 → C4 → C5 → C6.

---

## C1. Make Muse's #172 mergeable (one merge commit)

**Why:** #172 conflicts with main.
- Main's #169 fix publishes nothing for **any** truncated mirror listing, and throws `… truncated listing of site-builds … nothing was published …`.
- Muse's new test still expects the old message `site-builds is empty (tree listing truncated)`.

**Authorization:** you may push **one merge commit** to `muse/test-gaps` (Muse's branch, PR #172). Nothing else on that branch.

**Steps:**
```
git fetch origin main muse/test-gaps
git checkout -b c1 origin/muse/test-gaps
git merge origin/main          # conflict in src/lib/siteBuild.test.ts only
```
Resolve the conflict by **keeping both tests**, in this order:
1. Muse's test, renamed and with the new expected message:
   ```ts
   it('publishes nothing when the mirror listing is truncated and shows none of the files', async () => {
     const f = fake({ mirrorFiles: [], treeTruncated: true })
     await expect(buildAndPublishSite(f.request, f.input)).rejects.toThrow(/truncated listing .* nothing was published/)
     expect(f.calls.some(c => c.url.startsWith(SITE))).toBe(false)
   })
   ```
2. Main's `it('publishes nothing when the mirror listing is truncated, even if some files are visible (#169)', …)`, unchanged.

**After resolving:**
- Keep the `treeTruncated` option in `fake()`. It must appear exactly once, in the signature and in `truncated: opts.treeTruncated ?? false`.
- Run the gate. Expect 23 tests across `siteBuild`, `deepResearch` and `nexusLearning`.
- `git commit` (merge commit), then `git push origin c1:muse/test-gaps`. That is a fast-forward of Muse's branch; it doesn't rewrite it.

**PASS:** #172 shows no conflicts and CI `build` is green.

---

## C2. Open the PR for DeepSeek pictures

**Why:** the commits landed after #171 was merged. The branch `claude/code-search-proxy-workflow-d37e2y` is already current with main. Don't change it.

Open a PR from `claude/code-search-proxy-workflow-d37e2y` to `main`:
- **Title:** `DeepSeek sees pictures (Qwen2-VL on Actions); Manus directives round 2`
- **Body:** paste the commit message of `feat: DeepSeek sees pictures through the Qwen2-VL workflow on Actions`, add one line about `docs/agents/manus-directive-2026-10-20-r2.md` and this file, then end with `Generated with Claude Code, relayed by Manus`.

**PASS:** CI `build` is green on the PR. Cristian merges.

---

## C3. Spanish for the three new English-only messages (after C2 is merged)

**Files:** `src/lib/i18n.ts`, `src/lib/imageInput.ts`, `src/lib/imageInput.test.ts`, `src/lib/publicRelay.ts`, `src/App.tsx`. None of them is protected.

1. **`src/lib/i18n.ts`, keys.** In the `EN` object, right after `'chat.describeImage'`, add the three keys below. Copy each English text **byte for byte** from where it lives today: `visionUnavailableReply` in `imageInput.ts`, and `PUBLIC_MODE_NOTICE` in `publicRelay.ts`.
   ```ts
   'vision.unavailableVisitor': "Free mode can't read pictures yet. Tell me what's in it, or paste its text, and I'll take it from there.",
   'vision.unavailableOwner': "This provider can't see pictures, so I won't guess what yours shows. Switch the provider to Moonshot · Kimi, Anthropic · Claude or DeepSeek 16B in SETTINGS and send it again.",
   'public.notice': "Free mode: answers come from ForgeClaw's own model and take a few minutes. Your conversations and any errors are shared with the ForgeClaw developer to improve it, so please do not enter private information.",
   ```
2. **`src/lib/i18n.ts`, Spanish.** In the `ES` object, right after its `'chat.describeImage'`:
   ```ts
   'vision.unavailableVisitor': 'El modo gratuito todavía no puede leer imágenes. Dime qué contiene o pega su texto y sigo desde ahí.',
   'vision.unavailableOwner': 'Este proveedor no puede ver imágenes, así que no voy a adivinar qué muestra la tuya. Cambia el proveedor a Moonshot · Kimi, Anthropic · Claude o DeepSeek 16B en AJUSTES y envíala de nuevo.',
   'public.notice': 'Modo gratuito: las respuestas vienen del modelo propio de ForgeClaw y tardan unos minutos. Tus conversaciones y cualquier error se comparten con el desarrollador de ForgeClaw para mejorarlo, así que no escribas información privada.',
   ```
   Leave Russian and Chinese alone; they fall back to English.
3. **`src/lib/imageInput.ts`.** Replace the body of `visionUnavailableReply` and give it a language parameter:
   ```ts
   import { translate, type Lang } from './i18n'
   export function visionUnavailableReply(publicVisitor: boolean, lang: Lang = 'en'): string {
     return translate(lang, publicVisitor ? 'vision.unavailableVisitor' : 'vision.unavailableOwner')
   }
   ```
4. **`src/lib/publicRelay.ts`.** Keep the export name, and take the text from i18n:
   ```ts
   export const PUBLIC_MODE_NOTICE = translate('en', 'public.notice')
   ```
   Import `translate` from `./i18n`.
5. **`src/App.tsx`, two one-line edits:**
   - `content: visionUnavailableReply(isPublicVisitor(ghToken || '')),` → `content: visionUnavailableReply(isPublicVisitor(ghToken || ''), selectedLanguage),`
   - In the free-mode `role="note"` div: `{PUBLIC_MODE_NOTICE}` → `{t('public.notice')}`. Then remove `PUBLIC_MODE_NOTICE` from the App.tsx import, and only if nothing else in App.tsx uses it (check with grep).
6. **Test.** Add to `src/lib/imageInput.test.ts`:
   ```ts
   it('answers in Spanish when the app is in Spanish', () => {
     expect(visionUnavailableReply(true, 'es')).toMatch(/^El modo gratuito todavía no puede leer imágenes/)
     expect(visionUnavailableReply(false, 'es')).toMatch(/en AJUSTES/)
   })
   ```
   **Mutation check:** make `visionUnavailableReply` ignore `lang`. The new test must fail.

**PASS:** the gate is green. `src/lib/i18n.test.ts` (Spanish for every key, matching placeholders) and `src/appPublicVisitor.test.tsx` (English notice text) pass unchanged.

---

## C4. README: correct the capability rows (after C2 is merged)

**File:** `README.md` only.
- Replace the whole `| Image analysis | …` row with:
  `| Image analysis / pictures in chat | Claude and Kimi see the picture directly; DeepSeek 16B runs \`analyze_image\` → \`image-analyze.yml\` (Qwen2-VL-2B, CPU, a few minutes) and answers with what it saw; free mode says it can't read pictures | Fixed 2026-10-20. Live result: see acceptance step L. |`
- Add one row after it:
  `| Live web research | \`deep_research\` / \`deep-research.yml\`; free-mode visitors through the relay's \`/v1/research\` | Works on main (run 39439011635: 5 sources). Visitor path needs the relay redeployed. |`

Don't touch other rows. Gate: `git diff --check` and `npm run build`.

---

## C5. User guide: pictures and free mode (after #173 is merged)

**File:** `docs/user-guide-sites-research-sculpt.md` only.

Insert two sections before `## Known limits`.

**`## 5. Send a picture`**, three short paragraphs:
1. Attach with 📎 and ask a question, for example "what is this?". With Kimi or Claude the model sees the picture itself. With DeepSeek 16B, Activity shows `analyze_image`: the **Analyze Image** Actions run takes a few minutes, and the answer ends with "(Looked at by Qwen/Qwen2-VL-2B-Instruct · run …)".
2. The picture is stored only for the analysis, on the private `vision-inputs` branch, and removed from its tip afterwards. It remains in that branch's history until the branch is deleted.
3. Free mode can't read pictures yet, and says so.

**`## 6. Free mode for friends and family`**, one paragraph:
- Visitors with nothing configured use ForgeClaw's own model through the owner's relay.
- Questions about recent events first run live web research, and the answer cites `[n]` sources.
- Answers take a few minutes.
- Conversations and errors are shared with the developer, as the yellow note says.

Gate: `git diff --check`.

---

## C6. Code review returns its result (protected; authorized by this relay)

**Why:** `review_code` only dispatches and returns "Code review dispatched … Check artifacts in ~3 min". Nobody ever sees the review.

**Pattern:** reuse exactly the one used for pictures: `src/lib/visionInput.ts`, the `mirror` job in `.github/workflows/image-analyze.yml`, and `.github/scripts/vision_mirror.sh`.

**Before writing code: verify the workflow live.** Dispatch Code Review on `main` with:
- `code_content=function add(a,b){return a-b}`
- `language=javascript`
- `invocation_id=manus-review-1`

**PASS:** the run succeeds and `review.txt` in the artifact mentions the subtraction bug. **If it fails, stop here and report the log tail.**

**Files and exact changes** (protected: `code-review.yml`, `review_mirror.sh`, `forgeTools.ts`):
1. **`.github/scripts/review_mirror.sh`** (new): a copy of `vision_mirror.sh` with these changes:
   - Branch `vision-results` → `review-results`.
   - Files `result.txt`/`result_meta.txt` → `review.txt`/`review_meta.txt`.
   - Published names `review-results/<id>.txt` and `.meta.txt`.
   - Failure line `REVIEW FAILED (<result>); see the run log.`
   - Remove the `image_ref` argument, its validation and the `remove_picture` part. Usage becomes `<remote> <id> <result-dir> <review-result>`.
2. **`.github/workflows/code-review.yml`:**
   - Add the input `mirror` (default `'true'`).
   - Add a `mirror` job: `needs: review`, `if: ${{ always() && inputs.mirror != 'false' }}`, `permissions: contents: write`.
   - Its steps: checkout (`persist-credentials: false`, `sparse-checkout: .github/scripts`), **then** download-artifact `code-review-${{ inputs.invocation_id }}` into `result`, then run the script. The `GIT_AUTH_HEADER` export is the same as in image-analyze.
   - The `review` job stays exactly as it is (`contents: read`).
3. **`src/lib/codeReview.ts`** (new), modeled on `runImageAnalysis`, minus the upload:
   - `runCodeReview(request, { owner, repo, token, code, language, signal, sleep, now })`.
   - `code` is trimmed and must be 1–12,000 characters; otherwise throw.
   - It uses `newInvocationId('review')` and `dispatchAndWait` with workflow `code-review.yml`, inputs `{ code_content, language, invocation_id }`, and `maxWaitMs` 20 minutes.
   - It reads `review-results/<id>.txt` (and `.meta.txt` for `model=`) through the contents API with `Accept: application/vnd.github.raw+json`.
   - It throws when the run's conclusion isn't `success` or the text starts with `REVIEW FAILED`.
   - `formatCodeReview` returns `✓ Code review by <model> · run <url>\n<review>`.
4. **`src/lib/forgeTools.ts`, `case 'review_code'` only:**
   - Replace the body with: a token check, then `runCodeReview` with `owner: ctx.ghOwner, repo: ctx.ghRepo`, then return `formatCodeReview(result)`.
   - Use the `githubRequest` that already exists in that function.
5. **`src/App.tsx`, the `keywords` map only:**
   - Today `review_code` is never offered to a chat model.
   - Add `'review_code': ['code review', 'review this code', 'review my code'],` after the `'analyze_image'` entry.
   - Don't use a bare `'review'`: it would offer the tool for "review my workflows".
6. **Tests:**
   - `src/lib/codeReview.test.ts`: copy the structure of `src/lib/visionInput.test.ts`. Cover: success, `REVIEW FAILED` → throws, over 12,000 characters → throws before any dispatch, and the dispatch inputs.
   - `src/scripts/neverRunWorkflows.test.ts`: in the code-review section, assert that the `review` job has no `contents: write`, that the mirror job has it, and that its checkout comes before download-artifact. Copy the image-analyze test that does the same.
   - Run `review_mirror.sh` against a local bare repository, exactly as Claude did for `vision_mirror.sh`, and paste the output in the PR. This covers both a success and a failure.
   - An App test, modeled on the Kimi test in `src/appImageInput.test.tsx`: "review this code: …" with Kimi selected puts `review_code` in the request's `tools`, and "review my workflows" doesn't.
   - **Mutation checks:** make the tool return "dispatched" again, make the mirror job download before checkout, and remove the keyword entry. Each must fail a test.

**PASS:** the gate is green. After Cristian merges, dispatch `manus-review-2` through the app (Kimi: "review this code: function add(a,b){return a-b}"). The chat must show the review, and `review-results/manus-review-2.txt` must exist.
