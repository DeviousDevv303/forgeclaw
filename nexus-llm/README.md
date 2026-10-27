# nexus-llm — NEXUS Intelligence (own-LLM track)

Standalone. Nothing in `src/` imports this directory. The only read of `src/` is `scripts/snapshot-tools.ts`
(read-only, one-way). Design law: behavior in weights, facts in CORPUS. See `spec/grammar.md`.

| Step | State |
|---|---|
| 1 Grammar spec | staged: `spec/`, `src/grammar.ts`, `src/grammar.test.ts` |
| 2 Tokenizer | not started |
| 3 Exporter + frozen eval | not started (see BLOCKERS in the step-1 report) |
| 4–6 | gated |

```
npx vitest run nexus-llm                                   # contract tests (also picked up by the repo-wide run)
npx vite-node nexus-llm/scripts/snapshot-tools.ts          # regenerate spec/tools.snapshot.json + tool-call.schema.json
npx vite-node nexus-llm/scripts/snapshot-tools.ts --check  # exit 1 if stale
npx vite-node nexus-llm/scripts/extract-manual-fixtures.ts # re-collect spec/fixtures from the repo's own tests
```

Training data custody: nothing here reads the browser corpus or any admitted candidate. Synthetic examples, when they
exist, live in a separate file with an explicit `synthetic: true` field and never enter a Guardian set.
