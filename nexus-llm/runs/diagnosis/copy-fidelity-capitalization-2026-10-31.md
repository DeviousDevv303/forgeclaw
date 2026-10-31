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
