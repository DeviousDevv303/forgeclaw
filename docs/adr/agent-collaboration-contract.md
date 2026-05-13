# ForgeClaw Agent Collaboration Contract v1.0

**Parties**
- KimiClaw — Implementation executor, reasoning validator
- Claude Code — Architectural reviewer, spec author, implementation partner
- Cristian — Project lead, tie-breaker, Guardian proxy

---

## 1. Role Boundaries (Hard Separation)

| Domain | KimiClaw Owns | Claude Code Owns | Shared (Cristian decides) |
|--------|---------------|------------------|---------------------------|
| Spec & ADR | Reads, implements | Writes `docs/adr/` | Approval |
| Types & Schema | Writes `src/types/` | Reviews | Breaking changes |
| Hooks & Logic | Writes `src/hooks/` | Reviews | Performance-critical refactors |
| UI Components | Writes `src/components/` | Reviews | Complex interaction patterns |
| Integration | Writes `src/App.tsx` touchpoints | Reviews | Guardian-gated file changes |
| Mocks & Dev Utils | Writes `src/lib/reasoningMock.ts` | Reviews | |
| Build & Types | Runs `npm run build`, fixes errors | Reviews output | |
| Review Notes | Reads `__claude-review/` | Writes `REVIEWS/claude-*.md`, `__claude-review/` | |
| Staging Reports | Writes `REVIEWS/kimi-staged-*.md` | Reads | |

**Rule:** One agent authors a file, the other reviews. Never both write the same file in the same cycle.

---

## 2. Workspace Isolation

```
forgeclaw/
├── docs/adr/                    ← Claude only
├── REVIEWS/
│   ├── kimi-staged-{sha}.md     ← KimiClaw only
│   └── claude-review-{sha}.md   ← Claude only
├── src/components/
│   ├── reasoning/
│   │   └── __claude-review/     ← Claude drops notes here
│   └── monitor/
│       └── __claude-review/     ← Claude drops notes here
├── src/hooks/__claude-review/   ← Claude drops notes here
└── src/types/__claude-review/   ← Claude drops notes here
```

Claude never commits to KimiClaw-owned files. If Claude finds an issue, he writes:
- A patch snippet in `__claude-review/{filename}.patch.md`
- Or a rewrite suggestion in `__claude-review/{filename}.notes.md`
- KimiClaw applies it in the next cycle.

---

## 3. Handoff Protocol (Ping-Pong Loop)

### Cycle A — KimiClaw Drafts:
1. Implements feature in owned directories
2. Runs `npm run build` (must exit 0)
3. Writes `REVIEWS/kimi-staged-{sha}.md`:
   - Files touched
   - Build status (exit code + warnings)
   - Known issues / TODOs
   - Explicit request for Claude review
4. Stages. Reports SHA. Awaits.

### Cycle B — Claude Reviews:
1. Reads `REVIEWS/kimi-staged-{sha}.md` + diffs
2. Writes `REVIEWS/claude-review-{sha}.md`:
   - Verdict: `APPROVE` / `NEEDS_FIX` / `BLOCKED`
   - Line notes in `__claude-review/` files
   - If `NEEDS_FIX`: exact patch or rewritten snippet
3. If `APPROVE` → Guardian queue for merge
4. If `NEEDS_FIX` → back to KimiClaw Cycle A

### Cycle C — Integration (post-review):
1. KimiClaw applies Claude's patches from `__claude-review/`
2. Re-runs build
3. Writes `REVIEWS/kimi-final-{sha}.md`
4. Guardian review → merge

---

## 4. Unison Mode (Parallel Non-Conflicting)

Both agents work simultaneously on different vertical slices:

| Agent | Slice | Example |
|-------|-------|---------|
| KimiClaw | Reasoning Stream | `src/components/reasoning/`, `src/hooks/useReasoningStream.ts` |
| Claude Code | System Monitor | `src/components/monitor/`, `src/hooks/useSystemMonitor.ts` |

**Constraint:** Never touch the same file. Integration into `App.tsx` is always Cycle C — after both slices are reviewed green.

---

## 5. Conflict Resolution

| Scenario | Rule |
|----------|------|
| Same-file collision detected | Both stop. Cristian decides who rewrites. |
| Architectural disagreement | KimiClaw argues from 5-phase scaffolding. Claude challenges with performance/edge-case analysis. Cristian breaks tie. |
| Build failure after integration | Author of last merged slice owns the fix. |
| Claude requests change KimiClaw disagrees with | KimiClaw can push back once with reasoning. If unresolved, Cristian decides. |

---

## 6. Communication Rules

- No direct agent-to-agent messages. All coordination flows through Cristian or the `REVIEWS/` directory.
- Sign your work. Every commit/PR body ends with `— {AgentName}`.
  - KimiClaw: `— KimiClaw ❤️‍🔥`
  - Claude Code: `— Claude Code`
- Stage only. Neither agent commits or pushes to `main` without Guardian review.
- Guardian-gated files (`integrity_gate.ts`, `useIntegrityGate.ts`, core auth logic, `.github/workflows/`) require explicit Guardian flag before modification per Standing Rule 18.

---

## 7. Priority Order

Truth > Function > Clarity > Efficiency

Both agents must challenge weak reasoning, provide alternatives, and explain why not just what.

---

*Contract ratified by all parties. Effective immediately.*
