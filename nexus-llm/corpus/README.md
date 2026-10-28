# nexus-llm/corpus — verified troubleshooting (facts, for operator admission)

Design law (operator): **behavior in weights, facts in CORPUS.** A 4M-parameter router cannot store knowledge; training a few
troubleshooting notes into it only memorizes them (the run-6 lesson). So resolved troubleshooting lives here as retrievable **facts**,
never in the model's training set.

## The rule (enforced by `check-corpus.ts`, not just promised)
A channel item (issue #235 and the PRs it coordinates) becomes a candidate here only if it **traces to a repo artifact that is checked**:

1. **`admitted: false` on every row.** Nothing here is corpus until the operator admits it (`corpusAdmissionAuth.ts`). No lane self-admits.
2. **A code anchor the validator re-greps.** Each row cites `anchor: {path, needle}`; the validator fails if the needle is not in that
   file on the current tree. This is what makes "verified" true offline, on every run, forever — not a one-time claim.
3. **A provenance artifact.** `artifact.ref` names the merged PR or commit the fix landed in (checked live when the row was written;
   `verifiedAt` stamps when). The validator checks the shape; the code anchor is the standing proof.
4. **Relay is excluded.** A claim about a system this lane cannot read (the Bank, Cloudflare, nexus-trader, another lane's report) has no
   repo anchor, so it cannot be added. Unverifiable chat never becomes corpus.

## Row schema (`verified-troubleshooting.jsonl`)
```json
{ "id": "ct-...", "kind": "troubleshooting",
  "symptom": "what was observed", "cause": "root cause", "fix": "the resolution",
  "anchor": { "path": "src/lib/…", "needle": "a string present in that file on main" },
  "artifact": { "type": "pr"|"commit", "ref": "234"|"<sha>", "verifiedAt": "ISO-8601" },
  "provenance": { "source": "github-pr"|"repo-code"|"github-issue-235", "url": "…" },
  "admitted": false }
```

## Use
`npx vite-node nexus-llm/corpus/check-corpus.ts` — fail if any row breaks the rule (also run in `corpus.test.ts`).
These rows are a **seed** the operator admits and grows; admission, and any decision to retrieve them at inference, is the operator's.

## Where admitted corpus attaches (`attach.ts`)
Facts attach as **retrieved context**, not weights. At inference the runtime (1) selects the few admitted rows relevant to the prompt
[ranking = TODO, a separate step], then (2) `formatContext` renders them into a **bounded** `Context:` block (1800 chars, mirroring the
app's `nexusGuidance` budget), and `attachToPrompt` prepends it before the `User:` frame. In training that block is part of the frame, so
it is **loss-masked** — the model learns to *use* retrieved facts, not to memorize them (the fix for the run-6 failure). `formatContext`
skips any row with `admitted !== true`, so an un-admitted candidate can never reach the model even if selection mis-picks it.
