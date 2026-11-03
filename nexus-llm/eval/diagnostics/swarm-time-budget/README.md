# Swarm time-budget diagnostic (not an exam run; grades nothing)

**Question.** Are the swarm's one-token "malformed" outputs a 420 s engine-budget cut during prompt evaluation, or model behaviour? (#235 comments 6602983670, 6603653218, 6609704768.)

**Test.** The exact mirrored prompt of `swarm-SWM-04-r2-tape-v1` (SHA-256 `1654cedf6d9407bc1309c686eb93c0ac6e675e5f99bc8828ae6cff1e1f134562`, 18677 chars as read here) through llama-cpp-python 0.3.36 with Qwen3-8B Q4_K_M and the workflow's engine settings (n_ctx 8192, n_threads 4, n_batch 512, temperature 0.6, top_p 0.9), timing the wait for the first streamed token and then 24 tokens. Run once, 2026-11-03 16:46 to 16:53Z, on a 4-CPU build container (not the Actions runner). Script: `prefill_test.py`. Result: `prefill_result.json`.

| Measure | This container | Actions runner (the banked artifact) |
|---|---|---|
| prompt tokens | 5261 | not recorded in meta |
| time to first token (prompt evaluation) | **382.2 s** | not separable; `generation_seconds` 552.0 with `generated_tokens` 1 |
| decode after the first token | 0.32 s per token | not recorded |
| budget | n/a | 420 s (`FAST_TIME_BUDGET_S`, chat profile) |

**Reading.** Prompt evaluation alone took 382.2 s here, about 98% of the time to the 25th token. The runner's artifact spent 552 s before it emitted one token, so the runner is roughly 1.45 times slower than this container on this prompt (one run each; not a measured ratio). At this container's speed the answer would still not fit: 382.2 s of evaluation leaves about 38 s of budget, which is about 118 tokens at 0.32 s per token, against the several hundred a complete round-2 JSON needs, so a truncated ("unbalanced JSON") output is the expected result even here. The model's own first tokens were valid JSON opening: "```json\n{\n  \"seat\": \"TAPE\",\n  \"round\": 2,\n  \"status\": \"" (wrapped in a ```json fence).

**Limits.** One run, one container, sampling at temperature 0.6, no seed matched to the artifact; absolute speeds differ from the runner. It shows that prompt evaluation of this prompt takes on the order of the whole budget, not the runner's exact timing.

## End-to-end run without a wall (added 2026-11-03)

`e2e_longbudget.py` runs the same SWM-04 r2-tape prompt with no time budget and up to 1,200 new tokens. Result (`e2e_longbudget_result.json`, output in `e2e_longbudget_output.txt`): 5,261 prompt tokens, 410.2 s to first token, **429 new tokens, 895.4 s total, finish_reason `stop`, and the output parses as JSON** after stripping the fence. One run on a 4-CPU container, not the Actions runner. Caveat: a typecheck and the test suite ran on the same CPUs during part of this run, so the times are an upper bound for this machine. Scaling by the 1.45 ratio from the first test puts the runner near 1,300 s for this prompt plus about 70 s of model load, against a 1,800 s job limit; a longer round-3 prompt could exceed it.
