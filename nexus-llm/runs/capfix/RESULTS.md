# CAPFIX result (graded against the pre-registration as written)

Pre-registration `82e0c8f`, Amendment 1 `1e49a9a` (both committed before any capfix checkpoint existed). Probe v1.2, sha256 `03178656007183d9...`
(verified equal at scoring time). Model: preset `small-copy-ind`, 30,000 rows seed 31, 5,000 steps, lr 6e-4, generator `8bb92c2`;
`model.pt` sha256 prefix `b1ca0456fbc4d01d` (**not pushed**; lives in the training container). Trained in one uninterrupted run (final loss 0.0013).
Probe scored **once**, after the checkpoint existed.

## Verdict: **CAPFIX-FAIL**
| cell (30 items each) | routed to expected tool | strict exact copy | 95% CI |
|---|---|---|---|
| Kalshi, capitalized | 30/30 (interpretable) | **3/30 = 10.0%** | 4-26 |
| Kalshi, lowercase | 30/30 (interpretable) | **3/30 = 10.0%** | 4-26 |
| image, capitalized | 1/30 -> **INCONCLUSIVE** | 1/30 | 1-17 |
| image, lowercase | 1/30 -> **INCONCLUSIVE** | 1/30 | 1-17 |
Headline criterion: capitalized strict copy >= 90% over interpretable cells. **Result 10.0%. FAIL.** The lowercase floor (3.3%, vacuous by
Amendment 1) is met. Gap (lowercase - capitalized) = 0.0 points.
**Pre-registered reading (Amendment 1 table): cap < 90% and low < 90% -> "general copy weakness at this scale: capitalization neither
confirmed nor falsified."** That is the verdict. The image arm is reported INCONCLUSIVE, not as a copy result: the model answers directly
("I can explain in general terms...") instead of routing the entity-in-noun-slot prompt.

## Same-suite comparison with the incumbent (run 4), both on domains v1.1, `gate-cli --incumbent` -> ELIGIBLE (ties allowed)
| | run 4 | capfix |
|---|---|---|
| general v1 | 60.7% | **63.1%** (+2.4) |
| domains v1.1 | 76.6% | 76.6% (tie) |
| format (v1 / domains) | 100 / 100 | 97.6 / 97.9 (slightly worse) |
| closed loop (18, noisy) | 6/18 | 8/18 |
**Operator bar (program spec section 6.2): domains >= 78.6%, v1 >= 72.2%: NOT met.** Capfix does not MEET and SURPASS; run 4 stays the incumbent.
Caveat on the loop: the fixture is single-commit (`2e53e97`) on this side, and run 8's workspace copy is hash-unconfirmed.

## Exploratory, POST-HOC (written after seeing the result; hypothesis, not finding; not part of the pre-registered test)
- Copies fail the same way in both forms: the **first character of the span is replaced** (`Pfizer`->`eizer`, `pfizer`->`eizer`, `Honda`->`eonda`,
  `honda`->`eonda`, `Sony`->`eony`) and the rest copies fine. First character wrong but the rest copied: 13/30 capitalized, 9/30 lowercase.
- Stratified by the tokenizer's first piece of the entity (Kalshi arm, n=60): **single-character first piece: 19/39 lose the first character, 2/39
  exact; first piece of 2+ characters: 3/21 lose it, 4/21 exact.** Lowercase rare words split the same way (`pfizer` -> `['p','f','iz','er']`).
- Reading: the lone-CAPITAL story was a special case. The better candidate is "the span starts with a single-character piece", of which a capital
  letter is only one cause. n is small, the split is confounded with rarity and piece count, and nothing here tests a mechanism.
- **Not tested, would need its own pre-registration BEFORE running:** a probe stratified by first-piece length with both case forms;
  interventions: a span-start marker so the copy head knows where a span begins, a tokenizer v2 whose common words/entities do not start with a
  single-character piece, or training copy targets whose first piece is a single character at a high rate.

## Correction to my earlier claims (the record must say this)
- `d31e8bc`/`a74c3d3` (diagnosis doc), the #326 comment and `8bb92c2` called the capitalization diagnosis **"CONFIRMED"**/"validated". That
  rested on 3-5 loop items from run 8 and a tokenization table: **overclaimed**, as the grader's caveat warned. The pre-registered test did not
  support it (gap 0.0). The diagnosis doc now carries a status banner pointing here.
- The capitalized-nonce change (`8bb92c2`) is **not shown to help**: capfix bundles it with nonce augmentation and copy weighting and cannot isolate it.
