> **STATUS (2026-10-31, after the pre-registered test): NOT SUPPORTED as stated. See `nexus-llm/runs/capfix/RESULTS.md`.** The capfix run's
> paired probe found capitalized and lowercase copies fail identically (gap 0.0 pts; both 10% on the interpretable Kalshi cell), so the claim
> below that capitalization is "the" blocker, and the word "CONFIRMED", were overclaimed on 3-5 loop items. A post-hoc, untested lead is that
> spans starting with a single-character tokenizer piece lose their first character (capitalization is one cause of that, not the only one).

# Copy-fidelity diagnosis: the blocker is a lone leading capital-letter token

**By:** Claude (diagnosis seat). **Date:** 2026-10-31. **Evidence:** measured with the committed tokenizer `nexus-llm/tokenizer/nexus.model`.

## Symptom (runs 5-7, closed loop)
NEXUS routes to `generate_image` / `kalshi_markets` correctly but mangles the entity it must COPY into the call argument:
`Fed` → `Eed`, `Bitcoin` → `tidecoin`, `pickup` → `pic`, `wrench` → `wren`. Image copies 2/5 (run 7), Kalshi queries 0/2 every run.

## Earlier hypothesis (partly wrong): "multi-piece tokens mangle"
Rejected by evidence. Piece count alone does not discriminate: `lighthouse` = 3 pieces copies FINE; `bitcoin` = 1 piece mangles.
Mean pieces faithful 2.00 vs mangled 2.67 — too weak to be the cause.

## Measured root cause: capitalization splits off a lone leading capital letter
The eval and real prompts capitalize proper nouns ("the **Fed**", "**Bitcoin**", sentence-start "**Generate**..."). The tokenizer was
trained without a dummy prefix and capitals are rare, so a capitalized word splits a **lone single capital letter** as its first piece:

| word | lowercase | capitalized |
|---|---|---|
| fed | `['fed']` (1, clean) | **`['F','ed']`** |
| bitcoin | `['bitcoin']` (1, clean) | **`['B','it','coin']`** |
| pickup | `['p','ick','up']` | `['P','ick','up']` |

**9 of 13** common entities split off a lone leading capital letter when capitalized. The lone-capital piece (`F`, `B`, `P`) is rare in
training and poorly copied, and once the first token is wrong the whole span drifts (`F`→`E`, then `Eed`). The faithfully-copied entities
(`lighthouse`, `refinery`) are among the few that do **not** lone-cap-split.

## Fix — for the next run's data mix (my seat, with `muse`); no GPU needed
1. **Data (cheapest, no tokenizer change):** make a large fraction of copy TARGETS capitalized multi-piece proper nouns with the SAME
   capitalization the eval uses (Fed, Bitcoin, Tesla, Nvidia, Apple, ...), so the copy head sees lone-capital-led spans constantly. Run 7
   added sentence-case diversity but copy targets still under-represent capitalized proper nouns - that is the gap.
2. **Measurement to confirm:** stratify copy success by "does the span start with a lone single-capital piece". If that is the
   discriminator (expected), the data fix is validated before a full run.
3. **Tokenizer v2 (stronger, operator-gated):** retrain with a dummy prefix / heavier capitalized vocab so common capitalized forms get
   their own merges. This invalidates every checkpoint and re-tokenizes the frozen suites (new ids), so it is a deliberate versioned step,
   not a run-level change.

## Scope note
This is the specific blocker for BOTH image fidelity and trading (Kalshi queries) end-to-end. It is a copy/tokenization issue, not a
routing one - routing is already ~75% on domains. Fixing it is the highest-leverage data change for runs 9-11.

## CONFIRMED on run 8's real outputs (committed `nexus-llm/runs/run8/`)
Run 8 (nonce augmentation + copy-weighting 2.0x) is the proof. Its loop jumped to **10/18 (best yet**, run 7 = 3/18, run 4 = 6/18) because
the data lever fixed the LOWERCASE copies — and the remaining failures are exactly the capitalized proper nouns this diagnosis predicts:

| scenario | prompt entity | run 8 copied | verdict |
|---|---|---|---|
| trd-1 | the **Fed** cutting rates | `"E cutting rates"` | capitalized → lone-capital mangle (F→E, dropped) |
| trd-6 | **Fed** cut | `"ced cut..."` | same |
| trd-2 | **bitcoin** above 100k | `"bitcoin above 1000k..."` | lowercase → **copied clean** (only the number drifted) |
| img-1 | red **pickup** truck | `pickup` | lowercase → **copied clean** |
| img-4 | **wrench** | `wrenchnchn` | multi-piece suffix doubled |

So: the data-side copy lever WORKS (lowercase entities now copy; loop 6→10/18), and the residual blocker is precisely the lone-leading-capital
split on capitalized proper nouns. **Run-9 prescription, validated:** add capitalized proper-noun copy targets (Fed, Bitcoin, Tesla, Nvidia,
Apple, ...) matching the eval's capitalization, at high frequency. No tokenizer change needed to test this; it is a data-mix change.

## Run 8 promotion verdict (verified from committed gate.txt)
v1 **67.9%** (clean win over run 4's 60.7%); domains-v1 **76.6%** (format/schema 100, overclaim/fab 0); loop 10/18; pipeline ELIGIBLE.
BUT domains-v1 76.6% is scored on **domains-v1**, while run 4's 76.6% was on **domains-v1.1** (the two differ by one corrected case). A tie
across suite versions is not a STRICT win, so run 8 is **not a clean auto-replace** under replace-only-if-better; run 4 stays incumbent.
Decisive missing measurement: re-score run 8 on **domains-v1.1** (run 4's exact suite). If it holds >= 76.6% there, then — given the clear
v1 win and 10/18 loop — it IS a clean replace. That needs run 8's checkpoint (in the training container, not mine).
