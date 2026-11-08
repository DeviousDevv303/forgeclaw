# NEXUS Intelligence — route → tool call → evidence grammar (step 1)

Status: **PROPOSED**. Nothing here is wired into the app. Source of truth for tools: `spec/tools.snapshot.json`,
generated from `FORGE_TOOLS` at the SHA recorded inside it. Reference implementation: `src/grammar.ts`; contract
tests: `src/grammar.test.ts`.

## Transcript

```
transcript ::= route step* final
route      ::= "<|route:direct|>" | "<|route:tool|>" | "<|route:defer|>"
step       ::= call result
call       ::= "<|call|>" CALL_JSON "<|/call|>"            ; model-emitted
result     ::= ("<|result:ok|>" | "<|result:error|>") TEXT "<|/result|>"   ; runtime-injected, loss-masked in training
final      ::= evidence "<|answer|>" TEXT "<|/answer|>" "<|end|>"
evidence   ::= "<|ev:attempted|>" | "<|ev:completed|>" | "<|ev:verified|>" | "<|ev:blocked|>"
             | "<|ev:failed|>" | "<|ev:partial|>" | "<|ev:not_verified|>"
CALL_JSON  ::= {"name":TOOL,"arguments":{...}}              ; compact, arguments in schema order, no extra keys
```

`TEXT` may not contain anything shaped like a special token (`<|…|>`). The encoder refuses it and the strict parser
treats it as structure, so a tool result or an answer cannot forge `<|ev:verified|>`.

## Special tokens (all must be single atomic tokens — step 2)

18 tokens, listed in `SPECIAL_TOKENS`: 3 routes, `<|call|>` `<|/call|>`, 2 result openers, `<|/result|>`, 7 evidence
statuses, `<|answer|>` `<|/answer|>`, `<|end|>`. `partial` and `not_verified` are the new evidence tokens;
`attempted/completed/verified/blocked/failed` mirror `LearningOutcome` (`src/lib/learningEvents.ts`). The mirror is by
hand, not by test.

Tool names are **not** tokens: they are text inside `CALL_JSON`, so adding a tool never changes the vocabulary and never
forces retokenization. Cost: tool choice is several tokens, not one. Per-tool tokens are the alternative if the
router underperforms (open decision 2).

## Constrained decoding

`spec/tool-call.schema.json` is a JSON Schema (draft-07): one `oneOf` branch per tool, `additionalProperties: false`.
It constrains `CALL_JSON` only. Route, result and evidence tokens are a fixed sequence the runtime can enforce.
**UNVERIFIED:** that llama.cpp (`--json-schema`), Ollama or WebLLM accept this schema and produce what the strict
parser accepts. No GBNF file is generated here, deliberately: that needs a converter this step did not run.

What grammar cannot do: which tool and which argument values remain learned, and can be wrong.

## Semantic rules (checked after decoding by `validateTranscript`; decoding cannot enforce them)

| Evidence | Requires |
|---|---|
| `verified` | an `ok` result from a tool **not** in `notEvidenceTools` (mirrors `answerOutcome`, `src/lib/nexusConvergence.ts`) |
| `completed` | at least one `ok` result |
| `failed` | at least one `error` result |
| `partial` | both an `ok` and an `error` result |
| `attempted` | at least one call |
| `blocked` | `route:defer` or an `error` result |
| `not_verified` | nothing (always allowed) |

Also: `route:tool` needs ≥1 call; `direct` and `defer` may not call tools. Every call must validate against its tool
schema (type, enum, required, no unknown keys; array `items` recursively). A model's own reasoning tools
(`deepseek_reason`, `ask_deepseek`, `review_code`, `spawn_agent`, memory tools, …) can never support `verified`.

Not enforceable here: that an `ok` result is genuinely a success. The `ok`/`error` status comes from the runtime
classifier, which today has the defects J-08/J-09 (`[GUARDIAN BLOCK]` is not recognised as a failure). Fix that
classifier before training data is labelled with it.

## Compatibility with the current manual protocol

`parseManualToolCalls` accepts at least six shapes (fenced `tool_call`, fenced `json`, `TOOL_CALL:` line, `<tool_call>`
XML, bare JSON object, `tool_calls` envelope) and tolerates `input` for `arguments`. The grammar has one. The round-trip
test covers the four shapes that appear as literals in the repo's tests (14 real examples, `spec/fixtures/`); the bare
object and envelope shapes are **not** fixture-tested. Argument aliases the dispatcher tolerates (`nexuslearn`,
`nexusLearn`) are not in any schema, so the grammar cannot express them; tool aliases (`generateimage`,
`deepseekreason`) are not in `FORGE_TOOLS` and are likewise excluded.

## Open decisions (operator)

1. **Routes.** `direct | tool | defer` is the minimum. Finer routes (repo / research / image / site / funds …) can be
   derived from tool-name families; not done because it would be invented, not derived.
2. **Tool names as tokens or text** (above).
3. **Where `ok`/`error` comes from** once the classifier is unified (finding F-06).
4. **Drift policy.** `npx vite-node nexus-llm/scripts/snapshot-tools.ts --check` detects a stale snapshot. It is a script,
   not a test, so a tool-schema change in `src/` cannot fail the main Build Gate. Making it a gate is your call.
